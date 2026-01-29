'use client';

import React from 'react';
import { Box, Container, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Button, Typography, Stack, TextField, Alert, Rating, Select, MenuItem, FormControl, InputLabel, CircularProgress, Avatar, FormHelperText } from '@mui/material';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Header } from '@/components/Header';
import AgentDetailsTabs, {
  type AgentDetailsFeedbackSummary,
  type AgentDetailsValidationsSummary,
} from '@/components/AgentDetailsTabs';
import type { AgentsPageAgent } from '@/components/AgentsPage';
import BackToAgentsButton from '@/components/BackToAgentsButton';
import TrustGraphModal from '@/components/TrustGraphModal';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { useOwnedAgents } from '@/context/OwnedAgentsContext';
import { buildDid8004, signAndSendTransaction, type PreparedTransaction } from '@agentic-trust/core';
import type { Address } from 'viem';
import { decodeAbiParameters, encodeAbiParameters, getAddress, parseAbiParameters, recoverAddress, createPublicClient, http, parseAbi } from 'viem';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';
import { grayscalePalette as palette } from '@/styles/palette';
import SettingsIcon from '@mui/icons-material/Settings';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ShareIcon from '@mui/icons-material/Share';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import VerifiedIcon from '@mui/icons-material/Verified';
import TimelineIcon from '@mui/icons-material/Timeline';
import { finalizeAssociationWithWallet } from '@agentic-trust/core/client';
import { associationIdFromRecord, tryParseEvmV1, KEY_TYPE_K1, KEY_TYPE_SC_DELEGATION, ASSOCIATIONS_STORE_ABI, formatEvmV1 } from '@agentic-trust/8092-sdk';

function ipfsToHttp(uri: string): string {
  const trimmed = String(uri || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('ipfs://')) {
    const cid = trimmed.replace(/^ipfs:\/\//, '');
    return `https://w3s.link/ipfs/${cid}`;
  }
  return trimmed;
}

/**
 * Determine if an address is a contract (smart account) or EOA
 * @param address - The address to check
 * @param chainId - The chain ID
 * @returns true if the address is a contract, false if EOA
 */
async function isContractAddress(address: `0x${string}`, chainId: number): Promise<boolean> {
  try {
    const chain = chainId === sepolia.id ? sepolia : chainId === baseSepolia.id ? baseSepolia : optimismSepolia;
    
    // Get RPC URL from environment variables (client-side)
    let rpcUrl: string | undefined;
    if (chainId === 11155111) {
      rpcUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA;
    } else if (chainId === 84532) {
      rpcUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA;
    } else if (chainId === 11155420) {
      rpcUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA;
    }
    
    // Fallback to chain default RPC URL
    if (!rpcUrl && chain.rpcUrls.default.http[0]) {
      rpcUrl = chain.rpcUrls.default.http[0] as string;
    }
    
    if (!rpcUrl) {
      console.warn('[isContractAddress] No RPC URL available, defaulting to EOA');
      return false;
    }
    
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    
    const code = await publicClient.getBytecode({ address });
    return code !== undefined && code !== '0x' && code.length > 2;
  } catch (error) {
    console.warn('[isContractAddress] Failed to check if address is contract:', error);
    // Default to EOA if check fails (most common case)
    return false;
  }
}

function jsonSafe(value: any): any {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

async function signErc8092Digest(params: {
  provider: any;
  signerAddress: `0x${string}`;
  digest: `0x${string}`;
  typedData?: any;
}): Promise<`0x${string}`> {
  const { provider, signerAddress, digest, typedData } = params;
  // Prefer typed-data signing (EIP-712) so the signature validates against the raw digest.
  const tryV4 = async () =>
    (await provider.request?.({
      method: 'eth_signTypedData_v4',
      params: [signerAddress, JSON.stringify(typedData)],
    })) as `0x${string}`;
  const tryV3 = async () =>
    (await provider.request?.({
      method: 'eth_signTypedData_v3',
      params: [signerAddress, JSON.stringify(typedData)],
    })) as `0x${string}`;
  const tryEthSign = async () =>
    (await provider.request?.({ method: 'eth_sign', params: [signerAddress, digest] })) as `0x${string}`;

  const normalizeSigV = (sig: `0x${string}`): `0x${string}` => {
    const s = String(sig || '') as `0x${string}`;
    if (!s || s === '0x') return sig;
    const hex = s.slice(2);
    // Expect 65-byte sig (r,s,v) => 130 hex chars.
    if (hex.length !== 130) return sig;
    const vHex = hex.slice(128, 130);
    const v = Number.parseInt(vHex, 16);
    if (v === 0 || v === 1) {
      const vOut = (v + 27).toString(16).padStart(2, '0');
      return (`0x${hex.slice(0, 128)}${vOut}`) as `0x${string}`;
    }
    return sig;
  };

  const verify = async (sig: `0x${string}`): Promise<`0x${string}`> => {
    const normalized = normalizeSigV(sig);
    const recovered = await recoverAddress({ hash: digest, signature: normalized });
    if (recovered.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error(`Bad signature: recovered ${recovered} (expected ${signerAddress})`);
    }
    return normalized;
  };

  let lastErr: any = null;
  if (typedData) {
    try {
      const sig = await tryV4();
      if (sig && sig !== '0x') return await verify(sig);
    } catch (e) {
      lastErr = e;
    }
    try {
      const sig = await tryV3();
      if (sig && sig !== '0x') return await verify(sig);
    } catch (e) {
      lastErr = e;
    }
  }
  try {
    const sig = await tryEthSign();
    if (sig && sig !== '0x') return await verify(sig);
  } catch (e) {
    lastErr = e;
  }
  throw lastErr ?? new Error('Failed to sign ERC-8092 digest (typedData / eth_sign unsupported)');
}

async function storeErc8092SarOnChainEoa(params: {
  uaid: string;
  chainId: number;
  provider: any;
  account: `0x${string}`;
  sar: any;
}): Promise<void> {
  const { uaid, chainId, provider, account, sar } = params;
  // NOTE: We do NOT modify record.validAt here because:
  // 1. The associationId (digest) was computed from the original record
  // 2. The signatures (initiator + approver) were computed for that digest
  // 3. Changing validAt would change the digest, making signatures invalid
  // If the agent returns validAt in the future, it will revert - that's expected until the agent is updated.
  // Normalize: some SAR payloads omit derived fields (associationId, parsed addresses).
  // Derive them from the record so downstream logic (dedupe + logging) is stable.
  const normalizedSar = (() => {
    const base = sar && typeof sar === 'object' ? { ...sar } : sar;
    const record = base?.record;
    if (!record || typeof record !== 'object') return base;

    try {
      if (!base.associationId && record.initiator && record.approver) {
        const validAt =
          typeof record.validAt === 'bigint'
            ? Number(record.validAt)
            : typeof record.validAt === 'string'
              ? Number(record.validAt)
              : typeof record.validAt === 'number'
                ? record.validAt
                : 0;
        const validUntil =
          typeof record.validUntil === 'bigint'
            ? Number(record.validUntil)
            : typeof record.validUntil === 'string'
              ? Number(record.validUntil)
              : typeof record.validUntil === 'number'
                ? record.validUntil
                : 0;
        base.associationId = associationIdFromRecord({
          initiator: String(record.initiator),
          approver: String(record.approver),
          validAt,
          validUntil,
          interfaceId: String(record.interfaceId ?? '0x00000000'),
          data: String(record.data ?? '0x'),
        });
      }

      if (!base.initiatorAddress && typeof record.initiator === 'string') {
        const parsed = tryParseEvmV1(record.initiator);
        if (parsed?.address) base.initiatorAddress = parsed.address;
      }
      if (!base.approverAddress && typeof record.approver === 'string') {
        const parsed = tryParseEvmV1(record.approver);
        if (parsed?.address) base.approverAddress = parsed.address;
      }
    } catch {
      // best-effort only
    }
    return base;
  })();
  
  // Check if association already exists before attempting to store
  const associationId = sar?.associationId || normalizedSar?.associationId;
  if (associationId) {
    try {
      const checkResp = await fetch(`/api/associations?account=${encodeURIComponent(account)}&chainId=${chainId}`);
      if (checkResp.ok) {
        const checkData = await checkResp.json().catch(() => ({}));
        const existing = (checkData.associations || []).find((a: any) => 
          String(a.associationId || '').toLowerCase() === String(associationId).toLowerCase()
        );
        if (existing) {
          return; // Already stored, no-op
        }
      }
    } catch (checkErr) {
      // Continue if check fails
    }
  }
  
  // Verify required fields before attempting to store
  // NEW FLOW: Allow empty approverSignature - agent will update it later
  if (!normalizedSar?.record) {
    throw new Error('Missing record in SAR');
  }
  // Note: initiatorSignature can be empty ('0x') - it gets signed client-side
  // Note: approverSignature can be empty ('0x') in new flow - agent will update it
  
  const chain =
    chainId === sepolia.id ? sepolia : chainId === baseSepolia.id ? baseSepolia : optimismSepolia;

  const resp = await fetch('/api/associate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uaid: decodeURIComponent(String(uaid || '')),
      mode: 'eoa',
      sar: jsonSafe(normalizedSar),
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error || err?.message || 'Failed to prepare ERC-8092 storeAssociation tx');
  }
  const plan = await resp.json().catch(() => null) as any;
  const tx = plan?.transaction;
  if (!tx?.to || !tx?.data) {
    throw new Error('Invalid /api/associate response (missing transaction)');
  }

  const result = await signAndSendTransaction({
    transaction: tx as PreparedTransaction,
    account,
    chain,
    ethereumProvider: provider,
  });
  console.log('[storeErc8092SarOnChainEoa] Transaction result:', {
    hash: result?.hash,
    receiptStatus: result?.receipt?.status,
    blockNumber: result?.receipt?.blockNumber,
  });

  // Immediately re-check associations so the UI/user can see the new record
  try {
    const checkRes = await fetch(
      // Force on-chain read here: the discovery/indexer view can lag right after tx submission.
      `/api/associations?account=${encodeURIComponent(account)}&chainId=${chainId}&source=chain`,
      { cache: 'no-store' },
    );
    const checkJson = await checkRes.json().catch(() => null);
    console.log('[storeErc8092SarOnChainEoa] Post-store associations check:', {
      ok: checkRes.ok,
      hasOk: typeof checkJson?.ok === 'boolean' ? checkJson.ok : undefined,
      count: Array.isArray(checkJson?.associations) ? checkJson.associations.length : undefined,
      lookingFor: associationId,
      found: Array.isArray(checkJson?.associations)
        ? checkJson.associations.some((a: any) => String(a?.associationId).toLowerCase() === String(associationId).toLowerCase())
        : false,
    });
  } catch (e) {
    console.warn('[storeErc8092SarOnChainEoa] Post-store associations check failed:', e);
  }
}

type AgentDetailsPageContentProps = {
  agent: AgentsPageAgent;
  uaid: string;
  heroImageSrc: string;
  heroImageFallbackSrc: string;
  displayDid: string;
  chainId: number;
  ownerDisplay: string;
  onChainMetadata?: Record<string, string>; // optional initial value; tabs will lazy-load as needed
};

type DialogState = {
  type: 'give-feedback' | 'feedback-request' | null;
  loading?: boolean;
};

export default function AgentDetailsPageContent({
  agent,
  uaid,
  heroImageSrc,
  heroImageFallbackSrc,
  displayDid,
  chainId,
  ownerDisplay,
  onChainMetadata = {},
}: AgentDetailsPageContentProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const {
    isConnected,
    privateKeyMode,
    loading,
    walletAddress,
    openLoginModal,
    handleDisconnect,
  } = useAuth();
  const { eip1193Provider } = useWallet();
  const router = useRouter();
  const { ownedAgents: cachedOwnedAgents, loading: ownedAgentsLoading, refreshOwnedAgents } = useOwnedAgents();

  const [dialogState, setDialogState] = useState<DialogState>({ type: null });
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ownershipVerified, setOwnershipVerified] = useState<boolean | null>(null);
  const [ownershipChecking, setOwnershipChecking] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackRating, setFeedbackRating] = useState<number>(5);
  const [feedbackSkillId, setFeedbackSkillId] = useState('');
  const [feedbackTag1, setFeedbackTag1] = useState('');
  const [feedbackTag2, setFeedbackTag2] = useState('');
  const [feedbackContext, setFeedbackContext] = useState('');
  const [feedbackCapability, setFeedbackCapability] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Summaries shown in the header cards should come from the discovery/indexer record
  // so we don't have to fetch full datasets unless a tab is opened.
  const validationSummaryText = useMemo(() => {
    const completed =
      typeof (agent as any).validationCompletedCount === 'number'
        ? (agent as any).validationCompletedCount
        : Number((agent as any).validationCompletedCount ?? 0) || 0;
    const pending =
      typeof (agent as any).validationPendingCount === 'number'
        ? (agent as any).validationPendingCount
        : Number((agent as any).validationPendingCount ?? 0) || 0;
    return `${completed} completed · ${pending} pending`;
  }, [agent]);

  const reviewsSummaryText = useMemo(() => {
    const count =
      typeof (agent as any).feedbackCount === 'number'
        ? (agent as any).feedbackCount
        : Number((agent as any).feedbackCount ?? 0) || 0;
    const avg =
      typeof (agent as any).feedbackAverageScore === 'number'
        ? (agent as any).feedbackAverageScore
        : (agent as any).feedbackAverageScore != null
          ? Number((agent as any).feedbackAverageScore)
          : null;
    return count > 0 ? `${count} reviews · ${avg ?? 0} avg` : 'No reviews yet';
  }, [agent]);
  const [agentCard, setAgentCard] = useState<any>(null);
  const [trustGraphModalOpen, setTrustGraphModalOpen] = useState(false);
  const [reviewsModalOpen, setReviewsModalOpen] = useState(false);
  const [validationsModalOpen, setValidationsModalOpen] = useState(false);
  // Load validations for trust graph modal
  const [trustGraphValidations, setTrustGraphValidations] = useState<AgentDetailsValidationsSummary | null>(null);
  const [trustGraphValidationsLoading, setTrustGraphValidationsLoading] = useState(false);
  const [feedbackRequestReason, setFeedbackRequestReason] = useState('');
  const [sendingFeedbackRequest, setSendingFeedbackRequest] = useState(false);
  const [feedbackRequestSuccess, setFeedbackRequestSuccess] = useState(false);
  const [feedbackRequestError, setFeedbackRequestError] = useState<string | null>(null);
  const [selectedFromAgentId, setSelectedFromAgentId] = useState<string>('');
  const [delegationNotifyError, setDelegationNotifyError] = useState<string | null>(null);
  const [delegationNotifyLoading, setDelegationNotifyLoading] = useState(false);
  const [delegationAssociationId, setDelegationAssociationId] = useState<string | null>(null);

  // Load validations when trust graph modal opens
  useEffect(() => {
    if (!trustGraphModalOpen) return;
    if (trustGraphValidationsLoading || trustGraphValidations !== null) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    (async () => {
      setTrustGraphValidationsLoading(true);
      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(uaid)}/validations`,
          { signal: controller.signal },
        );
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          console.warn('[TrustGraphModal] Failed to load validations:', (json as any)?.message || (json as any)?.error || `Failed to load validations (${res.status})`);
          setTrustGraphValidations({ pending: [], completed: [] });
          return;
        }
        const pendingRaw = Array.isArray(json?.pending) ? json.pending : [];
        const completedRaw = Array.isArray(json?.completed) ? json.completed : [];
        setTrustGraphValidations({
          pending: pendingRaw.map((v: any) => ({
            agentId: v?.agentId ?? null,
            requestHash: v?.requestHash ?? null,
            validatorAddress: v?.validatorAddress ?? null,
            response: v?.response ?? null,
            responseHash: v?.responseHash ?? null,
            lastUpdate: v?.lastUpdate ?? null,
            tag: v?.tag ?? null,
          })),
          completed: completedRaw.map((v: any) => ({
            agentId: v?.agentId ?? null,
            requestHash: v?.requestHash ?? null,
            validatorAddress: v?.validatorAddress ?? null,
            response: v?.response ?? null,
            responseHash: v?.responseHash ?? null,
            lastUpdate: v?.lastUpdate ?? null,
            tag: v?.tag ?? null,
          })),
        });
      } catch (e: any) {
        if (!cancelled) {
          console.warn('[TrustGraphModal] Failed to load validations:', e?.message || 'Failed to load validations');
          setTrustGraphValidations({ pending: [], completed: [] });
        }
      } finally {
        if (!cancelled) {
          setTrustGraphValidationsLoading(false);
        }
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [trustGraphModalOpen, uaid]);

  // NOTE: uaid is provided by the server page to avoid recomputation and to keep the
  // canonical route param around for API fetches.
  const chainFor = useCallback((id: number) => {
    switch (id) {
      case 11155111:
        return sepolia;
      case 84532:
        return baseSepolia;
      case 11155420:
        return optimismSepolia;
      default:
        return sepolia;
    }
  }, []);

  const completedValidationCount =
    typeof (agent as any).validationCompletedCount === 'number'
      ? (agent as any).validationCompletedCount
      : Number((agent as any).validationCompletedCount ?? 0) || 0;
  const pendingValidationCount =
    typeof (agent as any).validationPendingCount === 'number'
      ? (agent as any).validationPendingCount
      : Number((agent as any).validationPendingCount ?? 0) || 0;
  const feedbackCount =
    typeof (agent as any).feedbackCount === 'number'
      ? (agent as any).feedbackCount
      : Number((agent as any).feedbackCount ?? 0) || 0;
  const feedbackAverage =
    typeof (agent as any).feedbackAverageScore === 'number'
      ? (agent as any).feedbackAverageScore
      : (agent as any).feedbackAverageScore != null
        ? Number((agent as any).feedbackAverageScore)
        : null;
  const indexerInitiatedAssociationsCount =
    typeof (agent as any).initiatedAssociationCount === 'number' &&
    Number.isFinite((agent as any).initiatedAssociationCount) &&
    (agent as any).initiatedAssociationCount >= 0
      ? (agent as any).initiatedAssociationCount
      : null;
  const indexerApprovedAssociationsCount =
    typeof (agent as any).approvedAssociationCount === 'number' &&
    Number.isFinite((agent as any).approvedAssociationCount) &&
    (agent as any).approvedAssociationCount >= 0
      ? (agent as any).approvedAssociationCount
      : null;

  // NOTE: Associations are now loaded lazily when the Associations tab is selected.
  // We intentionally do not fetch /api/associations during initial page load.

  // Check if wallet owns the agent account using the isOwner API
  const checkOwnership = useCallback(async () => {
    if (!isConnected || !walletAddress) {
      setOwnershipVerified(false);
      return;
    }

    setOwnershipChecking(true);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(uaid)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'isOwner',
          walletAddress,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      setOwnershipVerified(data.isOwner);
    } catch (error) {
      console.error('[AgentDetails] Ownership check failed:', error);
      setOwnershipVerified(false);
    } finally {
      setOwnershipChecking(false);
    }
  }, [isConnected, walletAddress, uaid]);

  // Show Manage Agent button when user is connected AND ownership is verified
  const showManageButton = isConnected && ownershipVerified === true;

  // Check ownership when component mounts or dependencies change
  useEffect(() => {
    checkOwnership();
  }, [checkOwnership]);

  // Resolve ENS name for validator addresses
  const resolveEnsName = useCallback(async (addr?: string | null) => {
    if (!addr || !addr.startsWith('0x')) return null;
    try {
      const { getAgenticTrustClient } = await import('@agentic-trust/core/server');
      const client = await getAgenticTrustClient();
      if (typeof (client as any).resolveEnsName === 'function') {
        const res = await (client as any).resolveEnsName(addr);
        if (res) return res;
      }
      if ((client as any).ensClient?.getName) {
        const res = await (client as any).ensClient.getName(addr);
        if (res?.name) return res.name;
      }
    } catch (err) {
      console.warn('[AgentDetails] ENS resolve failed:', err);
    }
    return null;
  }, []);

  useEffect(() => {
    const agentOwnerAddress =
      agent.eoaAgentIdentityOwnerAccount ?? agent.agentIdentityOwnerAccount ?? null;
    console.log('[AgentDetails] Ownership debug:', {
      isConnected,
      walletAddress,
      agentOwnerAddress,
      agentAccount: agent.agentAccount,
      showManageButton,
      ownershipVerified,
      ownershipChecking,
      agentId: agent.agentId
    });
  }, [
    isConnected,
    walletAddress,
    agent.eoaAgentIdentityOwnerAccount,
    agent.agentIdentityOwnerAccount,
    agent.agentAccount,
    showManageButton,
    ownershipVerified,
    ownershipChecking,
    agent.agentId,
  ]);

  // Use cached owned agents for feedback-request dialog (refresh only if empty)
  useEffect(() => {
    if (dialogState.type !== 'feedback-request') {
      return;
    }
    if (cachedOwnedAgents.length === 0 && isConnected && walletAddress) {
      void refreshOwnedAgents();
    }
    if (cachedOwnedAgents.length > 0 && !selectedFromAgentId) {
      const firstAgent = cachedOwnedAgents[0];
      setSelectedFromAgentId(`${firstAgent.chainId}:${firstAgent.agentId}`);
    }
  }, [dialogState.type, cachedOwnedAgents, selectedFromAgentId, isConnected, walletAddress, refreshOwnedAgents]);

  // Fetch agent card when feedback dialog opens
  useEffect(() => {
    if (dialogState.type === 'give-feedback' && agent.a2aEndpoint && !agentCard) {
      const fetchAgentCard = async (a2aEndpoint: string) => {
        try {
          // Extract base domain from A2A endpoint and construct the agent card URL
          // Agent card is always at base domain/.well-known/agent-card.json (we also accept legacy agent.json)
          let cardUrl: string;
          if (a2aEndpoint.includes('agent-card.json') || a2aEndpoint.includes('agent.json')) {
            cardUrl = a2aEndpoint;
          } else {
            // Extract origin (base domain) from the A2A endpoint URL
            const url = new URL(a2aEndpoint);
            cardUrl = `${url.origin}/.well-known/agent-card.json`;
          }
          const response = await fetch(cardUrl);
          if (response.ok) {
            const card = await response.json();
            setAgentCard(card);
          }
        } catch (error) {
          console.warn('[AgentDetails] Failed to fetch agent card:', error);
        }
      };
      fetchAgentCard(agent.a2aEndpoint);
    }
  }, [dialogState.type, agent.a2aEndpoint, agentCard]);

  const notifyAtpAgentWithDelegation = useCallback(async () => {
    // Best-effort. This does NOT gate giving feedback anymore.
    if (!isConnected || !walletAddress) return;
    if (!eip1193Provider) return;
    if (!agent.a2aEndpoint) return;

    setDelegationNotifyLoading(true);
    setDelegationNotifyError(null);

    try {
      const resolvePlainAddress = (value: unknown): `0x${string}` | null => {
        if (typeof value !== 'string') return null;
        const v = value.trim();
        if (!v) return null;
        if (v.startsWith('eip155:')) {
          const parts = v.split(':');
          const addr = parts[2];
          if (addr && addr.startsWith('0x')) return getAddress(addr) as `0x${string}`;
        }
        if (v.includes(':')) {
          const parts = v.split(':');
          const last = parts[parts.length - 1];
          if (last && last.startsWith('0x')) return getAddress(last) as `0x${string}`;
        }
        if (v.startsWith('0x')) return getAddress(v) as `0x${string}`;
        return null;
      };

      const clientAddr = getAddress(walletAddress) as `0x${string}`;
      const approverAddr =
        resolvePlainAddress((agent as any).agentAccount) ??
        resolvePlainAddress((onChainMetadata as any)?.agentAccount) ??
        null;
      if (!approverAddr) {
        throw new Error('Missing agentAccount for delegation record (approver)');
      }

      const description = JSON.stringify({
        type: 'erc8004.feedbackAuth.delegation',
        agentId: String(agent.agentId),
        chainId: Number(chainId),
        clientAddress: clientAddr,
        createdAt: new Date().toISOString(),
      });
      const data = encodeAbiParameters(
        parseAbiParameters('uint8 assocType, string description'),
        [1, description],
      ) as `0x${string}`;

      const record = {
        initiator: formatEvmV1(Number(chainId), clientAddr),
        approver: formatEvmV1(Number(chainId), approverAddr),
        validAt: 0,
        validUntil: 0,
        interfaceId: '0x00000000',
        data,
      };

      const associationId = associationIdFromRecord(record as any) as `0x${string}`;
      setDelegationAssociationId(associationId);

      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
          ],
          AssociatedAccountRecord: [
            { name: 'initiator', type: 'bytes' },
            { name: 'approver', type: 'bytes' },
            { name: 'validAt', type: 'uint40' },
            { name: 'validUntil', type: 'uint40' },
            { name: 'interfaceId', type: 'bytes4' },
            { name: 'data', type: 'bytes' },
          ],
        },
        primaryType: 'AssociatedAccountRecord',
        domain: { name: 'AssociatedAccounts', version: '1' },
        message: {
          initiator: record.initiator,
          approver: record.approver,
          validAt: record.validAt,
          validUntil: record.validUntil,
          interfaceId: record.interfaceId,
          data: record.data,
        },
      };

      const initiatorSignature = await signErc8092Digest({
        provider: eip1193Provider,
        signerAddress: clientAddr,
        digest: associationId,
        typedData,
      });

      const delegationSar = {
        record,
        initiatorSignature,
        associationId,
        initiatorKeyType: KEY_TYPE_K1,
        // SC-DELEGATION: approver provides a delegation proof blob on-chain.
        approverKeyType: KEY_TYPE_SC_DELEGATION,
      };

      const resp = await fetch(`/api/agents/${encodeURIComponent(uaid)}/feedback-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientAddress: clientAddr,
          agentId: String(agent.agentId),
          chainId: Number(chainId),
          delegationSar,
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'ATP agent requestAuth failed');
      }
    } catch (e: any) {
      setDelegationNotifyError(e?.message || String(e));
    } finally {
      setDelegationNotifyLoading(false);
    }
  }, [agent, chainId, uaid, eip1193Provider, isConnected, onChainMetadata, walletAddress]);

  const openDialog = useCallback((type: DialogState['type'], loadData?: () => Promise<void>) => {
    setDialogState({ type, loading: true });
    if (loadData) {
      loadData().finally(() => {
        setDialogState(prev => ({ ...prev, loading: false }));
      });
    } else {
      setDialogState(prev => ({ ...prev, loading: false }));
    }
  }, []);

  const closeDialog = useCallback(() => {
    setDialogState({ type: null });
  }, []);

  const handleOpenRegistrationEdit = useCallback(() => {
    if (!agent.agentUri) return;
    router.push(`/admin-tools/${encodeURIComponent(uaid)}?tab=registration`);
  }, [agent.agentUri, uaid, router]);

  const handleGiveFeedback = useCallback(() => {
    if (!isConnected) {
      openLoginModal();
      return;
    }
    openDialog('give-feedback');
    // Best-effort: on click, send one initiator signature + delegation SAR to ATP agent.
    void notifyAtpAgentWithDelegation();
  }, [isConnected, notifyAtpAgentWithDelegation, openDialog, openLoginModal]);

  const handleSendFeedbackRequest = useCallback(async () => {
    if (!feedbackRequestReason.trim()) {
      setFeedbackRequestError('Please provide a reason for requesting feedback');
      return;
    }

    if (!selectedFromAgentId) {
      setFeedbackRequestError('Please select an agent to send the request from');
      return;
    }

    if (!agent.a2aEndpoint) {
      setFeedbackRequestError('Agent does not have an A2A endpoint configured');
      return;
    }

    if (!walletAddress) {
      setFeedbackRequestError('Wallet address not available. Please connect your wallet.');
      return;
    }

    setSendingFeedbackRequest(true);
    setFeedbackRequestError(null);
    setFeedbackRequestSuccess(false);

    try {
      // Parse selected agent ID (format: "chainId:agentId")
      const [fromChainId, fromAgentId] = selectedFromAgentId.split(':');
      if (!fromChainId || !fromAgentId) {
        throw new Error('Invalid selected agent ID');
      }

      // Find the selected agent from cachedOwnedAgents to get its DID and name
      const fromAgent = cachedOwnedAgents.find(
        (a) => a.chainId === parseInt(fromChainId, 10) && a.agentId === fromAgentId
      );
      if (!fromAgent) {
        throw new Error('Selected agent not found in owned agents');
      }

      // Build DID8004 for both agents
      const parsedFromChainId = parseInt(fromChainId, 10);
      const fromAgentDid = buildDid8004(parsedFromChainId, Number(fromAgentId));
      const toAgentDid = uaid;

      // Fetch task type from discovery
      const taxonomyRes = await fetch('/api/discovery/taxonomy', { cache: 'no-store' }).catch(() => null);
      const taxonomy = taxonomyRes?.ok ? await taxonomyRes.json().catch(() => ({})) : {};
      const taskTypes = Array.isArray(taxonomy?.taskTypes) ? taxonomy.taskTypes : [];
      const feedbackTaskType = taskTypes.find((t: any) => {
        const k = String(t?.key || '').toLowerCase();
        return k.includes('feedback') && (k.includes('auth') || k.includes('request'));
      })?.key || 'feedback_auth_request';

      const messageRequest = {
        message: `Feedback Request: ${feedbackRequestReason}`,
        payload: {
          type: feedbackTaskType,
          comment: feedbackRequestReason,
          clientAddress: walletAddress,
          fromAgentId: fromAgentId,
          fromAgentChainId: parsedFromChainId,
          fromAgentDid: fromAgentDid,
          fromAgentName: fromAgent.agentName || `Agent #${fromAgentId}`,
          toAgentId: agent.agentId,
          toAgentChainId: chainId,
          toAgentDid: toAgentDid,
          toAgentName: agent.agentName || `Agent #${agent.agentId}`,
        },
        metadata: {
          requestType: feedbackTaskType,
          timestamp: new Date().toISOString(),
          fromAgentId: fromAgentId,
          fromAgentChainId: parsedFromChainId,
          toAgentId: agent.agentId,
          toAgentChainId: chainId,
        },
        skillId: 'atp.feedback.request',
      };

      // Use agents-atp specific route for feedback/inbox messages
      const response = await fetch('/api/agents-atp/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageRequest),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to send feedback request');
      }

      const data = await response.json();
      setFeedbackRequestSuccess(true);
      setFeedbackRequestReason('');
      
      // Close dialog after a short delay
      setTimeout(() => {
        setDialogState({ type: null });
        setFeedbackRequestSuccess(false);
      }, 2000);
    } catch (error: any) {
      console.error('[AgentDetails] Failed to send feedback request:', error);
      setFeedbackRequestError(error?.message || 'Failed to send feedback request');
    } finally {
      setSendingFeedbackRequest(false);
    }
  }, [feedbackRequestReason, agent.a2aEndpoint, agent.agentId, chainId, walletAddress, uaid]);

  const handleShare = useCallback(() => {
    setShareOpen(true);
  }, []);

  const handleCopyLink = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, []);

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Header
        displayAddress={walletAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={loading}
      />
      <Container
        maxWidth="lg"
        sx={{
          py: { xs: 4, md: 6 },
          display: 'flex',
          flexDirection: 'column',
          gap: '1.75rem',
        }}
      >
        <BackToAgentsButton />
        
        {/* Hero Section */}
        <Box
          sx={{
            borderRadius: '20px',
            p: { xs: 2, md: 4 },
            border: '1px solid rgba(0,0,0,0.1)',
            backgroundColor: palette.surface,
            color: palette.textPrimary,
            display: 'flex',
            gap: { xs: '1.5rem', md: '2.5rem' },
            flexWrap: 'wrap',
            alignItems: 'stretch',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            position: 'relative',
          }}
        >
          {/* Share Button */}
          <IconButton
            onClick={handleShare}
            sx={{
              position: 'absolute',
              top: 16,
              right: 16,
              color: palette.textPrimary,
              backgroundColor: palette.surfaceMuted,
              '&:hover': {
                backgroundColor: palette.border,
              },
            }}
            aria-label="Share agent"
          >
            <ShareIcon />
          </IconButton>

          <Box sx={{ flex: '1 1 360px', minWidth: 0 }}>
            <p
              style={{
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontSize: '0.8rem',
                color: palette.textSecondary,
                marginBottom: '0.35rem',
              }}
            >
              Agent Details
            </p>
            <h1
              style={{
                margin: 0,
                fontSize: '1.75rem',
                lineHeight: 1.2,
                color: palette.textPrimary,
                fontWeight: 600,
              }}
            >
              {agent.agentName || `Agent #${agent.agentId}`}
            </h1>
            <p
              style={{
                margin: '0.5rem 0 0',
                fontSize: '1rem',
                color: palette.textSecondary,
                fontWeight: 500,
              }}
            >
              Agent: #{agent.agentId}
            </p>

            {/* Accounts (KB v2) */}
            {(() => {
              const entries = [
                { label: 'Agent Account', value: agent.agentAccount },
                { label: 'SmartAgent Account', value: (agent as any).smartAgentAccount },
                { label: 'Agent Owner EOA', value: (agent as any).agentOwnerEOAAccount },
                { label: 'Agent Owner', value: (agent as any).agentOwnerAccount },
                { label: 'Agent Wallet', value: (agent as any).agentWalletAccount },
                { label: 'Agent Operator', value: (agent as any).agentOperatorAccount },
                { label: 'Identity Owner', value: (agent as any).identityOwnerAccount },
                { label: 'Identity Wallet', value: (agent as any).identityWalletAccount },
                { label: 'Identity Operator', value: (agent as any).identityOperatorAccount },
              ].filter((e) => typeof e.value === 'string' && e.value.trim().startsWith('0x'));

              if (entries.length === 0) return null;

              return (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ color: palette.textSecondary, mb: 0.75 }}>
                    Accounts
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1 }}>
                    {entries.map((e) => (
                      <Box key={e.label} sx={{ display: 'flex', gap: 1, minWidth: 0 }}>
                        <Typography variant="caption" sx={{ color: palette.textSecondary, minWidth: 140 }}>
                          {e.label}
                        </Typography>
                        <Typography variant="caption" sx={{ color: palette.textPrimary }} noWrap>
                          {String(e.value)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })()}

            {/* Action Buttons */}
            <Stack direction="row" spacing={1.5} sx={{ mt: 3.5 }}>
              {showManageButton && (
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<SettingsIcon />}
                  onClick={() => {
                    router.push(`/admin-tools/${encodeURIComponent(uaid)}`);
                  }}
                  sx={{
                    backgroundColor: palette.accent,
                    color: palette.surface,
                    border: `1px solid ${palette.accent}`,
                    '&:hover': {
                      backgroundColor: palette.border,
                      color: palette.textPrimary,
                      borderColor: palette.border,
                    },
                    textTransform: 'none',
                    fontWeight: 700,
                  }}
                >
                  Manage Agent
                </Button>
              )}

              {/* Always show Give Feedback (no gating). */}
              <Button
                variant="contained"
                color="primary"
                startIcon={<ChatBubbleOutlineIcon />}
                onClick={handleGiveFeedback}
                sx={{
                  backgroundColor: palette.accent,
                  color: palette.surface,
                  border: `1px solid ${palette.accent}`,
                  '&:hover': {
                    backgroundColor: palette.border,
                    color: palette.textPrimary,
                    borderColor: palette.border,
                  },
                  textTransform: 'none',
                  fontWeight: 700,
                }}
              >
                Give Feedback
              </Button>
            </Stack>
          </Box>
          <Box
            sx={{
              flex: '0 0 260px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid #d1d5db',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                backgroundColor: palette.surface,
                height: '150px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={heroImageSrc}
                alt={agent.agentName || `Agent #${agent.agentId}`}
                onError={(event) => {
                  if (event.currentTarget.src !== heroImageFallbackSrc) {
                    event.currentTarget.src = heroImageFallbackSrc;
                  }
                }}
                style={{
                  height: '100%',
                  width: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>
          </Box>
        </Box>

        {/* Trust Graph snapshot */}
        <Box
          sx={{
            borderRadius: '16px',
            border: `1px solid ${palette.border}`,
            backgroundColor: palette.surfaceMuted,
            p: { xs: 2, md: 3 },
            boxShadow: '0 8px 20px rgba(15,23,42,0.08)',
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            alignItems="stretch"
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={2} flexWrap="wrap">
              {!isMobile && (
                <StatPill
                  icon={<AutoGraphIcon fontSize="small" />}
                  label="Validations"
                  value={`${completedValidationCount} completed · ${pendingValidationCount} pending`}
                />
              )}
              {!isMobile && (
                <StatPill
                  icon={<VerifiedIcon fontSize="small" />}
                  label="Reputation"
                  value={
                    feedbackAverage !== null
                      ? `${feedbackCount} reviews · ${feedbackAverage}`
                      : `${feedbackCount} reviews`
                  }
                />
              )}
              {!isMobile && (
                <StatPill
                  icon={<AutoGraphIcon fontSize="small" />}
                  label="Associations"
                  value={`${(indexerInitiatedAssociationsCount ?? '—').toString()} initiated · ${(indexerApprovedAssociationsCount ?? '—').toString()} approved`}
                  title={
                    indexerInitiatedAssociationsCount !== null || indexerApprovedAssociationsCount !== null
                      ? `Indexer fields: ${indexerInitiatedAssociationsCount ?? 0}/${indexerApprovedAssociationsCount ?? 0}`
                      : undefined
                  }
                />
              )}
            </Stack>
            <Stack spacing={0.75} alignItems={{ xs: 'flex-start', md: 'flex-end' }}>
              <Button
                variant="contained"
                color="primary"
                onClick={() => setTrustGraphModalOpen(true)}
                startIcon={<AutoGraphIcon />}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Open Trust Graph Explorer
              </Button>
              {typeof (agent as any).trustLedgerScore === 'number' &&
                Number.isFinite((agent as any).trustLedgerScore) &&
                typeof (agent as any).trustLedgerOverallRank === 'number' &&
                Number.isFinite((agent as any).trustLedgerOverallRank) &&
                (agent as any).trustLedgerOverallRank > 0 && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ lineHeight: 1.2 }}
                    title={`Agent Index${typeof (agent as any).trustLedgerBadgeCount === 'number' ? ` · badges: ${(agent as any).trustLedgerBadgeCount}` : ''}`}
                  >
                    score: {Math.round((agent as any).trustLedgerScore)} · rank: #{(agent as any).trustLedgerOverallRank}
                  </Typography>
                )}
            </Stack>
          </Stack>
        </Box>

          <AgentDetailsTabs
            uaid={uaid}
          agent={agent}
            onChainMetadata={onChainMetadata}
        />
      </Container>

      {/* Dialogs */}
      <Dialog open={shareOpen} onClose={() => setShareOpen(false)}>
        <DialogTitle>
          Share Agent
          <IconButton
            onClick={() => setShareOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: '300px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Share Link</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={currentUrl}
                  readOnly
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    border: `1px solid ${palette.border}`,
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '4px',
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.surface,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <ContentCopyIcon sx={{ fontSize: '1rem' }} />
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '0.9rem', color: palette.textSecondary }}>
                Share this link to let others view this agent's details.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Give Feedback Dialog */}
      <Dialog
        open={dialogState.type === 'give-feedback'}
        onClose={closeDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Give Feedback
          <IconButton
            onClick={closeDialog}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          {agent.agentName && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Agent: {agent.agentName}
            </Typography>
          )}

          {/* Best-effort: show delegation/association notify status (does not block feedback). */}
          {(delegationNotifyLoading || delegationNotifyError || delegationAssociationId) && (
            <Box sx={{ mb: 2 }}>
              {delegationNotifyLoading && (
                <Alert severity="info">
                  Preparing delegation (one signature)…
                </Alert>
              )}
              {delegationNotifyError && (
                <Alert severity="warning">
                  Delegation setup failed (non-fatal): {delegationNotifyError}
                </Alert>
              )}
              {!delegationNotifyLoading && !delegationNotifyError && delegationAssociationId && (
                <Alert severity="success">
                  Delegation prepared: {delegationAssociationId}
                </Alert>
              )}
            </Box>
          )}

          {agent.a2aEndpoint && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                A2A Agent Card:
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                  fontSize: "0.75rem"
                }}
              >
                {agent.a2aEndpoint}
              </Typography>
            </Box>
          )}

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Rating
            </Typography>
            <Rating
              value={feedbackRating}
              onChange={(_, newValue) => {
                if (newValue !== null) {
                  setFeedbackRating(newValue);
                }
              }}
              max={5}
              size="large"
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Skill (optional)
            </Typography>
            {agentCard?.skills && agentCard.skills.length > 0 ? (
              <TextField
                select
                fullWidth
                value={feedbackSkillId}
                onChange={(e) => setFeedbackSkillId(e.target.value)}
                disabled={submittingFeedback}
                SelectProps={{
                  native: true,
                }}
                helperText="Select the skill you’re giving feedback on."
              >
                <option value="">Select a skill…</option>
                {agentCard.skills.map((skill: any) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name || skill.id}
                  </option>
                ))}
              </TextField>
            ) : (
              <TextField
                fullWidth
                value={feedbackSkillId}
                onChange={(e) => setFeedbackSkillId(e.target.value)}
                disabled={submittingFeedback}
                placeholder="e.g. governance_and_trust/trust/trust_feedback_authorization"
                helperText="This agent card didn’t publish a skill list—enter a skill id manually (optional)."
              />
            )}
          </Box>

          <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
            <TextField
              label="Tag 1 (optional)"
              fullWidth
              value={feedbackTag1}
              onChange={(e) => setFeedbackTag1(e.target.value)}
              disabled={submittingFeedback}
              size="small"
            />
            <TextField
              label="Tag 2 (optional)"
              fullWidth
              value={feedbackTag2}
              onChange={(e) => setFeedbackTag2(e.target.value)}
              disabled={submittingFeedback}
              size="small"
            />
          </Box>

          <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
            <TextField
              label="Context (optional)"
              fullWidth
              value={feedbackContext}
              onChange={(e) => setFeedbackContext(e.target.value)}
              disabled={submittingFeedback}
              size="small"
            />
            <TextField
              label="Capability (optional)"
              fullWidth
              value={feedbackCapability}
              onChange={(e) => setFeedbackCapability(e.target.value)}
              disabled={submittingFeedback}
              size="small"
            />
          </Box>

          <TextField
            label="Comment"
            fullWidth
            multiline
            rows={4}
            value={feedbackComment}
            onChange={(e) => setFeedbackComment(e.target.value)}
            disabled={submittingFeedback}
            sx={{ mb: 2 }}
          />

          {feedbackSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Feedback submitted successfully!
            </Alert>
          )}

          {feedbackError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {feedbackError}
            </Alert>
          )}
        </DialogContent>

        <DialogActions>
          <Button
            onClick={closeDialog}
            disabled={submittingFeedback}
          >
            Cancel
          </Button>
          <Button
            onClick={async () => {
              if (!feedbackComment.trim()) {
                setFeedbackError("Please enter a comment");
                return;
              }

              if (!agent.agentId || !chainId) {
                setFeedbackError("Agent information is incomplete");
                return;
              }

              setSubmittingFeedback(true);
              setFeedbackSuccess(false);
              setFeedbackError(null);

              try {
                // Get client address from wallet
                const clientAddress = walletAddress;
                if (!clientAddress) {
                  throw new Error('Wallet address not available. Please connect your wallet.');
                }

                const agentId = String(agent.agentId);
                const agentName = typeof agent.agentName === 'string' ? agent.agentName : undefined;

                // Submit feedback to the API (no feedbackAuth required)
                const score = feedbackRating * 20; // Convert 1-5 to 0-100

                console.info('[GiveFeedback] Submitting feedback via /api/feedback', {
                  chainId,
                  agentId,
                  clientAddress,
                  score,
                  tag1: feedbackTag1 || undefined,
                  tag2: feedbackTag2 || undefined,
                  skill: feedbackSkillId || undefined,
                  context: feedbackContext || undefined,
                  capability: feedbackCapability || undefined,
                  endpoint: onChainMetadata?.agentUrl || agent?.agentUri || undefined,
                });

                const feedbackResponse = await fetch('/api/feedback', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    agentId,
                    chainId,
                    score,
                    feedback: feedbackComment,
                    clientAddress,
                    ...(agentName && { agentName }),
                    ...(feedbackTag1 && { tag1: feedbackTag1 }),
                    ...(feedbackTag2 && { tag2: feedbackTag2 }),
                    ...(feedbackSkillId && { skill: feedbackSkillId }),
                    ...(feedbackContext && { context: feedbackContext }),
                    ...(feedbackCapability && { capability: feedbackCapability }),
                    // If user didn't supply context/capability and we have an associationId from delegation, include it.
                    ...(!feedbackContext && delegationAssociationId
                      ? { context: `erc8092:${String(delegationAssociationId)}` }
                      : {}),
                  }),
                });

                if (!feedbackResponse.ok) {
                  const errorData = await feedbackResponse.json().catch(() => ({}));
                  throw new Error(errorData.message || errorData.error || 'Failed to submit feedback');
                }

                const feedbackResult = await feedbackResponse.json().catch(() => ({}));

                // If the server can't sign (no server wallet), it returns a prepared tx for client signing.
                if (feedbackResult?.mode === 'client' && feedbackResult?.transaction) {
                  console.info('[GiveFeedback] Server returned prepared tx for client signing', {
                    chainId: feedbackResult?.chainId,
                    to: (feedbackResult?.transaction as any)?.to,
                    dataPrefix: typeof (feedbackResult?.transaction as any)?.data === 'string'
                      ? String((feedbackResult?.transaction as any).data).slice(0, 10)
                      : undefined,
                  });
                  if (!eip1193Provider) {
                    throw new Error('Wallet provider not available. Please connect your wallet.');
                  }
                  const preparedTx = feedbackResult.transaction as PreparedTransaction;
                  const targetChainId =
                    typeof feedbackResult.chainId === 'number'
                      ? feedbackResult.chainId
                      : preparedTx.chainId || chainId;

                  await signAndSendTransaction({
                    transaction: preparedTx,
                    account: clientAddress as Address,
                    chain: chainFor(targetChainId),
                    ethereumProvider: eip1193Provider,
                  });
                } else if (feedbackResult?.mode === 'server') {
                  console.info('[GiveFeedback] Feedback submitted server-side', {
                    txHash: feedbackResult?.txHash,
                  });
                }

                setFeedbackSuccess(true);

                // Reset form
                setFeedbackComment('');
                setFeedbackRating(5);
                setFeedbackTag1('');
                setFeedbackTag2('');
                setFeedbackSkillId('');
                setFeedbackContext('');
                setFeedbackCapability('');

                setTimeout(() => {
                  setFeedbackSuccess(false);
                  closeDialog();
                }, 1500);
              } catch (err) {
                console.error('Failed to submit feedback:', err);
                setFeedbackError(err instanceof Error ? err.message : 'Failed to submit feedback');
              } finally {
                setSubmittingFeedback(false);
              }
            }}
            disabled={submittingFeedback || !feedbackComment.trim()}
            variant="contained"
          >
            {submittingFeedback ? 'Submitting...' : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Feedback Request Dialog */}
      <Dialog
        open={dialogState.type === 'feedback-request'}
        onClose={() => {
          setDialogState({ type: null });
          setFeedbackRequestReason('');
          setFeedbackRequestError(null);
          setFeedbackRequestSuccess(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Request Feedback Authorization
          <IconButton
            onClick={() => {
              setDialogState({ type: null });
              setFeedbackRequestReason('');
              setFeedbackRequestError(null);
              setFeedbackRequestSuccess(false);
            }}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          {agent.agentName && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Agent: {agent.agentName}
            </Typography>
          )}

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel id="send-feedback-request-from-agent-label">
              Send Request From Agent
            </InputLabel>
            <Select
              id="send-feedback-request-from-agent"
              labelId="send-feedback-request-from-agent-label"
              value={selectedFromAgentId}
              onChange={(e) => setSelectedFromAgentId(e.target.value)}
              label="Send Request From Agent"
              disabled={sendingFeedbackRequest || feedbackRequestSuccess || ownedAgentsLoading}
              renderValue={(selected) => {
                const selectedAgent = cachedOwnedAgents.find(
                  (a) => `${a.chainId}:${a.agentId}` === selected,
                );
                const displayName = selectedAgent?.agentName || (selectedAgent ? `Agent #${selectedAgent.agentId}` : '');
                const img = (selectedAgent?.image || '').trim();
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar
                      src={img || undefined}
                      alt={displayName}
                      sx={{ width: 22, height: 22, fontSize: 12 }}
                    >
                      {(displayName || 'A').slice(0, 1).toUpperCase()}
                    </Avatar>
                    <Typography variant="body2" sx={{ lineHeight: 1.2 }}>
                      {displayName}
                    </Typography>
                  </Box>
                );
              }}
            >
              {cachedOwnedAgents.length === 0 ? (
                <MenuItem disabled>
                  {ownedAgentsLoading ? 'Loading…' : 'No owned agents found'}
                </MenuItem>
              ) : (
                cachedOwnedAgents.map((ownedAgent) => {
                  const agentKey = `${ownedAgent.chainId}:${ownedAgent.agentId}`;
                  const displayName = ownedAgent.agentName || `Agent #${ownedAgent.agentId}`;
                  const img = (ownedAgent.image || '').trim();

                  return (
                    <MenuItem key={agentKey} value={agentKey}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                        <Avatar
                          src={img || undefined}
                          alt={displayName}
                          sx={{ width: 22, height: 22, fontSize: 12 }}
                        >
                          {(displayName || 'A').slice(0, 1).toUpperCase()}
                        </Avatar>
                        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <Typography variant="body2" sx={{ lineHeight: 1.2 }} noWrap>
                            {displayName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }} noWrap>
                            Chain {ownedAgent.chainId}, ID {ownedAgent.agentId}
                          </Typography>
                        </Box>
                      </Box>
                    </MenuItem>
                  );
                })
              )}
            </Select>
            {ownedAgentsLoading && (
              <FormHelperText sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} />
                Loading your agents…
              </FormHelperText>
            )}
          </FormControl>

          <Typography variant="body2" sx={{ mb: 2 }}>
            Why do you want to give feedback to this agent?
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={4}
            value={feedbackRequestReason}
            onChange={(e) => setFeedbackRequestReason(e.target.value)}
            placeholder="e.g., I used this agent to help me find information and want to share my experience..."
            disabled={sendingFeedbackRequest || feedbackRequestSuccess}
            sx={{ mb: 2 }}
          />

          {feedbackRequestSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Feedback request sent successfully! The agent will review your request.
            </Alert>
          )}

          {feedbackRequestError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {feedbackRequestError}
            </Alert>
          )}
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => {
              setDialogState({ type: null });
              setFeedbackRequestReason('');
              setFeedbackRequestError(null);
              setFeedbackRequestSuccess(false);
            }}
            disabled={sendingFeedbackRequest}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSendFeedbackRequest}
            variant="contained"
            disabled={sendingFeedbackRequest || feedbackRequestSuccess || !feedbackRequestReason.trim() || !selectedFromAgentId || ownedAgentsLoading}
            sx={{
              backgroundColor: palette.accent,
              '&:hover': {
                backgroundColor: palette.border,
              },
            }}
          >
            {sendingFeedbackRequest ? 'Sending...' : 'Send Request'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Trust Graph Modal */}
      <TrustGraphModal
        open={trustGraphModalOpen}
        onClose={() => setTrustGraphModalOpen(false)}
        agent={agent}
        feedbackSummary={{
          count: feedbackCount,
          averageScore: typeof feedbackAverage === 'number' && Number.isFinite(feedbackAverage) ? feedbackAverage : undefined,
        }}
        validations={trustGraphValidations}
        onOpenReviews={() => {
          setTrustGraphModalOpen(false);
          // Could scroll to feedback tab or show feedback dialog
          // For now, just close the modal - user can navigate to Feedback tab
        }}
        onOpenValidations={() => {
          setTrustGraphModalOpen(false);
          // Could scroll to validation tab or show validation dialog
          // For now, just close the modal - user can navigate to Validation tab
        }}
        resolveEnsName={resolveEnsName}
      />
    </Box>
  );
}

type StatPillProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
  title?: string;
};

function StatPill({ icon, label, value, title }: StatPillProps) {
  return (
    <Box
      title={title}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1,
        borderRadius: '12px',
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.surface,
        boxShadow: '0 2px 6px rgba(15,23,42,0.06)',
      }}
    >
      <Box sx={{ color: palette.accent, display: 'flex', alignItems: 'center' }}>{icon}</Box>
      <Box>
        <Typography variant="caption" sx={{ color: palette.textSecondary, fontWeight: 600, display: 'block' }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ color: palette.textPrimary, fontWeight: 600 }}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

