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
import { decodeAbiParameters, encodeAbiParameters, getAddress, parseAbiParameters, recoverAddress, createPublicClient, http, getBytecode, readContract, parseAbi } from 'viem';
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
import { associationIdFromRecord, tryParseEvmV1, KEY_TYPE_K1, KEY_TYPE_DELEGATED, ASSOCIATIONS_STORE_ABI } from '@agentic-trust/8092-sdk';

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
  did8004: string;
  chainId: number;
  provider: any;
  account: `0x${string}`;
  sar: any;
}): Promise<void> {
  const { did8004, chainId, provider, account, sar } = params;
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
      did8004: decodeURIComponent(String(did8004 || '')),
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
  did8004: string;
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
  did8004,
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
  const [feedbackAuth, setFeedbackAuth] = useState<string | null>(null);
  const [feedbackAuthLoading, setFeedbackAuthLoading] = useState(false);
  const [feedbackAuthError, setFeedbackAuthError] = useState<string | null>(null);
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
  const [feedbackRequestReason, setFeedbackRequestReason] = useState('');
  const [sendingFeedbackRequest, setSendingFeedbackRequest] = useState(false);
  const [feedbackRequestSuccess, setFeedbackRequestSuccess] = useState(false);
  const [feedbackRequestError, setFeedbackRequestError] = useState<string | null>(null);
  const [selectedFromAgentId, setSelectedFromAgentId] = useState<string>('');

  // NOTE: did8004 is provided by the server page to avoid recomputation and to keep the
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
      const response = await fetch(`/api/agents/${encodeURIComponent(did8004)}`, {
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
  }, [isConnected, walletAddress, did8004]);

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

  // Try to get feedbackAuth on page load
  useEffect(() => {
    if (!agent.a2aEndpoint || !isConnected || !walletAddress) {
      setFeedbackAuth(null);
      return;
    }

    let cancelled = false;
    setFeedbackAuthLoading(true);
    setFeedbackAuthError(null);

    (async () => {
      try {
        // First: check for an existing ERC-8092 delegation that contains the feedbackAuth payload.
        // If it exists, use it and avoid calling the agent for feedbackAuth again.
        try {
          if (agent.agentAccount) {
            const assocResp = await fetch(
              `/api/associations?account=${encodeURIComponent(walletAddress)}&chainId=${encodeURIComponent(String(chainId))}`,
              { cache: 'no-store' },
            );
            if (!cancelled && assocResp.ok) {
              const assocJson = await assocResp.json().catch(() => null) as any;
              const associations: any[] = Array.isArray(assocJson?.associations) ? assocJson.associations : [];
              const nowSec = Math.floor(Date.now() / 1000);

              const agentAccountLower = String(agent.agentAccount).toLowerCase();
              const walletLower = String(walletAddress).toLowerCase();

              for (const a of associations) {
                // must be an active, unrevoked delegation association
                const revokedAt = Number(a?.revokedAt ?? 0);
                if (revokedAt && revokedAt > 0) continue;
                const validAt = Number(a?.record?.validAt ?? a?.validAt ?? 0);
                const validUntil = Number(a?.record?.validUntil ?? a?.validUntil ?? 0);
                if (Number.isFinite(validAt) && validAt > 0 && validAt > nowSec) continue;
                if (Number.isFinite(validUntil) && validUntil > 0 && validUntil < nowSec) continue;

                const initiatorAddr = String(a?.initiatorAddress ?? a?.initiator ?? '').toLowerCase();
                const approverAddr = String(a?.approverAddress ?? a?.approver ?? '').toLowerCase();
                if (!initiatorAddr || !approverAddr) continue;

                // require this delegation be between current wallet (initiator) and the agent account (approver)
                if (initiatorAddr !== walletLower) continue;
                if (approverAddr !== agentAccountLower) continue;

                const dataHex = String(a?.record?.data ?? a?.data ?? '').trim();
                if (!dataHex || !dataHex.startsWith('0x')) continue;

                // Decode assocType + description
                let assocType: number | null = null;
                let description = '';
                try {
                  const [t, d] = decodeAbiParameters(
                    parseAbiParameters('uint8 assocType, string description'),
                    dataHex as `0x${string}`,
                  ) as any;
                  assocType = Number(t);
                  description = String(d ?? '');
                } catch {
                  continue;
                }
                if (assocType !== 1) continue;

                let payloadUri: string | null = null;
                try {
                  const parsed = JSON.parse(description || '{}');
                  if (parsed?.type === 'erc8004.feedbackAuth.delegation' && typeof parsed?.payloadUri === 'string') {
                    payloadUri = parsed.payloadUri;
                  }
                } catch {
                  // ignore
                }
                if (!payloadUri) continue;

                // Fetch delegation payload from IPFS and extract feedbackAuth
                try {
                  const httpUrl = ipfsToHttp(payloadUri);
                  const payload = httpUrl ? await fetch(httpUrl, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null) : null;
                  const feedbackAuthId =
                    typeof payload?.feedbackAuth === 'string'
                      ? String(payload.feedbackAuth).trim()
                      : null;
                  const payloadAgentId = payload?.agentId != null ? String(payload.agentId) : null;
                  const payloadChainId = payload?.chainId != null ? Number(payload.chainId) : null;
                  if (
                    feedbackAuthId &&
                    feedbackAuthId.startsWith('0x') &&
                    payloadAgentId === String(agent.agentId) &&
                    payloadChainId === Number(chainId)
                  ) {
                    setFeedbackAuth(feedbackAuthId);
                    return;
                  }
                } catch {
                  // ignore and fall back to requesting feedbackAuth
                }
              }
            }
          }
        } catch {
          // ignore and fall back to requesting feedbackAuth
        }

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

        // Build a client-side delegation SAR (record + initiator signature) so the provider
        // can store it on-chain using its MetaMask delegation/session package.
        const delegationSar = await (async (): Promise<any | null> => {
          if (!eip1193Provider) return null;

          const clientAddr = getAddress(walletAddress) as `0x${string}`;
          const approverAddr =
            resolvePlainAddress((agent as any).agentAccount) ??
            resolvePlainAddress((onChainMetadata as any)?.agentAccount) ??
            null;
          if (!approverAddr) return null;

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

          // Re-use the same ERC-7930 EVM-v1 address encoding used elsewhere in the app.
          const ethers = await import('ethers');
          const toMinimalBigEndianBytes = (n: bigint): Uint8Array => {
            if (n === 0n) return new Uint8Array([0]);
            let hex = n.toString(16);
            if (hex.length % 2) hex = `0${hex}`;
            return ethers.getBytes(`0x${hex}`);
          };
          const formatEvmV1 = (chainIdNum: number, address: string): string => {
            const addr = ethers.getAddress(address);
            const chainRef = toMinimalBigEndianBytes(BigInt(chainIdNum));
            const head = ethers.getBytes('0x00010000');
            const out = ethers.concat([
              head,
              new Uint8Array([chainRef.length]),
              chainRef,
              new Uint8Array([20]),
              ethers.getBytes(addr),
            ]);
            return ethers.hexlify(out);
          };

          const record = {
            initiator: formatEvmV1(Number(chainId), clientAddr),
            approver: formatEvmV1(Number(chainId), approverAddr),
            validAt: 0,
            validUntil: 0,
            interfaceId: '0x00000000',
            data,
          };

          const associationId = associationIdFromRecord(record as any) as `0x${string}`;
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

          // Determine initiatorKeyType based on whether initiator is EOA or smart account
          // EOA → 0x0001 (K1), Smart Account → 0x0001 (K1) for ERC-1271 validation
          // Note: If initiator uses delegation, it would be 0x8002, but typically initiator is EOA
          const initiatorIsContract = await isContractAddress(clientAddr, Number(chainId));
          const initiatorKeyType = initiatorIsContract ? KEY_TYPE_K1 : KEY_TYPE_K1; // Both use K1 for ERC-1271 or ecrecover
          
          // Approver uses MetaMask delegation, so use DELEGATED keyType
          const approverKeyType = KEY_TYPE_DELEGATED; // 0x8002

          return {
            record,
            initiatorSignature,
            associationId,
            initiatorKeyType,
            approverKeyType,
          };
        })();

        // NEW FLOW: Store association with initiator signature only first
        if (delegationSar && delegationSar.record && delegationSar.initiatorSignature) {
          try {
            console.log('[AgentDetails] Storing association with initiator signature only before requesting feedbackAuth');
            await storeErc8092SarOnChainEoa({
              did8004,
              chainId: Number(chainId),
              provider: eip1193Provider,
              account: walletAddress as `0x${string}`,
              sar: {
                record: delegationSar.record,
                initiatorSignature: delegationSar.initiatorSignature,
                approverSignature: '0x', // Empty - will be set by agent
                initiatorKeyType: delegationSar.initiatorKeyType || KEY_TYPE_K1,
                approverKeyType: delegationSar.approverKeyType || KEY_TYPE_DELEGATED, // Agent uses MetaMask delegation
                revokedAt: 0,
                associationId: delegationSar.associationId,
              },
            });
            console.log('[AgentDetails] ✓ Stored association with initiator signature, associationId:', delegationSar.associationId);
            
            // Wait for association to be queryable on-chain before calling ATP agent
            // This ensures the agent can retrieve it via getAssociation
            // Use direct contract call (same method ATP agent uses) to verify it's queryable
            const associationId = delegationSar.associationId;
            if (associationId) {
              console.log('[AgentDetails] Waiting for association to be queryable on-chain (direct contract call)...');
              
              // Get chain and RPC URL
              const chain = chainId === sepolia.id ? sepolia : chainId === baseSepolia.id ? baseSepolia : optimismSepolia;
              let rpcUrl: string | undefined;
              if (chainId === 11155111) {
                rpcUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA;
              } else if (chainId === 84532) {
                rpcUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA;
              } else if (chainId === 11155420) {
                rpcUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA;
              }
              
              if (!rpcUrl && chain.rpcUrls?.default?.http?.[0]) {
                rpcUrl = chain.rpcUrls.default.http[0];
              }
              
              if (!rpcUrl) {
                throw new Error(`Missing RPC URL for chain ${chainId}`);
              }
              
              const publicClient = createPublicClient({
                chain,
                transport: http(rpcUrl),
              });
              
              // Associations proxy address (hardcoded for now, matches config.ts)
              const associationsProxy = '0x3418A5297C75989000985802B8ab01229CDDDD24' as `0x${string}`;
              
              const maxRetries = 15; // Increase retries since contract calls can lag
              const retryDelayMs = 1000; // 1 second between retries
              let found = false;
              
              for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                  // Direct contract call using getAssociation (same as ATP agent)
                  const sar = await publicClient.readContract({
                    address: associationsProxy,
                    abi: parseAbi(ASSOCIATIONS_STORE_ABI),
                    functionName: 'getAssociation',
                    args: [associationId as `0x${string}`],
                  });
                  
                  if (sar && (sar as any).record) {
                    found = true;
                    console.log(`[AgentDetails] ✓ Association found on-chain via direct contract call after ${attempt} attempt(s)`);
                    break;
                  }
                } catch (checkErr: any) {
                  // getAssociation reverts if association doesn't exist
                  // This is expected - continue retrying
                  const isRevert = checkErr?.message?.includes('reverted') || checkErr?.message?.includes('0x4c2c14c8');
                  if (!isRevert) {
                    console.warn(`[AgentDetails] Association check attempt ${attempt} failed:`, checkErr);
                  }
                }
                
                if (attempt < maxRetries) {
                  await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                }
              }
              
              if (!found) {
                const errorMsg = `Association ${associationId} not found on-chain after ${maxRetries} retries. Cannot proceed with ATP agent call.`;
                console.error('[AgentDetails]', errorMsg);
                throw new Error(errorMsg);
              }
              
              // Add additional delay buffer for cross-RPC propagation
              // ATP agent runs on Cloudflare (different RPC node) vs local admin UI
              // Different RPC nodes can have sync delays even after transaction confirmation
              console.log('[AgentDetails] Association confirmed locally, waiting 2 seconds for cross-RPC propagation...');
              await new Promise(resolve => setTimeout(resolve, 2000));
              console.log('[AgentDetails] Proceeding with ATP agent call');
            }
          } catch (storeErr: any) {
            console.warn('[AgentDetails] Failed to store association with initiator signature (non-fatal):', storeErr?.message || storeErr);
            // Continue with A2A request even if storage fails (fallback to old flow)
          }
        }

        const response = await fetch(`/api/agents/${encodeURIComponent(did8004)}/feedback-auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientAddress: walletAddress,
            agentId: agent.agentId.toString(),
            chainId: Number(chainId),
            associationId: delegationSar?.associationId, // Send associationId so agent can retrieve and update
            delegationSar, // Keep for backward compatibility
          }),
        });

        

        if (cancelled) return;

        if (response.ok) {
          const data = await response.json();

          const feedbackAuthId =
            (data?.feedbackAuthId as string | undefined) ??
            (data?.feedbackAuth as string | undefined) ??
            null;
          const delegationAssociation = (data as any)?.delegationAssociation ?? null;

          if (feedbackAuthId === '0x0') {
            setFeedbackAuth(null);
            return;
          }
          if (feedbackAuthId) {
            setFeedbackAuth(feedbackAuthId);
          } else {
            setFeedbackAuth(null);
          }
          // NOTE: We no longer try to store any returned delegationAssociation from the browser.
          // The provider (atp-agent) stores the delegation SAR on-chain using its SessionPackage delegation.
          if (feedbackAuthId && delegationAssociation) {
            console.log('[AgentDetails] Provider returned delegationAssociation (ignored client-side):', {
              associationId: (delegationAssociation as any)?.associationId,
            });
          }
        } else {
          setFeedbackAuth(null);
        }
      } catch (error) {
        if (cancelled) return;
        console.warn('[AgentDetails] Failed to get feedbackAuth:', error);
        setFeedbackAuth(null);
      } finally {
        if (!cancelled) {
          setFeedbackAuthLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [agent.a2aEndpoint, agent.agentId, chainId, did8004, isConnected, walletAddress, eip1193Provider, onChainMetadata]);

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
    router.push(`/admin-tools/${encodeURIComponent(did8004)}?tab=registration`);
  }, [agent.agentUri, did8004, router]);

  const handleGiveFeedback = useCallback(() => {
    if (!feedbackAuth) {
      // Show feedback request dialog instead
      setDialogState({ type: 'feedback-request' });
      return;
    }
    openDialog('give-feedback');
  }, [feedbackAuth, openDialog]);

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
      const toAgentDid = did8004;

      const messageRequest = {
        message: `Feedback Request: ${feedbackRequestReason}`,
        payload: {
          type: 'feedback_auth_request',
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
          requestType: 'feedback_auth_request',
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
  }, [feedbackRequestReason, agent.a2aEndpoint, agent.agentId, chainId, walletAddress, did8004]);

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
            {/* Action Buttons */}
            <Stack direction="row" spacing={1.5} sx={{ mt: 3.5 }}>
              {showManageButton && (
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<SettingsIcon />}
                  onClick={() => {
                    router.push(`/admin-tools/${encodeURIComponent(did8004)}`);
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

              {agent.a2aEndpoint && isConnected && (
                  <>
                    {!feedbackAuth && !feedbackAuthLoading && (
                      <Button
                        variant="outlined"
                        color="primary"
                        startIcon={<ChatBubbleOutlineIcon />}
                        onClick={() => setDialogState({ type: 'feedback-request' })}
                        sx={{
                          borderColor: palette.accent,
                          color: palette.accent,
                          '&:hover': {
                            backgroundColor: palette.accent,
                            color: palette.surface,
                            borderColor: palette.accent,
                          },
                          textTransform: 'none',
                          fontWeight: 700,
                        }}
                      >
                        Send Feedback Request
                      </Button>
                    )}
                    {feedbackAuth && (
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
                    )}
                    {feedbackAuthLoading && (
                      <Button
                        variant="contained"
                        color="primary"
                        disabled
                        sx={{
                          backgroundColor: palette.accent,
                          color: palette.surface,
                          border: `1px solid ${palette.accent}`,
                          textTransform: 'none',
                          fontWeight: 700,
                        }}
                      >
                        Checking authorization...
                      </Button>
                    )}
                  </>
                )}
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
            did8004={did8004}
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
                placeholder="e.g. oasf:trust.feedback.authorization"
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

                // Request feedbackAuth from provider (A2A). Include a client-built ERC-8092 delegation SAR
                // so the provider can store it on-chain using its SessionPackage delegation.
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

                const delegationSar = await (async (): Promise<any | null> => {
                  if (!eip1193Provider) return null;
                  const clientAddr = getAddress(clientAddress) as `0x${string}`;
                  const approverAddr =
                    resolvePlainAddress((agent as any).agentAccount) ??
                    resolvePlainAddress((onChainMetadata as any)?.agentAccount) ??
                    null;
                  if (!approverAddr) return null;

                  const description = JSON.stringify({
                    type: 'erc8004.feedbackAuth.delegation',
                    agentId: String(agentId),
                    chainId: Number(chainId),
                    clientAddress: clientAddr,
                    createdAt: new Date().toISOString(),
                  });
                  const data = encodeAbiParameters(
                    parseAbiParameters('uint8 assocType, string description'),
                    [1, description],
                  ) as `0x${string}`;

                  const ethers = await import('ethers');
                  const toMinimalBigEndianBytes = (n: bigint): Uint8Array => {
                    if (n === 0n) return new Uint8Array([0]);
                    let hex = n.toString(16);
                    if (hex.length % 2) hex = `0${hex}`;
                    return ethers.getBytes(`0x${hex}`);
                  };
                  const formatEvmV1 = (chainIdNum: number, address: string): string => {
                    const addr = ethers.getAddress(address);
                    const chainRef = toMinimalBigEndianBytes(BigInt(chainIdNum));
                    const head = ethers.getBytes('0x00010000');
                    const out = ethers.concat([
                      head,
                      new Uint8Array([chainRef.length]),
                      chainRef,
                      new Uint8Array([20]),
                      ethers.getBytes(addr),
                    ]);
                    return ethers.hexlify(out);
                  };

                  const record = {
                    initiator: formatEvmV1(Number(chainId), clientAddr),
                    approver: formatEvmV1(Number(chainId), approverAddr),
                    validAt: 0,
                    validUntil: 0,
                    interfaceId: '0x00000000',
                    data,
                  };

                  const associationId = associationIdFromRecord(record as any) as `0x${string}`;
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
                  return { record, initiatorSignature };
                })();

                const feedbackAuthResponse = await fetch(`/api/agents/${encodeURIComponent(did8004)}/feedback-auth`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    clientAddress,
                    agentId,
                    chainId: Number(chainId),
                    delegationSar,
                  }),
                });
                if (!feedbackAuthResponse.ok) {
                  const errorData = await feedbackAuthResponse.json().catch(() => ({}));
                  throw new Error(errorData.message || errorData.error || 'Failed to get feedback auth');
                }

                const feedbackAuthData = await feedbackAuthResponse.json();
                const feedbackAuthId = feedbackAuthData.feedbackAuthId;
                const resolvedAgentId = feedbackAuthData.agentId || agentId;
                const resolvedChainId = feedbackAuthData.chainId || chainId;
                const delegationAssociation = (feedbackAuthData as any)?.delegationAssociation ?? null;

                if (!feedbackAuthId) {
                  throw new Error('No feedbackAuth returned by provider');
                }

                if (!resolvedAgentId) {
                  throw new Error('Agent ID is required');
                }

                // If the agent returned a delegationAssociation, complete the initiator signature (wallet)
                // and store the ERC-8092 association on-chain (so the client is memorialized as having
                // rights to give feedback).
                if (delegationAssociation && eip1193Provider) {
                  // NOTE: We no longer store delegation associations from the browser.
                  // The provider stores the client-built SAR on-chain using its SessionPackage delegation.
                  console.log('[AgentDetails] Provider returned delegationAssociation (ignored client-side):', {
                    associationId: (delegationAssociation as any)?.associationId,
                  });
                }

                // Use the delegation payload pointer embedded in the ERC-8092 association (IPFS) as the
                // capability/context for this feedback submission.
                // This lets feedback submissions reference the exact delegation that granted rights.
                let delegationPayloadUri: string | null = null;
                try {
                  const payloadUriRaw =
                    (delegationAssociation as any)?.delegation?.payloadUri ??
                    (delegationAssociation as any)?.payloadUri ??
                    null;
                  if (typeof payloadUriRaw === 'string' && payloadUriRaw.trim()) {
                    delegationPayloadUri = payloadUriRaw.trim();
                    // Best-effort fetch (useful for debugging / future server-side enforcement).
                    const httpUrl = ipfsToHttp(delegationPayloadUri);
                    if (httpUrl) {
                      await fetch(httpUrl, { cache: 'no-store' }).then(() => null).catch(() => null);
                    }
                  }
                } catch {
                  // ignore
                }

                // Submit feedback to the API
                const score = feedbackRating * 20; // Convert 1-5 to 0-100

                const feedbackResponse = await fetch('/api/feedback', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    agentId: resolvedAgentId,
                    chainId: resolvedChainId,
                    score,
                    feedback: feedbackComment,
                    feedbackAuth: feedbackAuthId,
                    clientAddress,
                    ...(agentName && { agentName }),
                    ...(feedbackTag1 && { tag1: feedbackTag1 }),
                    ...(feedbackTag2 && { tag2: feedbackTag2 }),
                    ...(feedbackSkillId && { skill: feedbackSkillId }),
                    ...(feedbackContext && { context: feedbackContext }),
                    ...(feedbackCapability && { capability: feedbackCapability }),
                    ...(!feedbackCapability && delegationPayloadUri
                      ? { capability: `delegationPayloadUri:${delegationPayloadUri}` }
                      : {}),
                    ...(!feedbackContext && delegationAssociation?.associationId
                      ? { context: `erc8092:${String(delegationAssociation.associationId)}` }
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
                  if (!eip1193Provider) {
                    throw new Error('Wallet provider not available. Please connect your wallet.');
                  }
                  const preparedTx = feedbackResult.transaction as PreparedTransaction;
                  const targetChainId =
                    typeof feedbackResult.chainId === 'number'
                      ? feedbackResult.chainId
                      : preparedTx.chainId || Number(resolvedChainId) || chainId;

                  await signAndSendTransaction({
                    transaction: preparedTx,
                    account: clientAddress as Address,
                    chain: chainFor(targetChainId),
                    ethereumProvider: eip1193Provider,
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
        validations={null}
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

