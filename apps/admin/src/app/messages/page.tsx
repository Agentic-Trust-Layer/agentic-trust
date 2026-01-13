'use client';

// Avoid static prerendering for this route to speed up `next build` page-data collection.
export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useCallback, useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Autocomplete,
  FormControl,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  CircularProgress,
} from '@mui/material';
import Rating from '@mui/material/Rating';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { useOwnedAgents } from '@/context/OwnedAgentsContext';
import { grayscalePalette as palette } from '@/styles/palette';
import { type ValidationClaimType, VALIDATION_CLAIM_TYPE_OPTIONS } from '@/models/validation';
import { AssocType, ASSOC_TYPE_OPTIONS } from '@/lib/association-types';
import SendIcon from '@mui/icons-material/Send';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import CreateOutlinedIcon from '@mui/icons-material/CreateOutlined';
import SearchIcon from '@mui/icons-material/Search';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import { useRouter } from 'next/navigation';
import { buildDid8004, parseDid8004, getDeployedAccountClientByAgentName, getDeployedAccountClientByAddress } from '@agentic-trust/core';
import { getChainById, DEFAULT_CHAIN_ID } from '@agentic-trust/core/server';
import {
  finalizeAssociationWithWallet,
  requestNameValidationWithWallet,
  requestAccountValidationWithWallet,
  requestAppValidationWithWallet,
} from '@agentic-trust/core/client';
import { getClientBundlerUrl, getClientRpcUrl, getClientRegistryAddresses } from '@/lib/clientChainEnv';
import { createPublicClient, encodeAbiParameters, getAddress, http, keccak256, parseAbiParameters, toHex } from 'viem';
import type { Chain } from 'viem';
import {
  INBOX_INTENT_TYPE_OPTIONS,
  INBOX_TASK_TYPE_OPTIONS,
  type InboxIntentType,
  type InboxTaskType,
} from '@/models/a2aTasks';

type Message = {
  id: number;
  subject: string | null;
  body: string;
  contextType: string;
  contextId: string | null;
  taskId?: string | null;
  taskType?: string | null;
  fromAgentDid: string | null;
  fromAgentName: string | null;
  toAgentDid: string | null;
  toAgentName: string | null;
  fromClientAddress: string | null;
  toClientAddress: string | null;
  createdAt: number | null;
  readAt: number | null;
  associationType?: number | null;
  associationDescription?: string | null;
  associationPayload?: string | null;
};

type AssociationRequestPayload = {
  version: 1;
  chainId: number;
  initiatorDid: string;
  approverDid: string;
  initiatorAddress: `0x${string}`;
  approverAddress: `0x${string}`;
  assocType: number;
  description: string;
  validAt: number;
  validUntil: number;
  interfaceId: `0x${string}`;
  data: `0x${string}`;
  digest: `0x${string}`;
  initiatorSignature: `0x${string}`;
  signatureMethod?: 'eth_sign' | 'eth_signTypedData_v4' | 'eth_signTypedData_v3';
};

const ASSOCIATION_PAYLOAD_MARKER_BEGIN = '---BEGIN ASSOCIATION PAYLOAD---';
const ASSOCIATION_PAYLOAD_MARKER_END = '---END ASSOCIATION PAYLOAD---';

function extractAssociationPayloadFromBody(body: string): AssociationRequestPayload | null {
  if (!body) return null;
  const start = body.indexOf(ASSOCIATION_PAYLOAD_MARKER_BEGIN);
  const end = body.indexOf(ASSOCIATION_PAYLOAD_MARKER_END);
  if (start === -1 || end === -1 || end <= start) return null;
  const json = body.slice(start + ASSOCIATION_PAYLOAD_MARKER_BEGIN.length, end).trim();
  if (!json) return null;
  try {
    return JSON.parse(json) as AssociationRequestPayload;
  } catch {
    return null;
  }
}

type ValidationRequestBlock = {
  kind: 'erc8004.validation.request@1';
  chainId: number;
  requesterDid: string;
  validatorDid: string;
  validatorAddress: string;
  requestUri: string;
  requestHash: string;
  txHash?: string;
  mode?: string;
  createdAt?: string;
};

const VALIDATION_REQUEST_MARKER_BEGIN = '[validation_request]';
const VALIDATION_REQUEST_MARKER_END = '[/validation_request]';

function extractValidationRequestBlockFromBody(body: string): ValidationRequestBlock | null {
  if (!body) return null;
  const start = body.indexOf(VALIDATION_REQUEST_MARKER_BEGIN);
  const end = body.indexOf(VALIDATION_REQUEST_MARKER_END);
  if (start === -1 || end === -1 || end <= start) return null;
  const json = body.slice(start + VALIDATION_REQUEST_MARKER_BEGIN.length, end).trim();
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as ValidationRequestBlock;
    if (!parsed || parsed.kind !== 'erc8004.validation.request@1') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function signAssociationDigest(params: {
  provider: any;
  signerAddress: `0x${string}`;
  digest: `0x${string}`;
  typedData?: any;
  preferredMethod?: 'eth_sign' | 'eth_signTypedData_v4' | 'eth_signTypedData_v3';
}): Promise<{ signature: `0x${string}`; method: 'eth_sign' | 'eth_signTypedData_v4' | 'eth_signTypedData_v3' }> {
  const { provider, signerAddress, digest, typedData, preferredMethod } = params;
  const tryEthSign = async () => {
    const sig = (await provider.request?.({
      method: 'eth_sign',
      params: [signerAddress, digest],
    })) as `0x${string}`;
    return sig;
  };

  const trySignTypedDataV4 = async () => {
    if (!typedData) throw new Error('typedData is required for eth_signTypedData_v4');
    const sig = (await provider.request?.({
      method: 'eth_signTypedData_v4',
      params: [signerAddress, JSON.stringify(typedData)],
    })) as `0x${string}`;
    return sig;
  };

  const trySignTypedDataV3 = async () => {
    if (!typedData) throw new Error('typedData is required for eth_signTypedData_v3');
    const sig = (await provider.request?.({
      method: 'eth_signTypedData_v3',
      params: [signerAddress, JSON.stringify(typedData)],
    })) as `0x${string}`;
    return sig;
  };

  // IMPORTANT:
  // ERC-8092 verifies signatures over the raw EIP-712 digest.
  // - `eth_sign` on the digest works.
  // - `eth_signTypedData_v4/v3` also works (it signs the same digest).
  // - `personal_sign` prefixes the message and will NOT validate on-chain for this scheme.
  const baseOrder: Array<'eth_sign' | 'eth_signTypedData_v4' | 'eth_signTypedData_v3'> = [
    'eth_sign',
    'eth_signTypedData_v4',
    'eth_signTypedData_v3',
  ];
  const order = preferredMethod
    ? [preferredMethod, ...baseOrder.filter((m) => m !== preferredMethod)]
    : baseOrder;

  let lastErr: any = null;
  for (const method of order) {
    try {
      const signature =
        method === 'eth_sign'
          ? await tryEthSign()
          : method === 'eth_signTypedData_v4'
            ? await trySignTypedDataV4()
            : await trySignTypedDataV3();
      if (signature && signature !== '0x') return { signature, method };
    } catch (e) {
      lastErr = e;
    }
  }
  throw (
    lastErr ??
    new Error(
      'Failed to sign association. This wallet must support eth_sign or eth_signTypedData_v4/v3 for ERC-8092 association approvals.',
    )
  );
}

function buildAssociationTypedData(params: {
  initiatorInterop: string;
  approverInterop: string;
  validAt: number;
  validUntil: number;
  interfaceId: `0x${string}`;
  data: `0x${string}`;
}) {
  const { initiatorInterop, approverInterop, validAt, validUntil, interfaceId, data } = params;
  return {
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
      initiator: initiatorInterop,
      approver: approverInterop,
      validAt,
      validUntil,
      interfaceId,
      data,
    },
  };
}

async function getConnectedEoaAddress(provider: any): Promise<`0x${string}`> {
  const accounts = (await provider?.request?.({ method: 'eth_accounts', params: [] })) as unknown;
  const first = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
  if (!first || typeof first !== 'string' || !first.startsWith('0x')) {
    throw new Error('Wallet is not connected (no eth_accounts available)');
  }
  return getAddress(first) as `0x${string}`;
}

async function isErc1271ValidSignature(params: {
  chain: Chain;
  contract: `0x${string}`;
  digest: `0x${string}`;
  signature: `0x${string}`;
}): Promise<boolean> {
  const { chain, contract, digest, signature } = params;
  const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
  if (!rpcUrl) return false;

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as any;
  const bytecode = (await publicClient.getBytecode({ address: contract }).catch(() => null)) as
    | `0x${string}`
    | null;
  if (!bytecode || bytecode === '0x') return false;

  // Standard ERC-1271 magic value.
  const ERC1271_ABI = [
    {
      type: 'function',
      name: 'isValidSignature',
      stateMutability: 'view',
      inputs: [
        { name: 'hash', type: 'bytes32' },
        { name: 'signature', type: 'bytes' },
      ],
      outputs: [{ name: 'magicValue', type: 'bytes4' }],
    },
  ] as const;

  const magic = (await publicClient.readContract({
    address: contract,
    abi: ERC1271_ABI,
    functionName: 'isValidSignature',
    args: [digest, signature],
  }).catch(() => null)) as `0x${string}` | null;

  return String(magic || '').toLowerCase() === '0x1626ba7e';
}

type AgentSearchOption = {
  key: string; // `${chainId}:${agentId}`
  chainId: number;
  agentId: string;
  agentName: string | null;
  image: string | null;
  did: string;
};

type TaskThread = {
  key: string;
  taskId: string | null;
  taskType: string;
  messages: Message[];
  lastMessage: Message;
  lastTimestamp: number;
  unreadCount: number;
};

function normalizeDid(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let out = raw;
  // Handle 0..2 rounds of percent-decoding to cover did%3A... and did%253A...
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch {
      break;
    }
  }
  // Fallback for partially-encoded values
  out = out.replace(/%3A/gi, ':');
  return out;
}

function displayDid(value: unknown): string {
  const did = normalizeDid(value);
  return did || '—';
}

export default function MessagesPage() {
  const auth = useAuth();
  const { connected: walletConnected, address: walletAddress, privateKeyMode, loading, eip1193Provider } = useWallet();
  const { ownedAgents: cachedOwnedAgents, loading: ownedAgentsLoading } = useOwnedAgents();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [selectedMessageType, setSelectedMessageType] = useState<InboxTaskType>('general');
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('');
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);
  const [folderSearch, setFolderSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [mailboxMode, setMailboxMode] = useState<'inbox' | 'sent'>('inbox');

  const [selectedIntentType, setSelectedIntentType] = useState<InboxIntentType>('general');
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeTaskId, setComposeTaskId] = useState<string | null>(null);
  const [composeToAgent, setComposeToAgent] = useState<AgentSearchOption | null>(null);
  const [composeToAgentInput, setComposeToAgentInput] = useState('');
  const [composeToAgentOptions, setComposeToAgentOptions] = useState<AgentSearchOption[]>([]);
  const [composeToAgentLoading, setComposeToAgentLoading] = useState(false);
  const [composeToAgentCard, setComposeToAgentCard] = useState<any | null>(null);
  const [composeToAgentCardLoading, setComposeToAgentCardLoading] = useState(false);

  const [feedbackRequestComment, setFeedbackRequestComment] = useState('');
  const [validationRequestKind, setValidationRequestKind] = useState<ValidationClaimType>('compliance');
  const [validationRequestDetails, setValidationRequestDetails] = useState('');
  const [validationRequestDomain, setValidationRequestDomain] = useState('');
  const [associationRequestType, setAssociationRequestType] = useState<number>(0); // AssocType.Membership
  const [associationRequestDescription, setAssociationRequestDescription] = useState('');

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveExpiryDays, setApproveExpiryDays] = useState<number>(30);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveSuccess, setApproveSuccess] = useState<string | null>(null);
  // Approval flow does not issue on-chain feedbackAuth; it only marks the request approved in ATP DB.

  const [feedbackAuthLoading, setFeedbackAuthLoading] = useState(false);
  const [feedbackAuthError, setFeedbackAuthError] = useState<string | null>(null);
  const [feedbackAuthValue, setFeedbackAuthValue] = useState<string | null>(null);

  const [giveFeedbackOpen, setGiveFeedbackOpen] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<number>(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);

  // Validation dialog state
  const [validateDialogOpen, setValidateDialogOpen] = useState(false);
  const [validationResponseLoading, setValidationResponseLoading] = useState(false);
  const [validationResponseError, setValidationResponseError] = useState<string | null>(null);
  const [validationRequestHash, setValidationRequestHash] = useState<string | null>(null);
  const [validationRequestStatus, setValidationRequestStatus] = useState<any | null>(null);
  const [checkingValidationRequest, setCheckingValidationRequest] = useState(false);
  const [validationResponseScore, setValidationResponseScore] = useState<number>(100);
  const [validationResponseAlreadySubmitted, setValidationResponseAlreadySubmitted] = useState(false);

  const isValidationRequestTaskType = useCallback((t: InboxTaskType) => {
    return t === 'name_validation_request' || t === 'account_validation_request' || t === 'app_validation_request';
  }, []);

  const resolvePlainAddress = useCallback((value: unknown): `0x${string}` | null => {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (!v) return null;
    if (v.startsWith('eip155:')) {
      const parts = v.split(':');
      const addr = parts[2];
      if (addr && addr.startsWith('0x')) return getAddress(addr) as `0x${string}`;
      return null;
    }
    if (v.includes(':')) {
      const parts = v.split(':');
      const last = parts[parts.length - 1];
      if (last && last.startsWith('0x')) return getAddress(last) as `0x${string}`;
      return null;
    }
    if (v.startsWith('0x')) return getAddress(v) as `0x${string}`;
    return null;
  }, []);

  const [approveAssociationOpen, setApproveAssociationOpen] = useState(false);
  const [approveAssociationLoading, setApproveAssociationLoading] = useState(false);
  const [approveAssociationError, setApproveAssociationError] = useState<string | null>(null);
  const [approveAssociationPayload, setApproveAssociationPayload] =
    useState<AssociationRequestPayload | null>(null);

  const fetchMessages = useCallback(async (agentKeyOverride?: string) => {
    const key = agentKeyOverride ?? selectedAgentKey;
    if (!key) {
      setMessages([]);
      return;
    }

    const [chainIdStr, agentId] = key.split(':');
    if (!chainIdStr || !agentId) {
      setError('Select an agent to view messages.');
      setMessages([]);
      return;
    }
    const chainIdNum = parseInt(chainIdStr, 10);
    const agentDid = buildDid8004(chainIdNum || 0, Number(agentId));

    setLoadingMessages(true);
    setError(null);

    try {
      const response = await fetch(`/api/messages?agentDid=${encodeURIComponent(agentDid)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch messages');
      }

      const data = await response.json();
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (err: any) {
      console.error('[Messages] Failed to fetch messages:', err);
      setError(err?.message || 'Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }, [selectedAgentKey]);

  useEffect(() => {
    if (!selectedAgentKey && cachedOwnedAgents.length > 0) {
      setSelectedAgentKey(`${cachedOwnedAgents[0].chainId}:${cachedOwnedAgents[0].agentId}`);
    }
  }, [cachedOwnedAgents, selectedAgentKey]);

  useEffect(() => {
    if (selectedAgentKey) {
      fetchMessages();
    }
  }, [selectedAgentKey, fetchMessages]);

  const selectedFolderAgent = useMemo(() => {
    if (!selectedAgentKey) return null;
    return cachedOwnedAgents.find((a) => `${a.chainId}:${a.agentId}` === selectedAgentKey) ?? null;
  }, [cachedOwnedAgents, selectedAgentKey]);

  const selectedFromAgentDid = useMemo(() => {
    if (!selectedFolderAgent) return null;
    return buildDid8004(selectedFolderAgent.chainId || 0, Number(selectedFolderAgent.agentId));
  }, [selectedFolderAgent]);

  const isInboxMessage = useCallback(
    (m: Message) => {
      if (!selectedFromAgentDid) return false;
      const selectedDid = normalizeDid(selectedFromAgentDid);
      const toDid = normalizeDid(m.toAgentDid);
      return (
        (toDid && toDid === selectedDid) ||
        (!toDid && Boolean(selectedFolderAgent?.agentName) && (m.toAgentName || '') === selectedFolderAgent?.agentName)
      );
    },
    [selectedFromAgentDid, selectedFolderAgent?.agentName],
  );

  const isSentMessage = useCallback(
    (m: Message) => {
      if (!selectedFromAgentDid) return false;
      const selectedDid = normalizeDid(selectedFromAgentDid);
      const fromDid = normalizeDid(m.fromAgentDid);
      return (
        (fromDid && fromDid === selectedDid) ||
        (!fromDid && Boolean(selectedFolderAgent?.agentName) && (m.fromAgentName || '') === selectedFolderAgent?.agentName)
      );
    },
    [selectedFromAgentDid, selectedFolderAgent?.agentName],
  );

  const getThreadKeyForMessage = useCallback((m: Message): string => {
    const rawTaskId = (m.taskId ?? m.contextId ?? null) as string | null;
    // Keep stable even if taskType changes; taskId should already be unique enough in our system.
    if (rawTaskId && rawTaskId.trim().length > 0) return `task:${rawTaskId}`;
    return `msg:${m.id}`;
  }, []);

  const buildThreads = useCallback(
    (input: Message[], mode: 'inbox' | 'sent'): TaskThread[] => {
      const map = new Map<string, Message[]>();
      for (const m of input) {
        const key = getThreadKeyForMessage(m);
        const arr = map.get(key);
        if (arr) arr.push(m);
        else map.set(key, [m]);
      }

      const threads: TaskThread[] = [];
      for (const [key, msgs] of map.entries()) {
        const sorted = [...msgs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        const last = sorted[0]!;
        const taskId = (last.taskId ?? last.contextId ?? null) as string | null;
        const taskType = (last.taskType ?? last.contextType ?? 'general') as string;
        const unreadCount =
          mode === 'inbox'
            ? sorted.filter((m) => !m.readAt).length
            : 0;
        threads.push({
          key,
          taskId,
          taskType,
          messages: sorted,
          lastMessage: last,
          lastTimestamp: last.createdAt ?? 0,
          unreadCount,
        });
      }

      return threads.sort((a, b) => (b.lastTimestamp ?? 0) - (a.lastTimestamp ?? 0));
    },
    [getThreadKeyForMessage],
  );

  const inboxThreads = useMemo(
    () => buildThreads(messages.filter(isInboxMessage), 'inbox'),
    [messages, isInboxMessage, buildThreads],
  );
  const sentThreads = useMemo(
    () => buildThreads(messages.filter(isSentMessage), 'sent'),
    [messages, isSentMessage, buildThreads],
  );
  const inboxCount = inboxThreads.length;
  const sentCount = sentThreads.length;

  const selectedThread = useMemo(() => {
    if (!selectedTaskKey) return null;
    const all = mailboxMode === 'sent' ? sentThreads : inboxThreads;
    return all.find((t) => t.key === selectedTaskKey) ?? null;
  }, [selectedTaskKey, mailboxMode, inboxThreads, sentThreads]);

  const selectedMessage = useMemo(() => selectedThread?.lastMessage ?? null, [selectedThread]);

  const selectedFeedbackApprovedMessage = useMemo(() => {
    if (!selectedThread) return null;
    return selectedThread.messages.find((m) => m.contextType === 'feedback_request_approved') ?? null;
  }, [selectedThread]);

  const selectedFeedbackRequestMessage = useMemo(() => {
    if (!selectedThread) return null;
    // Prefer the oldest feedback_request message in the thread (the original request).
    for (let i = selectedThread.messages.length - 1; i >= 0; i--) {
      const m = selectedThread.messages[i]!;
      if (m.contextType === 'feedback_auth_request') return m;
    }
    return null;
  }, [selectedThread]);

  const selectedValidationRequestMessage = useMemo(() => {
    if (!selectedThread) return null;
    // Prefer the oldest validation_request message in the thread.
    for (let i = selectedThread.messages.length - 1; i >= 0; i--) {
      const m = selectedThread.messages[i]!;
      if (m.contextType === 'validation_request') return m;
    }
    // Fallback: detect validation request by parsing the message body block.
    for (let i = selectedThread.messages.length - 1; i >= 0; i--) {
      const m = selectedThread.messages[i]!;
      const blk = extractValidationRequestBlockFromBody(m.body || '');
      if (blk) return m;
    }
    return null;
  }, [selectedThread]);

  const selectedValidationRequestBlock = useMemo(() => {
    const body = selectedValidationRequestMessage?.body || '';
    return extractValidationRequestBlockFromBody(body);
  }, [selectedValidationRequestMessage]);

  const selectedAssociationRequestMessage = useMemo(() => {
    if (!selectedThread) return null;
    // Prefer the newest association_request message (payload may be missing if request prep failed,
    // but we still want to surface an "Approve Association" action + error state).
    return selectedThread.messages.find((m) => m.contextType === 'association_request') ?? null;
  }, [selectedThread]);

  const selectedFolderDid = useMemo(() => {
    if (!selectedFolderAgent) return null;
    return buildDid8004(selectedFolderAgent.chainId, selectedFolderAgent.agentId);
  }, [selectedFolderAgent]);

  const canValidateSelectedThread = useMemo(() => {
    if (!selectedFolderDid) return false;
    if (!selectedValidationRequestMessage) return false;
    // Only allow "Validate" when the currently selected folder agent is the validator for this request.
    // Prefer the explicit block's validatorDid if present; fallback to message.toAgentDid.
    const validatorDidFromBlock = normalizeDid(selectedValidationRequestBlock?.validatorDid || '');
    const validatorDidFromMsg = normalizeDid(selectedValidationRequestMessage.toAgentDid || '');
    const expectedValidatorDid = validatorDidFromBlock || validatorDidFromMsg;
    if (!expectedValidatorDid) return false;
    return normalizeDid(selectedFolderDid) === expectedValidatorDid;
  }, [selectedFolderDid, selectedValidationRequestMessage, selectedValidationRequestBlock]);

  const canApproveAssociation = useMemo(() => {
    if (mailboxMode !== 'inbox') return false;
    if (!selectedAssociationRequestMessage) return false;
    if (!selectedFolderDid) return false;
    const toDid = normalizeDid(selectedAssociationRequestMessage.toAgentDid);
    return Boolean(toDid) && toDid === normalizeDid(selectedFolderDid);
  }, [mailboxMode, selectedAssociationRequestMessage, selectedFolderDid]);

  const selectedMessageTargetDid = useMemo(() => {
    // For feedback_request_approved, the sender is the target agent that will issue feedbackAuth.
    const did = normalizeDid(selectedFeedbackApprovedMessage?.fromAgentDid);
    return did || null;
  }, [selectedFeedbackApprovedMessage]);

  const selectedMessageTargetParsed = useMemo(() => {
    if (!selectedMessageTargetDid) return null;
    if (!selectedMessageTargetDid.startsWith('did:8004:')) return null;
    try {
      return parseDid8004(selectedMessageTargetDid);
    } catch {
      return null;
    }
  }, [selectedMessageTargetDid]);

  const selectedMessageFeedbackRequestId = useMemo(() => {
    const raw = selectedFeedbackApprovedMessage?.contextId || selectedFeedbackRequestMessage?.contextId || null;
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [selectedFeedbackApprovedMessage, selectedFeedbackRequestMessage]);

  const requestFeedbackAuthForSelectedMessage = useCallback(async () => {
    if (!selectedFeedbackApprovedMessage) return;
    if (!walletAddress) {
      setFeedbackAuthError('Wallet address not available. Please connect.');
      return;
    }
    if (!selectedMessageTargetDid || !selectedMessageTargetParsed) {
      setFeedbackAuthError('Target agent DID is missing or invalid.');
      return;
    }
    if (!selectedMessageFeedbackRequestId) {
      setFeedbackAuthError('feedbackRequestId is missing on this message.');
      return;
    }

    setFeedbackAuthLoading(true);
    setFeedbackAuthError(null);
    setFeedbackAuthValue(null);

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(selectedMessageTargetDid)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: 'oasf:trust.feedback.authorization',
          payload: {
            // Worker will derive clientAddress/agentId/chainId from the stored request record
            feedbackRequestId: selectedMessageFeedbackRequestId,
            clientAddress: walletAddress,
            chainId: selectedMessageTargetParsed.chainId,
            expirySeconds: 30 * 24 * 60 * 60,
          },
          metadata: {
            source: 'admin-app',
            timestamp: new Date().toISOString(),
          },
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || data?.response?.error || 'Failed to request feedback authorization');
      }

      const auth =
        data?.response?.feedbackAuth ??
        data?.feedbackAuth ??
        null;

      if (!auth || (typeof auth === 'string' && auth.trim() === '0x0')) {
        throw new Error('No feedbackAuth returned');
      }

      // If the agent returned a delegationAssociation, complete initiator signature and store on-chain.
      // This uses ERC-8092 digest signing (eth_sign) and the existing /api/associate prepare endpoint.
      const delegationAssociation =
        data?.response?.delegationAssociation ??
        data?.delegationAssociation ??
        null;
      if (delegationAssociation && eip1193Provider) {
        try {
          const assocId = String(delegationAssociation.associationId || '').trim() as `0x${string}`;
          const approverAddress = getAddress(String(delegationAssociation.approverAddress || '')) as `0x${string}`;
          const initiatorAddress = getAddress(String(delegationAssociation.initiatorAddress || walletAddress)) as `0x${string}`;
          const assocData = String(delegationAssociation.data || '').trim() as `0x${string}`;
          const validAt = Number(delegationAssociation.validAt ?? 0);
          const approverSignature = String(delegationAssociation.approverSignature || '').trim() as `0x${string}`;

          if (initiatorAddress.toLowerCase() !== walletAddress.toLowerCase()) {
            throw new Error(`delegationAssociation initiatorAddress (${initiatorAddress}) does not match wallet (${walletAddress})`);
          }
          if (assocId && assocId !== '0x' && assocData && assocData !== '0x' && approverSignature && approverSignature !== '0x') {
            const initiatorSignature = (await eip1193Provider.request?.({
              method: 'eth_sign',
              params: [walletAddress, assocId],
            })) as `0x${string}`;

            await finalizeAssociationWithWallet({
              chain: getChainById(selectedMessageTargetParsed.chainId) as any,
              mode: 'eoa',
              ethereumProvider: eip1193Provider as any,
              account: getAddress(walletAddress) as `0x${string}`,
              requesterDid: selectedMessageTargetDid,
              initiatorAddress: getAddress(walletAddress) as `0x${string}`,
              approverAddress,
              assocType: AssocType.Delegation,
              description: 'feedbackAuth delegation',
              validAt,
              data: assocData,
              initiatorSignature,
              approverSignature,
              onStatusUpdate: (msg: string) => console.log('[feedbackAuth delegation]', msg),
            } as any);
          }
        } catch (assocErr: any) {
          console.warn('[Messages] Failed to store feedbackAuth delegation association:', assocErr);
          // Don't fail feedbackAuth issuance UI on association storage failure.
        }
      }

      setFeedbackAuthValue(String(auth));
    } catch (err: any) {
      setFeedbackAuthError(err?.message || 'Failed to request feedback authorization');
    } finally {
      setFeedbackAuthLoading(false);
    }
  }, [
    selectedFeedbackApprovedMessage,
    selectedMessageTargetDid,
    selectedMessageTargetParsed,
    selectedMessageFeedbackRequestId,
    walletAddress,
    eip1193Provider,
  ]);

  // Check if validation request exists in Validation Registry
  const checkValidationRequest = useCallback(async () => {
    const msg = selectedValidationRequestMessage;
    if (!msg) return;
    if (!msg.fromAgentDid || !msg.toAgentDid) return;
    if (!selectedFolderAgent) return;
    const blk = selectedValidationRequestBlock;

    setCheckingValidationRequest(true);
    setValidationRequestHash(null);
    setValidationRequestStatus(null);

    try {
      // If the message contains a validation_request block, prefer its requestHash.
      const expectedRequestHash =
        typeof blk?.requestHash === 'string' && blk.requestHash.startsWith('0x') ? blk.requestHash : null;

      // Parse the from agent DID (the agent being validated)
      const fromDid = normalizeDid(msg.fromAgentDid);
      if (!fromDid.startsWith('did:8004:')) {
        setValidationResponseError('From agent DID is not a valid did:8004');
        return;
      }

      const fromParsed = parseDid8004(fromDid);
      
      // Get validation requests for the from agent (the agent being validated)
      const validationsResponse = await fetch(`/api/agents/${encodeURIComponent(fromDid)}/validations`);
      if (!validationsResponse.ok) {
        throw new Error('Failed to fetch validation requests');
      }
      
      const validationsData = await validationsResponse.json();
      const pendingValidations = Array.isArray(validationsData?.pending) ? validationsData.pending : [];
      const completedValidations = Array.isArray(validationsData?.completed) ? validationsData.completed : [];
      
      // Check both pending and completed validations for the request
      const allValidations = [...pendingValidations, ...completedValidations];
      const filtered = expectedRequestHash
        ? allValidations.filter((v: any) => String(v?.requestHash || '').toLowerCase() === expectedRequestHash.toLowerCase())
        : allValidations;
      
      if (filtered.length > 0) {
        // Sort by lastUpdate descending (most recent first)
        const sorted = [...filtered].sort((a: any, b: any) => {
          const aTime = typeof a.lastUpdate === 'bigint' ? Number(a.lastUpdate) : (a.lastUpdate || 0);
          const bTime = typeof b.lastUpdate === 'bigint' ? Number(b.lastUpdate) : (b.lastUpdate || 0);
          return bTime - aTime;
        });
        const mostRecent = sorted[0];
        
        // Check if response has already been given (response !== 0 means it's been processed)
        if (mostRecent.response !== undefined && mostRecent.response !== 0 && mostRecent.response !== '0') {
          setValidationRequestHash(mostRecent.requestHash);
          setValidationRequestStatus(mostRecent);
          setValidationResponseAlreadySubmitted(true);
        } else {
          setValidationResponseAlreadySubmitted(false);
        }
        
        setValidationRequestHash(mostRecent.requestHash);
        setValidationRequestStatus(mostRecent);
      } else {
        setValidationResponseError(
          expectedRequestHash
            ? `No on-chain validation request found for this requestHash (${expectedRequestHash}).`
            : 'No validation requests found in Validation Registry for this agent. The on-chain validation request may not have been created yet.',
        );
      }
    } catch (err: any) {
      setValidationResponseError(err?.message || 'Failed to check validation request');
    } finally {
      setCheckingValidationRequest(false);
    }
  }, [selectedValidationRequestMessage, selectedValidationRequestBlock, selectedFolderAgent]);

  // Open validate dialog and check for validation request
  const handleOpenValidateDialog = useCallback(() => {
    setValidateDialogOpen(true);
    setValidationResponseError(null);
    setValidationRequestHash(null);
    setValidationRequestStatus(null);
    setValidationResponseAlreadySubmitted(false);
    void checkValidationRequest();
  }, [checkValidationRequest]);

  // Generate a simple task ID (ULID-like but simpler)
  const generateTaskId = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 12);
    return `${timestamp}${random}`;
  };

  // Submit validation response via A2A endpoint (similar to admin-tools)
  const handleSubmitValidationResponse = useCallback(async (responseScore: number) => {
    const msg = selectedValidationRequestMessage;
    if (!validationRequestHash || !selectedFolderAgent || !msg || !validationRequestStatus) return;
    
    // Check if response already exists
    if (validationRequestStatus.response !== undefined && validationRequestStatus.response !== 0 && validationRequestStatus.response !== '0') {
      setValidationResponseError(`Validation response already submitted (response: ${validationRequestStatus.response}). Cannot submit again.`);
      return;
    }

    if (!msg.fromAgentDid) {
      setValidationResponseError('From agent DID is required');
      return;
    }

    setValidationResponseLoading(true);
    setValidationResponseError(null);

    try {
      // Parse from agent DID to get agentId
      const fromDid = normalizeDid(msg.fromAgentDid);
      if (!fromDid.startsWith('did:8004:')) {
        throw new Error('From agent DID is not a valid did:8004');
      }
      const fromParsed = parseDid8004(fromDid);
      const requestingAgentId = fromParsed.agentId.toString();

      // Get validation kind from message metadata (metadata is stored in message context, check API response structure)
      // For now, use defaults - can be enhanced to parse from message body or context
      const validationKind = 'compliance';
      const validationDetails = 'Validation Request';

      const threadTaskId =
        (msg as any).taskId ??
        (msg as any).task_id ??
        (msg as any).contextId ??
        (msg as any).context_id ??
        generateTaskId();

      // Generate ValidationResult structure similar to name-validation validator
      const validationResult = {
        kind: 'erc8004.validation.request@1' as const,
        specVersion: '1.0',
        requestHash: validationRequestHash,
        agentId: requestingAgentId,
        chainId: selectedFolderAgent.chainId,
        validationRegistry: validationRequestStatus.validationRegistry || '',
        requesterAddress: validationRequestStatus.requesterAddress || '',
        validatorAddress: validationRequestStatus.validatorAddress || selectedFolderAgent.agentAccount || '',
        taskId: threadTaskId,
        createdAt: new Date().toISOString(),
        claim: {
          type: validationKind,
          text: validationDetails,
        },
        criteria: [
          {
            id: 'c1',
            name: 'Validation criteria checked',
            method: 'manual.validation',
            passCondition: 'Validator reviewed and approved',
          },
          {
            id: 'c2',
            name: 'On-chain response submitted',
            method: 'aa.validationResponse',
            passCondition: 'txHash exists',
          },
        ],
        success: responseScore >= 50, // Consider 50+ as success
        response: responseScore,
      };

      // Upload validation result to IPFS
      const jsonBlob = new Blob([JSON.stringify(validationResult, null, 2)], { type: 'application/json' });
      const formData = new FormData();
      formData.append('file', jsonBlob, 'validation-response.json');

      const ipfsResponse = await fetch('/api/ipfs/upload', {
        method: 'POST',
        body: formData,
      });

      if (!ipfsResponse.ok) {
        throw new Error('Failed to upload validation response to IPFS');
      }

      const ipfsResult = await ipfsResponse.json();
      const finalResponseUri = ipfsResult.url || ipfsResult.tokenUri || `ipfs://${ipfsResult.cid}`;

      // Get current agent's A2A endpoint
      // Use decoded DID; we URL-encode exactly once when building request URLs.
      const currentAgentDid = buildDid8004(selectedFolderAgent.chainId, selectedFolderAgent.agentId, { encode: false });
      const agentResponse = await fetch(`/api/agents/${encodeURIComponent(currentAgentDid)}`);
      if (!agentResponse.ok) {
        throw new Error('Failed to fetch current agent details');
      }
      const agentData = await agentResponse.json();
      
      // Extract A2A endpoint from agent data
      let a2aEndpoint: string | null = null;
      try {
        const rawJson = agentData.rawJson;
        if (rawJson && typeof rawJson === 'string') {
          const registration = JSON.parse(rawJson);
          const endpoints = Array.isArray(registration?.endpoints) ? registration.endpoints : [];
          const a2a = endpoints.find((e: any) => e && typeof e.name === 'string' && e.name.toLowerCase() === 'a2a');
          if (a2a && typeof a2a.endpoint === 'string') {
            a2aEndpoint = a2a.endpoint;
          }
        }
      } catch {
        // Ignore parse errors
      }

      if (!a2aEndpoint) {
        throw new Error('Current agent A2A endpoint is not configured. Please configure it in admin-tools.');
      }

      // Send validation response via A2A endpoint
      const response = await fetch('/api/a2a/send-validation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          a2aEndpoint,
          skillId: 'oasf:trust.validate.name',
          message: `Process validation request for agent ${requestingAgentId}`,
          payload: {
            agentId: requestingAgentId,
            chainId: selectedFolderAgent.chainId,
            requestHash: validationRequestHash,
            response: responseScore,
            responseUri: finalResponseUri,
          },
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || data?.response?.error || 'Failed to submit validation response');
      }

      // Reply back to requester in the same task thread (this is what shows up in Inbox UI).
      // Keep contextType as 'validation_request' so ATP threads it under the original task.
      const replyBody = [
        `Validation response submitted.`,
        ``,
        `requestHash: ${validationRequestHash}`,
        `score: ${responseScore}`,
        `responseUri: ${finalResponseUri}`,
        ``,
        `[validation_response]`,
        JSON.stringify(
          {
            kind: 'erc8004.validation.response@1',
            chainId: selectedFolderAgent.chainId,
            requesterDid: msg.fromAgentDid,
            validatorDid: currentAgentDid,
            requestHash: validationRequestHash,
            response: responseScore,
            responseUri: finalResponseUri,
            taskId: threadTaskId,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        `[/validation_response]`,
      ].join('\n');

      const replyRes = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'validation_request',
          subject: `Validation Response: ${responseScore}`,
          content: replyBody,
          fromClientAddress: walletAddress,
          fromAgentDid: currentAgentDid,
          fromAgentName: selectedFolderAgent.agentName || null,
          toAgentDid: msg.fromAgentDid,
          toAgentName: msg.fromAgentName || null,
          taskId: threadTaskId,
          metadata: { source: 'admin-app', timestamp: new Date().toISOString() },
        }),
      });

      const replyJson = await replyRes.json().catch(() => ({}));
      if (!replyRes.ok) {
        throw new Error(replyJson?.error || replyJson?.message || 'Failed to send validation response message');
      }

      setValidateDialogOpen(false);
      setValidationRequestHash(null);
      setValidationRequestStatus(null);
      await fetchMessages();
    } catch (err: any) {
      setValidationResponseError(err?.message || 'Failed to submit validation response');
    } finally {
      setValidationResponseLoading(false);
    }
  }, [
    validationRequestHash,
    selectedFolderAgent,
    selectedValidationRequestMessage,
    validationRequestStatus,
    walletAddress,
    fetchMessages,
    checkValidationRequest,
  ]);

  useEffect(() => {
    // Reset per-message feedbackAuth state whenever selection changes
    setFeedbackAuthLoading(false);
    setFeedbackAuthError(null);
    setFeedbackAuthValue(null);
    setGiveFeedbackOpen(false);
    setFeedbackSuccess(false);
    setFeedbackComment('');
    setFeedbackRating(5);
    // Auto-fetch feedbackAuth for approved messages
    if (selectedFeedbackApprovedMessage) {
      // fire-and-forget; errors shown in UI
      requestFeedbackAuthForSelectedMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskKey]);

  const visibleFolders = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    const agents = cachedOwnedAgents || [];
    if (!q) return agents;
    return agents.filter((a) => {
      const name = (a.agentName || '').toLowerCase();
      const id = String(a.agentId || '').toLowerCase();
      const chainId = String(a.chainId || '').toLowerCase();
      return name.includes(q) || id.includes(q) || chainId.includes(q);
    });
  }, [cachedOwnedAgents, folderSearch]);

  const visibleThreads = useMemo(() => {
    const mailboxThreads = mailboxMode === 'sent' ? sentThreads : inboxThreads;
    const q = messageSearch.trim().toLowerCase();
    if (!q) return mailboxThreads;
    return mailboxThreads.filter((t) =>
      t.messages.some((m) => {
        const subj = (m.subject || '').toLowerCase();
        const body = (m.body || '').toLowerCase();
        const from = (m.fromAgentName || m.fromAgentDid || '').toLowerCase();
        const to = (m.toAgentName || m.toAgentDid || '').toLowerCase();
        return subj.includes(q) || body.includes(q) || from.includes(q) || to.includes(q);
      }),
    );
  }, [mailboxMode, inboxThreads, sentThreads, messageSearch]);

  const handleOpenCompose = useCallback(() => {
    if (!selectedFolderAgent) {
      setError('Select an agent folder first.');
      return;
    }
    setError(null);
    setComposeTaskId(null);
    setComposeToAgent(null);
    setComposeToAgentInput('');
    setComposeToAgentCard(null);
    setSelectedIntentType('general');
    setSelectedMessageType('general');
    setComposeSubject(
      selectedMessageType === 'feedback_auth_request'
        ? 'Request Feedback Permission'
        : selectedMessageType === 'name_validation_request'
          ? 'Request Name Validation'
          : selectedMessageType === 'account_validation_request'
            ? 'Request Account Validation'
            : selectedMessageType === 'app_validation_request'
              ? 'Request App Validation'
          : selectedMessageType === 'association_request'
            ? 'Request Association'
            : '',
    );
    setComposeBody('');
    setFeedbackRequestComment('');
    setValidationRequestKind('compliance');
    setValidationRequestDetails('');
    setValidationRequestDomain('');
    setAssociationRequestType(AssocType.Membership);
    setAssociationRequestDescription('');
    setComposeOpen(true);
  }, [selectedFolderAgent, selectedMessageType]);

  const handleReplyToSelectedTask = useCallback(() => {
    if (!selectedFolderAgent || !selectedFromAgentDid) {
      setError('Select an agent folder first.');
      return;
    }
    if (!selectedThread) {
      setError('Select a task first.');
      return;
    }

    const last = selectedThread.lastMessage;
    const targetDid =
      mailboxMode === 'sent'
        ? normalizeDid(last.toAgentDid)
        : normalizeDid(last.fromAgentDid);

    if (!targetDid || !targetDid.startsWith('did:8004:')) {
      setError('Cannot reply: missing recipient agent DID on this task.');
      return;
    }

    let opt: AgentSearchOption | null = null;
    try {
      const parsed = parseDid8004(targetDid);
      const agentIdStr = String(parsed.agentId);
      opt = {
        key: `${parsed.chainId}:${agentIdStr}`,
        chainId: parsed.chainId,
        agentId: agentIdStr,
        agentName: mailboxMode === 'sent' ? last.toAgentName : last.fromAgentName,
        image: null,
        did: targetDid,
      };
    } catch {
      opt = {
        key: targetDid,
        chainId: DEFAULT_CHAIN_ID,
        agentId: '0',
        agentName: mailboxMode === 'sent' ? last.toAgentName : last.fromAgentName,
        image: null,
        did: targetDid,
      };
    }

    setError(null);
    setComposeTaskId(selectedThread.taskId ?? (last.taskId ?? last.contextId ?? null));
    setComposeToAgent(opt);
    setComposeToAgentInput(opt?.agentName || '');
    setComposeToAgentCard(null);
    setComposeSubject('');
    setComposeBody('');
    // Pin the task type to the current thread's type when possible.
    const threadType = selectedThread.taskType as any;
    const pinnedTaskType =
      threadType === 'feedback_request_approved' ? 'feedback_auth_request' : threadType;
    setSelectedMessageType(pinnedTaskType);
    setSelectedIntentType(
      pinnedTaskType === 'name_validation_request'
        ? 'trust.name_validation'
        : pinnedTaskType === 'account_validation_request'
          ? 'trust.account_validation'
          : pinnedTaskType === 'app_validation_request'
            ? 'trust.app_validation'
        : pinnedTaskType === 'feedback_auth_request'
          ? 'trust.feedback'
          : pinnedTaskType === 'association_request'
            ? 'trust.association'
            : 'general',
    );
    setComposeOpen(true);
  }, [selectedFolderAgent, selectedFromAgentDid, selectedThread, mailboxMode]);

  // Async agent search for "To Agent" autocomplete
  // Always show a default list (latest agents) when the dialog opens, and filter as user types.
  useEffect(() => {
    let cancelled = false;
    const q = composeToAgentInput.trim();

    if (!composeOpen) return;
    
    setComposeToAgentLoading(true);
    (async () => {
      try {
        const buildIntentJson = (intent: InboxIntentType, query: string) => {
          if (intent === 'general') return null;
          const base: any = { intentType: intent };
          if (intent === 'trust.name_validation') base.action = 'validate-name';
          if (intent === 'trust.account_validation') base.action = 'validate-account';
          if (intent === 'trust.app_validation') base.action = 'validate-app';
          if (intent === 'trust.feedback') base.action = 'request-authorization';
          if (intent === 'trust.association') base.action = 'request-attestation';
          if (intent === 'trust.membership') base.action = 'attest-membership';
          if (intent === 'trust.delegation') base.action = 'attest-delegation';
          if (query) base.query = query;
          return JSON.stringify(base);
        };

        // Intent-first: when intent != general, drive agent list via semantic search.
        if (selectedIntentType !== 'general') {
          const mapAgentToOption = (a: any): AgentSearchOption | null => {
            const chainId = typeof a?.chainId === 'number' ? a.chainId : Number(a?.chainId || 0);
            const agentId = a?.agentId != null ? String(a.agentId) : '';
            if (!chainId || !agentId) return null;
            const didRaw =
              typeof a?.did === 'string' && a.did ? normalizeDid(a.did) : buildDid8004(chainId, Number(agentId));
            const did = didRaw || buildDid8004(chainId, Number(agentId));
            return {
              key: `${chainId}:${agentId}`,
              chainId,
              agentId,
              agentName: a?.agentName ?? null,
              image: a?.image ?? null,
              did,
            } as AgentSearchOption;
          };

          // Helper to force-include known validator agents by name (bypasses semantic-search limitations).
          const fetchAgentsByName = async (name: string): Promise<AgentSearchOption[]> => {
            const url = `/api/agents/search?query=${encodeURIComponent(name)}&pageSize=5&orderBy=createdAtTime&orderDirection=DESC`;
            const r = await fetch(url, { cache: 'no-store' });
            if (!r.ok) return [];
            const d = await r.json().catch(() => ({}));
            const agents = Array.isArray(d?.agents) ? d.agents : [];
            return agents.map(mapAgentToOption).filter(Boolean) as AgentSearchOption[];
          };

          const intentJson = buildIntentJson(selectedIntentType, q);
          const response = await fetch('/api/agents/semantic-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intentJson, topK: 25 }),
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new Error(`Failed to semantic search agents (${response.status})`);
          }
          const data = await response.json().catch(() => ({}));
          const matches = Array.isArray(data?.matches) ? data.matches : [];
          const mappedSemantic: AgentSearchOption[] = matches
            .map((m: any) => mapAgentToOption(m?.agent))
            .filter(Boolean) as AgentSearchOption[];

          // For validation intents, always include the canonical validator agents.
          // This ensures the "To Agent" list contains `name-validation.8004-agent.eth` even if semantic search returns few matches.
          const mappedPinned =
            selectedIntentType === 'trust.name_validation'
              ? await fetchAgentsByName('name-validation')
              : selectedIntentType === 'trust.account_validation'
                ? await fetchAgentsByName('account-validator')
                : selectedIntentType === 'trust.app_validation'
                  ? await fetchAgentsByName('app-validator')
                  : [];

          const merged = (() => {
            const byKey = new Map<string, AgentSearchOption>();
            for (const opt of [...mappedPinned, ...mappedSemantic]) {
              byKey.set(opt.key, opt);
            }
            return Array.from(byKey.values());
          })();

          if (cancelled) return;
          setComposeToAgentOptions(merged);
          return;
        }

        // General: keyword search if user typed, else default list.
        if (q.length > 0) {
          const url = `/api/agents/search?query=${encodeURIComponent(q)}&pageSize=50&orderBy=createdAtTime&orderDirection=DESC`;
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`Failed to search agents (${response.status})`);
          }
          const data = await response.json();
          const agents = Array.isArray(data?.agents) ? data.agents : [];
        
          const mapped: AgentSearchOption[] = agents
            .map((a: any) => {
              const chainId = typeof a?.chainId === 'number' ? a.chainId : Number(a?.chainId || 0);
              const agentId = a?.agentId != null ? String(a.agentId) : '';
              if (!chainId || !agentId) return null;
              const did = buildDid8004(chainId, Number(agentId));
              return {
                key: `${chainId}:${agentId}`,
                chainId,
                agentId,
                agentName: a?.agentName ?? null,
                image: a?.image ?? null,
                did,
              } as AgentSearchOption;
            })
            .filter(Boolean) as AgentSearchOption[];

          if (cancelled) return;
          setComposeToAgentOptions(mapped);
          return;
        }

        // Fallback: default list (latest agents).
        const response = await fetch(
          `/api/agents/search?pageSize=50&orderBy=createdAtTime&orderDirection=DESC`,
          { cache: 'no-store' },
        );
        if (!response.ok) {
          throw new Error(`Failed to search agents (${response.status})`);
        }
        const data = await response.json();
        const agents = Array.isArray(data?.agents) ? data.agents : [];
        const mapped: AgentSearchOption[] = agents
          .map((a: any) => {
            const chainId = typeof a?.chainId === 'number' ? a.chainId : Number(a?.chainId || 0);
            const agentId = a?.agentId != null ? String(a.agentId) : '';
            if (!chainId || !agentId) return null;
            const did = buildDid8004(chainId, Number(agentId));
            return {
              key: `${chainId}:${agentId}`,
              chainId,
              agentId,
              agentName: a?.agentName ?? null,
              image: a?.image ?? null,
              did,
            } as AgentSearchOption;
          })
          .filter(Boolean) as AgentSearchOption[];

        if (cancelled) return;
        setComposeToAgentOptions(mapped);
      } catch (e) {
        if (!cancelled) {
          setComposeToAgentOptions([]);
        }
      } finally {
        if (!cancelled) setComposeToAgentLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [composeOpen, composeToAgentInput, selectedIntentType]);

  // Fetch the recipient's agent card so we can offer only supported task/message types.
  useEffect(() => {
    let cancelled = false;
    if (!composeOpen || !composeToAgent?.did) {
      setComposeToAgentCard(null);
      setComposeToAgentCardLoading(false);
      return;
    }

    setComposeToAgentCardLoading(true);
    (async () => {
      try {
        const did = normalizeDid(composeToAgent.did);
        const resp = await fetch(`/api/agents/${encodeURIComponent(did)}/card`, {
          cache: 'no-store',
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || data?.message || `Failed to fetch agent card (${resp.status})`);
        if (cancelled) return;
        setComposeToAgentCard(data?.card ?? null);
      } catch (e) {
        if (!cancelled) setComposeToAgentCard(null);
      } finally {
        if (!cancelled) setComposeToAgentCardLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [composeOpen, composeToAgent?.did]);

  // (removed) specialized validation-agent preload: To-Agent is chosen first now, so we always load a default list.

  const handleSendMessage = useCallback(async () => {
    if (!selectedFolderAgent || !selectedFromAgentDid) {
      setError('Select an agent folder first.');
      return;
    }

    if (!composeToAgent) {
      setError('Recipient is required. Select an agent.');
      return;
    }

    setSending(true);
    setError(null);

    try {
      if (selectedMessageType === 'feedback_auth_request') {
        const comment = feedbackRequestComment.trim();
        if (!comment) {
          throw new Error('Reason is required for a feedback request.');
        }

        const response = await fetch('/api/agents-atp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skillId: 'atp.feedback.request',
            message: `Feedback Request: ${comment}`,
            payload: {
              clientAddress: walletAddress,
              comment,
              fromAgentId: String(selectedFolderAgent.agentId),
              fromAgentChainId: selectedFolderAgent.chainId,
              fromAgentDid: selectedFromAgentDid,
              fromAgentName: selectedFolderAgent.agentName || null,
              toAgentId: String(composeToAgent.agentId),
              toAgentChainId: composeToAgent.chainId,
              toAgentDid: composeToAgent.did,
              toAgentName: composeToAgent.agentName,
            },
            metadata: {
              source: 'admin-app',
              timestamp: new Date().toISOString(),
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || errorData.error || 'Failed to send feedback request');
        }
      } else {
        const content = composeBody.trim();
        if (!content && !isValidationRequestTaskType(selectedMessageType) && selectedMessageType !== 'association_request') {
          throw new Error('Message body is required.');
        }
        let contentToSend =
          content ||
          (selectedMessageType === 'name_validation_request'
            ? `Request name validation (${validationRequestKind})`
            : selectedMessageType === 'account_validation_request'
              ? `Request account validation (${validationRequestKind})`
              : selectedMessageType === 'app_validation_request'
                ? `Request app validation (${validationRequestKind})`
            : selectedMessageType === 'association_request'
              ? 'Request association'
              : '');

        const subject =
          composeSubject.trim() ||
          (selectedMessageType === 'name_validation_request'
            ? `Request Name Validation: ${validationRequestKind}`
            : selectedMessageType === 'account_validation_request'
              ? `Request Account Validation: ${validationRequestKind}`
              : selectedMessageType === 'app_validation_request'
                ? `Request App Validation: ${validationRequestKind}`
            : selectedMessageType === 'association_request'
              ? 'Request Association'
              : 'Message');

        // For association requests: prepare + execute via client wallet (AA + bundler).
        // If approver is a different agent account, we send a message containing the payload
        // and the approver signs + submits later from their inbox.
        if (selectedMessageType === 'association_request') {
          try {
            if (!composeToAgent) {
              throw new Error('To Agent is required for association requests');
            }

            const chainId = selectedFolderAgent.chainId;
            const chain = getChainById(chainId);
            if (!eip1193Provider || !walletAddress) {
              throw new Error('Wallet not connected');
            }
            const signerEoa = await getConnectedEoaAddress(eip1193Provider);

            // Switch to correct chain
            if (eip1193Provider && typeof eip1193Provider.request === 'function') {
              const targetHex = `0x${chainId.toString(16)}`;
              try {
                await eip1193Provider.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: targetHex }],
                });
              } catch (switchErr) {
                console.warn('Failed to switch chain', switchErr);
              }
            }

            const initiatorDid = buildDid8004(chainId, selectedFolderAgent.agentId);

            // IMPORTANT:
            // The association record's initiator/approver addresses must be the *agent accounts* being associated.
            // But in practice some agents are "EOA-owned" and their stored agentAccount may be a smart account
            // that does NOT accept owner signatures (ERC-1271 not configured). In that case we fall back to
            // using the owner EOA as the initiator address so the association is still actionable.
            if (!selectedFolderAgent?.agentAccount) {
              throw new Error(
                'This agent is missing agentAccount. Cannot create an ERC-8092 association request without a concrete initiator account address.',
              );
            }

            let initiatorAddress = getAddress(selectedFolderAgent.agentAccount as `0x${string}`) as `0x${string}`;
            let isEoaOwnedInitiator =
              initiatorAddress.toLowerCase() === String(signerEoa).toLowerCase();

            // Only needed if we are going to immediately submit a self-association from an AA initiator.
            let agentAccountClient: any | null = null;

            // Fetch "To Agent" account address (approverAddress)
            const toAgentDid = composeToAgent.did;
            const toAgentResponse = await fetch(`/api/agents/${encodeURIComponent(toAgentDid)}`);
            if (!toAgentResponse.ok) {
              throw new Error('Failed to fetch To Agent details');
            }
            const toAgentData = await toAgentResponse.json();
            const approverAddressRaw = toAgentData?.agentAccount || toAgentData?.account;
            if (!approverAddressRaw) {
              throw new Error('To Agent account address not found. The agent must have an account address.');
            }
            const approverAddress = getAddress(approverAddressRaw) as `0x${string}`;

            console.log('[Association Request] Creating association:', {
              initiatorDid,
              approverAddress,
              assocType: associationRequestType,
              description: associationRequestDescription,
            });

            // Build record + digest + initiator signature (for later approver consent)
            const validAt = Math.max(0, Math.floor(Date.now() / 1000) - 10);
            const validUntil = 0;
            const interfaceId = '0x00000000' as const;
            const data = encodeAbiParameters(
              parseAbiParameters('uint8 assocType, string description'),
              [associationRequestType, associationRequestDescription || ''],
            ) as `0x${string}`;

            // Compute digest using same scheme as erc8092-sdk (eip712Hash(record))
            const { ethers } = await import('ethers');
            const toMinimalBigEndianBytes = (n: bigint): Uint8Array => {
              if (n === 0n) return new Uint8Array([0]);
              let hex = n.toString(16);
              if (hex.length % 2) hex = `0${hex}`;
              return ethers.getBytes(`0x${hex}`);
            };
            const formatEvmV1 = (chainId: number, address: string): string => {
              const addr = ethers.getAddress(address);
              const chainRef = toMinimalBigEndianBytes(BigInt(chainId));
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
            const buildDigestBundle = async (params: { initiatorAddress: `0x${string}` }) => {
              const initiatorInterop = formatEvmV1(chainId, params.initiatorAddress);
              const approverInterop = formatEvmV1(chainId, approverAddress);
              const typedData = buildAssociationTypedData({
                initiatorInterop,
                approverInterop,
                validAt,
                validUntil,
                interfaceId,
                data,
              });

              const abiCoder = ethers.AbiCoder.defaultAbiCoder();
              const DOMAIN_TYPEHASH = ethers.id('EIP712Domain(string name,string version)');
              const NAME_HASH = ethers.id('AssociatedAccounts');
              const VERSION_HASH = ethers.id('1');
              const MESSAGE_TYPEHASH = ethers.id(
                'AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)',
              );
              const domainSeparator = ethers.keccak256(
                abiCoder.encode(['bytes32', 'bytes32', 'bytes32'], [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH]),
              );
              const hashStruct = ethers.keccak256(
                abiCoder.encode(
                  ['bytes32', 'bytes32', 'bytes32', 'uint40', 'uint40', 'bytes4', 'bytes32'],
                  [
                    MESSAGE_TYPEHASH,
                    ethers.keccak256(initiatorInterop),
                    ethers.keccak256(approverInterop),
                    validAt,
                    validUntil,
                    interfaceId,
                    ethers.keccak256(data),
                  ],
                ),
              );
              const digest = ethers.keccak256(
                ethers.solidityPacked(['bytes2', 'bytes32', 'bytes32'], ['0x1901', domainSeparator, hashStruct]),
              ) as `0x${string}`;

              return { initiatorInterop, approverInterop, typedData, digest };
            };

            let { typedData, digest } = await buildDigestBundle({ initiatorAddress });
            let initiatorSig = await signAssociationDigest({
              provider: eip1193Provider,
              signerAddress: signerEoa,
              digest,
              typedData,
            });
            const initiatorSignature = initiatorSig.signature;

            // If initiatorAddress is a smart account but rejects the owner's signature, treat initiator as EOA.
            if (!isEoaOwnedInitiator) {
              const ok1271 = await isErc1271ValidSignature({
                chain: chain as any,
                contract: initiatorAddress,
                digest,
                signature: initiatorSignature,
              });
              if (!ok1271) {
                initiatorAddress = signerEoa;
                isEoaOwnedInitiator = true;
                const rebuilt = await buildDigestBundle({ initiatorAddress });
                typedData = rebuilt.typedData;
                digest = rebuilt.digest;
                initiatorSig = await signAssociationDigest({
                  provider: eip1193Provider,
                  signerAddress: signerEoa,
                  digest,
                  typedData,
                  preferredMethod: initiatorSig.method,
                });
              }
            }

            const payload: AssociationRequestPayload = {
              version: 1,
              chainId,
              initiatorDid,
              approverDid: composeToAgent.did,
              initiatorAddress,
              approverAddress,
              assocType: associationRequestType,
              description: associationRequestDescription || '',
              validAt,
              validUntil,
              interfaceId,
              data,
              digest,
              initiatorSignature,
              signatureMethod: initiatorSig.method,
            };

            // If initiator == approver (self-association), we can submit immediately.
            if (initiatorAddress.toLowerCase() === approverAddress.toLowerCase()) {
              if (!isEoaOwnedInitiator) {
                const bundlerUrl = getClientBundlerUrl(chainId);
                if (!bundlerUrl) throw new Error(`Bundler URL not configured for chain ${chainId}`);
                const agentName = selectedFolderAgent.agentName || '';
                if (!agentName) throw new Error('Agent name is required');
                agentAccountClient = await getDeployedAccountClientByAgentName(
                  bundlerUrl,
                  agentName,
                  walletAddress as `0x${string}`,
                  { chain: chain as any, ethereumProvider: eip1193Provider as any },
                );
              }
              const result = await finalizeAssociationWithWallet({
                chain: chain as any,
                ...(isEoaOwnedInitiator
                  ? {
                      mode: 'eoa' as const,
                      ethereumProvider: eip1193Provider as any,
                      account: signerEoa,
                    }
                  : { mode: 'smartAccount' as const, submitterAccountClient: agentAccountClient }),
                requesterDid: initiatorDid,
                approverAddress,
                assocType: associationRequestType,
                description: associationRequestDescription || '',
                validAt,
                data,
                initiatorSignature,
                approverSignature: initiatorSignature,
                onStatusUpdate: (msg: string) => console.log('[Association Request]', msg),
              } as any);
              console.log('[Association Request] Association stored (UserOp hash):', result.txHash);
            } else {
              // Otherwise, embed payload into message body (atp-agent does NOT persist arbitrary metadata fields).
              const payloadBlock = [
                ASSOCIATION_PAYLOAD_MARKER_BEGIN,
                JSON.stringify(payload),
                ASSOCIATION_PAYLOAD_MARKER_END,
              ].join('\n');
              contentToSend = `${contentToSend}\n\n${payloadBlock}`;
            }
          } catch (assocError: any) {
            console.error('[Association Request] Failed to create association:', assocError);
            // Association requests must include a payload block to be actionable.
            throw assocError;
          }
        } else if (isValidationRequestTaskType(selectedMessageType)) {
          try {
            const chainId = selectedFolderAgent.chainId;
            const chain = getChainById(chainId);
            const bundlerUrl = getClientBundlerUrl(chainId);

            if (!bundlerUrl) {
              throw new Error(`Bundler URL not configured for chain ${chainId}`);
            }

            if (!eip1193Provider || !walletAddress) {
              throw new Error('Wallet not connected');
            }

            // Switch to correct chain
            if (eip1193Provider && typeof eip1193Provider.request === 'function') {
              const targetHex = `0x${chainId.toString(16)}`;
              try {
                await eip1193Provider.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: targetHex }],
                });
              } catch (switchErr) {
                console.warn('Failed to switch chain', switchErr);
              }
            }

            // Get agent account client for the requester (from agent)
            const agentName = selectedFolderAgent.agentName || '';
            if (!agentName) {
              throw new Error('Agent name is required');
            }

            const agentAccountClient = await getDeployedAccountClientByAgentName(
              bundlerUrl,
              agentName,
              walletAddress as `0x${string}`,
              {
                chain: chain as any,
                ethereumProvider: eip1193Provider as any,
              }
            );

            // Create validation request JSON
            const requestJson = {
              agentId: String(selectedFolderAgent.agentId),
              agentName: agentName,
              validationKind: validationRequestKind,
              validationDetails: validationRequestDetails || undefined,
              checks: ['Validation request'],
            };
            const requestHash = keccak256(toHex(JSON.stringify(requestJson)));

            // Upload to IPFS
            const jsonBlob = new Blob([JSON.stringify(requestJson, null, 2)], { type: 'application/json' });
            const formData = new FormData();
            formData.append('file', jsonBlob, 'validation-request.json');

            const ipfsResponse = await fetch('/api/ipfs/upload', {
              method: 'POST',
              body: formData,
            });

            if (!ipfsResponse.ok) {
              throw new Error('Failed to upload validation request to IPFS');
            }

            const ipfsResult = await ipfsResponse.json();
            const requestUri = ipfsResult.url || ipfsResult.tokenUri || `ipfs://${ipfsResult.cid}`;

            // Get the "To Agent" account address (this is the validator)
            if (!composeToAgent) {
              throw new Error('To Agent is required for validation requests');
            }

            // Fetch the "To Agent" details to get its account address
            const toAgentDid = normalizeDid(composeToAgent.did);
            const toAgentResponse = await fetch(`/api/agents/${encodeURIComponent(toAgentDid)}`);
            if (!toAgentResponse.ok) {
              throw new Error('Failed to fetch To Agent details');
            }
            const toAgentData = await toAgentResponse.json();
            const validatorAddressRaw = toAgentData?.agentAccount || toAgentData?.account;
            const validatorAddress = resolvePlainAddress(validatorAddressRaw);
            
            if (!validatorAddress) {
              throw new Error('To Agent account address not found. The agent must have an account address to be used as a validator.');
            }

            console.log('[Validation Request] Using To Agent as validator:', {
              toAgentDid,
              toAgentName: composeToAgent.agentName,
              validatorAddress,
            });

            // Determine which validation function to use based on selected message type.
            const requestValidationFn =
              selectedMessageType === 'name_validation_request'
                ? requestNameValidationWithWallet
                : selectedMessageType === 'account_validation_request'
                  ? requestAccountValidationWithWallet
                  : requestAppValidationWithWallet;

            // Create on-chain validation request
            // RULE: ValidationRegistry contract checks owner/operator authorization only.
            // agentIdentityOwnerAccount can be an EOA or a smart account.
            // If it's a smart account, use bundler/gasless approach.
            // Use a decoded did:8004 string (avoid percent-encoded DID leaking into logs and regex parsing).
            const requesterDid = buildDid8004(chainId, selectedFolderAgent.agentId, { encode: false });
            const walletEoa = getAddress(walletAddress as `0x${string}`) as `0x${string}`;

            // Get the agent identity owner account (may be EOA or smart account)
            const r = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}`, { cache: 'no-store' });
            if (!r.ok) {
              throw new Error(
                `Failed to fetch requester agent details: ${r.status} ${r.statusText}. Cannot determine agent identity owner.`,
              );
            }

            const d = await r.json().catch(() => {
              throw new Error('Failed to parse requester agent details. Cannot determine agent identity owner.');
            });

            // Get agentIdentityOwnerAccount (may be EOA or smart account)
            const agentIdentityOwnerAccountRaw = (d as any)?.agentIdentityOwnerAccount ?? null;

            if (!agentIdentityOwnerAccountRaw) {
              throw new Error(
                `Requester agent (${requesterDid}) has no agentIdentityOwnerAccount. Cannot determine owner for validation request.`,
              );
            }

            const agentIdentityOwnerAccount = resolvePlainAddress(agentIdentityOwnerAccountRaw);
            if (!agentIdentityOwnerAccount) {
              throw new Error(
                `Requester agent (${requesterDid}) has invalid agentIdentityOwnerAccount format: ${agentIdentityOwnerAccountRaw}.`,
              );
            }

            // Check if agentIdentityOwnerAccount is a smart account (has bytecode)
            const rpcUrl = getClientRpcUrl(chainId);
            if (!rpcUrl) {
              throw new Error(`RPC URL not configured for chain ${chainId}. Required to check owner account type.`);
            }
            const publicClient = createPublicClient({
              chain: chain as any,
              transport: http(rpcUrl),
            });
            const ownerCode = await publicClient.getBytecode({ address: agentIdentityOwnerAccount as `0x${string}` });
            const isOwnerSmartAccount = ownerCode && ownerCode !== '0x';

            // Verify on-chain that agentIdentityOwnerAccount is the actual owner of the agent NFT
            // This is critical: ValidationRegistry contract checks owner/operator authorization
            const { identityRegistry } = getClientRegistryAddresses(chainId);
            if (!identityRegistry) {
              throw new Error(`IdentityRegistry address not configured for chain ${chainId}. Required to verify owner.`);
            }

            const IDENTITY_ABI = [
              {
                type: 'function',
                name: 'ownerOf',
                stateMutability: 'view',
                inputs: [{ name: 'tokenId', type: 'uint256' }],
                outputs: [{ name: 'owner', type: 'address' }],
              },
            ] as const;

            const agentIdBigInt = BigInt(selectedFolderAgent.agentId);
            const onChainOwner = await publicClient.readContract({
              address: identityRegistry as `0x${string}`,
              abi: IDENTITY_ABI,
              functionName: 'ownerOf',
              args: [agentIdBigInt],
            });

            console.log('[Validation Request] On-chain owner verification:', {
              requesterDid,
              agentId: selectedFolderAgent.agentId,
              agentIdentityOwnerAccount,
              onChainOwner,
              match: onChainOwner.toLowerCase() === agentIdentityOwnerAccount.toLowerCase(),
            });

            if (onChainOwner.toLowerCase() !== agentIdentityOwnerAccount.toLowerCase()) {
              throw new Error(
                `On-chain owner mismatch: agentIdentityOwnerAccount (${agentIdentityOwnerAccount}) does not match on-chain ownerOf (${onChainOwner}) for agent ${requesterDid}. ValidationRegistry will reject this request.`,
              );
            }

            let validationMode: 'eoa' | 'smartAccount';
            let requesterAccountClientToUse: any = undefined;

            if (isOwnerSmartAccount) {
              // Smart account owner: use bundler/gasless approach
              // Verify the connected wallet controls the owner smart account (will be checked by the smart account itself)
              validationMode = 'smartAccount';
              
              // Build account client for the owner smart account
              const bundlerUrl = getClientBundlerUrl(chainId);
              if (!bundlerUrl) {
                throw new Error(`Bundler URL not configured for chain ${chainId}. Required for smart account validation requests.`);
              }

              requesterAccountClientToUse = await getDeployedAccountClientByAddress(
                agentIdentityOwnerAccount as `0x${string}`,
                walletEoa,
                { chain: chain as any, ethereumProvider: eip1193Provider as any },
              );

              console.log('[Validation Request] Using smart account owner for validation request (bundler/gasless):', {
                requesterDid,
                agentIdentityOwnerAccount,
                walletEoa,
              });
            } else {
              // EOA owner: use direct EOA signing
              // Verify the connected wallet is the owner
              if (agentIdentityOwnerAccount.toLowerCase() !== walletEoa.toLowerCase()) {
                throw new Error(
                  `Connected wallet (${walletEoa}) is not the owner of agent ${requesterDid}. Owner is ${agentIdentityOwnerAccount}. Validation requests must be sent from the agent owner.`,
                );
              }

              validationMode = 'eoa';
              console.log('[Validation Request] Using EOA owner for validation request:', {
                requesterDid,
                agentIdentityOwnerAccount,
                walletEoa,
              });
            }

            const validationResult = await requestValidationFn({
              requesterDid,
              requestUri,
              requestHash,
              chain: chain as any,
              requesterAccountClient: requesterAccountClientToUse,
              validatorAddress, // Pass the "To Agent" account address as the validator
              mode: validationMode,
              ethereumProvider: eip1193Provider as any,
              account: walletEoa as `0x${string}`,
              onStatusUpdate: (msg: string) => console.log('[Validation Request]', msg),
            } as any);

            console.log('[Validation Request] Created on-chain:', {
              txHash: validationResult.txHash,
              validatorAddress: validationResult.validatorAddress,
              requestHash: validationResult.requestHash,
            });

            // Persist validation details in the inbox message body (ATP only stores subject/body/context/task fields).
            const validationBlock = {
              kind: 'erc8004.validation.request@1',
              chainId,
              requesterDid,
              validatorDid: toAgentDid,
              validatorAddress,
              requestUri,
              requestHash,
              txHash: validationResult.txHash,
              mode: 'eoa',
              createdAt: new Date().toISOString(),
            };
            contentToSend = `${contentToSend}\n\n[validation_request]\n${JSON.stringify(validationBlock)}\n[/validation_request]`;
          } catch (validationErr: any) {
            console.error('[Validation Request] Failed to create on-chain validation request:', validationErr);
            // Continue with message sending even if validation request creation fails
            // The user will still get the message notification
          }
        }



        // Create the ATP inbox message (this is what creates/updates the task thread).
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: selectedMessageType,
            subject,
            content: contentToSend,
            fromClientAddress: walletAddress,
            fromAgentDid: selectedFromAgentDid,
            fromAgentName: selectedFolderAgent.agentName || null,
            toAgentDid: composeToAgent.did,
            toAgentName: composeToAgent.agentName,
            taskId: composeTaskId,
            metadata: {
              source: 'admin-app',
              timestamp: new Date().toISOString(),
            },
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || data?.message || 'Failed to send message');
        }
      }

      setComposeOpen(false);
      await fetchMessages();
    } catch (err: any) {
      console.error('[Messages] Failed to send message:', err);
      setError(err?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }, [
    selectedFolderAgent,
    selectedFromAgentDid,
    composeSubject,
    composeBody,
    composeToAgent,
    composeToAgentInput,
    feedbackRequestComment,
    selectedMessageType,
    validationRequestKind,
    validationRequestDetails,
    validationRequestDomain,
    associationRequestType,
    associationRequestDescription,
    walletAddress,
    eip1193Provider,
    composeTaskId,
    fetchMessages,
  ]);

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return '—';
    // support both seconds and ms
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    const date = new Date(ms);
    return date.toLocaleString();
  };

  const getMessageTypeLabel = (type: string) => {
    switch (type) {
      case 'feedback_auth_request':
        return 'Request Feedback Permission';
      case 'name_validation_request':
        return 'Request Name Validation';
      case 'account_validation_request':
        return 'Request Account Validation';
      case 'app_validation_request':
        return 'Request App Validation';
      case 'association_request':
        return 'Request Association';
      case 'feedback_request_approved':
        return 'Feedback Request Approved';
      default:
        return 'General Message';
    }
  };

  const getMessageTypeColor = (type: string): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (type) {
      case 'feedback_auth_request':
        return 'primary';
      case 'name_validation_request':
      case 'account_validation_request':
      case 'app_validation_request':
        return 'warning';
      case 'feedback_request_approved':
        return 'success';
      default:
        return 'default';
    }
  };

  const composeToAgentSkillIds = useMemo(() => {
    const skills = Array.isArray(composeToAgentCard?.skills) ? composeToAgentCard.skills : [];
    return new Set(
      skills
        .map((s: any) => String(s?.id || '').trim())
        .filter(Boolean),
    );
  }, [composeToAgentCard]);

  const composeToAgentOsafSkillIds = useMemo(() => {
    const skills = Array.isArray(composeToAgentCard?.skills) ? composeToAgentCard.skills : [];
    const out = new Set<string>();

    // Primary: per-skill tags like "oasf:trust.feedback.authorization"
    for (const s of skills) {
      const tags = Array.isArray((s as any)?.tags) ? (s as any).tags : [];
      for (const t of tags) {
        const tag = String(t || '').trim();
        if (tag.startsWith('oasf:')) out.add(tag.slice('oasf:'.length));
      }
    }

    // Secondary: the agent-card extension (if present) may list supported OASF skills globally.
    const exts = Array.isArray((composeToAgentCard as any)?.capabilities?.extensions)
      ? (composeToAgentCard as any).capabilities.extensions
      : [];
    const oasfExt = exts.find((e: any) => String(e?.uri || '') === 'https://schema.oasf.outshift.com/');
    const extSkills = Array.isArray(oasfExt?.params?.skills) ? oasfExt.params.skills : [];
    for (const id of extSkills) out.add(String(id || '').trim());

    return out;
  }, [composeToAgentCard]);

  const isToAgentSkillSupported = useCallback(
    (requiredExecutable?: string[], requiredOsaf?: string[]) => {
      // No constraints => always allowed.
      if ((!requiredExecutable || requiredExecutable.length === 0) && (!requiredOsaf || requiredOsaf.length === 0)) return true;

      // Prefer OASF overlay if present.
      if (requiredOsaf && requiredOsaf.length > 0 && composeToAgentOsafSkillIds.size > 0) {
        return requiredOsaf.some((id) => composeToAgentOsafSkillIds.has(id));
      }

      // Fallback to raw executable A2A skill ids.
      if (requiredExecutable && requiredExecutable.length > 0) {
        return requiredExecutable.some((id) => composeToAgentSkillIds.has(id));
      }

      return true;
    },
    [composeToAgentOsafSkillIds, composeToAgentSkillIds],
  );

  // If the selected task type isn't supported by the chosen recipient, auto-pick the first supported type.
  useEffect(() => {
    if (!composeOpen || !composeToAgent) return;
    if (composeToAgentCardLoading) return;

    const isSupported = (taskType: InboxTaskType) => {
      const opt = INBOX_TASK_TYPE_OPTIONS.find((o) => o.value === taskType);
      if (!opt) return true;
      return isToAgentSkillSupported(opt.requiredToAgentSkills, opt.requiredOsafSkills);
    };

    if (isSupported(selectedMessageType)) return;
    const first = INBOX_TASK_TYPE_OPTIONS.find((o) => isSupported(o.value));
    if (first) setSelectedMessageType(first.value);
  }, [composeOpen, composeToAgent, composeToAgentCardLoading, selectedMessageType, isToAgentSkillSupported]);

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Header
        displayAddress={walletAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={walletConnected}
        onConnect={auth.openLoginModal}
        onDisconnect={auth.handleDisconnect}
        disableConnect={loading || auth.loading}
      />
      <Container maxWidth={false} sx={{ py: { xs: 2, md: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800, color: palette.textPrimary, lineHeight: 1.1 }}>
                Inbox
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Agent mailboxes and requests.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Tooltip title="Refresh">
                <span>
                  <IconButton
                    onClick={() => fetchMessages()}
                    disabled={!selectedAgentKey || loadingMessages}
                    aria-label="Refresh messages"
                  >
                    <RefreshIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Button
                variant="contained"
                startIcon={<CreateOutlinedIcon />}
                onClick={handleOpenCompose}
                disabled={!walletConnected || !selectedFolderAgent}
                sx={{
                  backgroundColor: palette.accent,
                  '&:hover': { backgroundColor: palette.border },
                }}
              >
                New
              </Button>
            </Stack>
          </Stack>

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Paper
            sx={{
              border: `1px solid ${palette.border}`,
              borderRadius: 3,
              overflow: 'hidden',
              backgroundColor: palette.surface,
              boxShadow: '0 10px 24px rgba(15,23,42,0.10)',
            }}
          >
            {!ownedAgentsLoading && cachedOwnedAgents.length === 0 ? (
              <Box sx={{ p: { xs: 3, md: 4 } }}>
                <Stack spacing={1}>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    No agent folders yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    You need to register at least one agent to collaborate with other agents and use the inbox.
                  </Typography>
                  <Box>
                    <Button
                      variant="contained"
                      href="/agent-registration"
                      sx={{
                        mt: 1,
                        backgroundColor: palette.accent,
                        '&:hover': { backgroundColor: palette.border },
                      }}
                    >
                      Register an Agent
                    </Button>
                  </Box>
                </Stack>
              </Box>
            ) : (
            <Box sx={{ display: 'flex', minHeight: { xs: 520, md: 640 } }}>
              {/* Folder list */}
              <Box
                sx={{
                  width: 320,
                  borderRight: `1px solid ${palette.border}`,
                  display: { xs: 'none', md: 'flex' },
                  flexDirection: 'column',
                  backgroundColor: palette.surfaceMuted,
                }}
              >
                <Box sx={{ p: 2, borderBottom: `1px solid ${palette.border}` }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <FolderOpenOutlinedIcon fontSize="small" />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Your Agents
                    </Typography>
                  </Stack>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Search agents…"
                    value={folderSearch}
                    onChange={(e) => setFolderSearch(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />
                  {ownedAgentsLoading && (
                    <FormHelperText sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CircularProgress size={14} /> Loading your agents…
                    </FormHelperText>
                  )}
                </Box>
                <List dense sx={{ overflow: 'auto', flex: 1 }}>
                  {visibleFolders.map((a) => {
                    const key = `${a.chainId}:${a.agentId}`;
                    const selected = key === selectedAgentKey;
                    const name = a.agentName || `Agent #${a.agentId}`;
                    const img = (a.image || '').trim();
                    return (
                      <ListItemButton
                        key={key}
                        selected={selected}
                        onClick={() => {
                          setSelectedAgentKey(key);
                          setSelectedTaskKey(null);
                          setMailboxMode('inbox');
                          setMessageSearch('');
                        }}
                        sx={{
                          borderRadius: 1.5,
                          mx: 1,
                          my: 0.5,
                          '&.Mui-selected': {
                            backgroundColor: 'rgba(122, 142, 230, 0.12)',
                          },
                        }}
                      >
                        <ListItemAvatar>
                          <Avatar src={img || undefined} sx={{ width: 28, height: 28, fontSize: 12 }}>
                            {name.slice(0, 1).toUpperCase()}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primaryTypographyProps={{ noWrap: true, fontWeight: selected ? 700 : 600 }}
                          secondaryTypographyProps={{ noWrap: true }}
                          primary={name}
                          secondary={`Chain ${a.chainId} · ID ${a.agentId}`}
                        />
                      </ListItemButton>
                    );
                  })}
                  {!ownedAgentsLoading && visibleFolders.length === 0 && (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        No owned agents found.
                      </Typography>
                    </Box>
                  )}
                </List>
              </Box>

              {/* Messages + reading pane */}
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <Box sx={{ p: 2, borderBottom: `1px solid ${palette.border}` }}>
                  <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                      <Avatar
                        src={(selectedFolderAgent?.image || '').trim() || undefined}
                        sx={{ width: 34, height: 34, fontSize: 14 }}
                      >
                        {(selectedFolderAgent?.agentName || 'A').slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap>
                          {selectedFolderAgent?.agentName ||
                            (selectedFolderAgent ? `Agent #${selectedFolderAgent.agentId}` : 'Select a folder')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {displayDid(selectedFromAgentDid)}
                        </Typography>
                      </Box>
                    </Stack>

                    <TextField
                      size="small"
                      placeholder="Search messages…"
                      value={messageSearch}
                      onChange={(e) => setMessageSearch(e.target.value)}
                      sx={{ width: { xs: '100%', md: 360 } }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon fontSize="small" />
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Stack>
                </Box>

                <Box
                  sx={{
                    flex: 1,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', lg: '420px 1fr' },
                    minHeight: 0,
                  }}
                >
                  {/* Message list */}
                  <Box sx={{ borderRight: { xs: 'none', lg: `1px solid ${palette.border}` }, overflow: 'auto' }}>
                    {!walletConnected ? (
                      <Box sx={{ p: 3 }}>
                        <Typography color="text.secondary">Connect your wallet to view messages.</Typography>
                      </Box>
                    ) : loadingMessages ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                        <CircularProgress />
                      </Box>
                    ) : (
                      <>
                        <Box sx={{ p: 1.5, borderBottom: `1px solid ${palette.border}` }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip
                              label={`Inbox (${inboxCount})`}
                              clickable
                              onClick={() => {
                                setMailboxMode('inbox');
                                setSelectedTaskKey(null);
                              }}
                              color={mailboxMode === 'inbox' ? 'primary' : 'default'}
                              variant={mailboxMode === 'inbox' ? 'filled' : 'outlined'}
                              size="small"
                            />
                            <Chip
                              label={`Sent (${sentCount})`}
                              clickable
                              onClick={() => {
                                setMailboxMode('sent');
                                setSelectedTaskKey(null);
                              }}
                              color={mailboxMode === 'sent' ? 'primary' : 'default'}
                              variant={mailboxMode === 'sent' ? 'filled' : 'outlined'}
                              size="small"
                            />
                          </Stack>
                        </Box>

                        {visibleThreads.length === 0 ? (
                          <Box sx={{ p: 3 }}>
                            <Typography color="text.secondary">
                              {mailboxMode === 'sent' ? 'No sent messages.' : 'No inbox messages.'}
                            </Typography>
                          </Box>
                        ) : (
                          <List disablePadding>
                            {visibleThreads.map((t) => {
                              const m = t.lastMessage;
                              const selected = t.key === selectedTaskKey;
                              const unread = mailboxMode === 'inbox' && t.unreadCount > 0;
                              const from =
                                m.fromAgentName ||
                                (m.fromAgentDid ? displayDid(m.fromAgentDid) : null) ||
                                m.fromClientAddress ||
                                'Unknown';
                              const to =
                                m.toAgentName ||
                                (m.toAgentDid ? displayDid(m.toAgentDid) : null) ||
                                m.toClientAddress ||
                                'Unknown';
                              const subj = m.subject || getMessageTypeLabel(t.taskType);
                              const preview = (m.body || '').slice(0, 120);
                              return (
                                <React.Fragment key={t.key}>
                                  <ListItemButton
                                    selected={selected}
                                    onClick={() => setSelectedTaskKey(t.key)}
                                    sx={{
                                      alignItems: 'flex-start',
                                      '&.Mui-selected': { backgroundColor: 'rgba(122, 142, 230, 0.10)' },
                                    }}
                                  >
                                    <ListItemAvatar sx={{ mt: 0.5 }}>
                                      <Badge color="primary" variant="dot" invisible={!unread} overlap="circular">
                                        <Avatar sx={{ width: 34, height: 34, fontSize: 13 }}>
                                          {from.slice(0, 1).toUpperCase()}
                                        </Avatar>
                                      </Badge>
                                    </ListItemAvatar>
                                    <ListItemText
                                      disableTypography
                                      primary={
                                        <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ width: '100%' }}>
                                          <Typography variant="subtitle2" sx={{ fontWeight: unread ? 800 : 600 }} noWrap>
                                            {subj}
                                          </Typography>
                                          <Typography variant="caption" color="text.secondary" noWrap>
                                            {formatTimestamp(m.createdAt)}
                                          </Typography>
                                        </Stack>
                                      }
                                      secondary={
                                        <Stack spacing={0.5} sx={{ mt: 0.25 }}>
                                          <Stack direction="row" spacing={1} alignItems="center">
                                            <Chip
                                              label={getMessageTypeLabel(t.taskType)}
                                              size="small"
                                              color={getMessageTypeColor(t.taskType)}
                                            />
                                            <Typography variant="caption" color="text.secondary" noWrap>
                                              {mailboxMode === 'sent' ? `To: ${to}` : `From: ${from}`}
                                            </Typography>
                                          </Stack>
                                          <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            sx={{
                                              display: '-webkit-box',
                                              WebkitLineClamp: 2,
                                              WebkitBoxOrient: 'vertical',
                                              overflow: 'hidden',
                                            }}
                                          >
                                            {preview}
                                          </Typography>
                                        </Stack>
                                      }
                                    />
                                  </ListItemButton>
                                  <Divider />
                                </React.Fragment>
                              );
                            })}
                          </List>
                        )}
                      </>
                    )}
                  </Box>

                  {/* Reading pane */}
                  <Box sx={{ overflow: 'auto', p: { xs: 2, md: 3 }, backgroundColor: 'background.paper' }}>
                    {!selectedThread ? (
                      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Stack spacing={1} alignItems="center">
                          <MailOutlineIcon color="action" />
                          <Typography variant="body2" color="text.secondary">
                            Select a task to read.
                          </Typography>
                        </Stack>
                      </Box>
                    ) : (
                      <Stack spacing={2}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
                              {selectedThread.lastMessage.subject || getMessageTypeLabel(selectedThread.taskType)}
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                              <Chip
                                label={getMessageTypeLabel(selectedThread.taskType)}
                                size="small"
                                color={getMessageTypeColor(selectedThread.taskType)}
                              />
                              <Typography variant="caption" color="text.secondary">
                                {formatTimestamp(selectedThread.lastMessage.createdAt)}
                              </Typography>
                              {selectedThread.taskId ? (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  Task: {selectedThread.taskId}
                                </Typography>
                              ) : null}
                            </Stack>
                          </Box>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Button variant="outlined" size="small" onClick={handleReplyToSelectedTask}>
                              Reply
                            </Button>
                          </Stack>
                        </Stack>

                        {mailboxMode === 'inbox' && Boolean(selectedFeedbackRequestMessage?.contextId) && (
                            <Box>
                              <Button
                                variant="contained"
                                onClick={() => {
                                  setApproveError(null);
                                  setApproveSuccess(null);
                                  setApproveExpiryDays(30);
                                  setApproveOpen(true);
                                }}
                                sx={{
                                  backgroundColor: palette.accent,
                                  '&:hover': { backgroundColor: palette.border },
                                }}
                              >
                                Approve feedback request
                              </Button>
                            </Box>
                          )}

                        {Boolean(selectedValidationRequestMessage) && canValidateSelectedThread && (
                            <Box>
                              <Button
                                variant="contained"
                                onClick={handleOpenValidateDialog}
                                disabled={!selectedFolderAgent || checkingValidationRequest}
                                sx={{
                                  backgroundColor: palette.accent,
                                  '&:hover': { backgroundColor: palette.border },
                                }}
                              >
                                {checkingValidationRequest ? 'Checking...' : 'Validate'}
                              </Button>
                            </Box>
                          )}

                        {canApproveAssociation && (
                            <Box>
                              <Button
                                variant="contained"
                                size="small"
                                onClick={() => {
                                  try {
                                    const parsed = extractAssociationPayloadFromBody(
                                      selectedAssociationRequestMessage?.body || '',
                                    );
                                    if (!parsed) throw new Error('Missing association payload');
                                    setApproveAssociationPayload(parsed);
                                    setApproveAssociationError(null);
                                    setApproveAssociationOpen(true);
                                  } catch (e) {
                                    setApproveAssociationError('Invalid association payload in message.');
                                    setApproveAssociationOpen(true);
                                  }
                                }}
                                sx={{
                                  mt: 1,
                                  backgroundColor: palette.accent,
                                  '&:hover': { backgroundColor: palette.border },
                                }}
                              >
                                Approve Association
                              </Button>
                            </Box>
                          )}

                        <Divider />

                        <Stack spacing={0.5}>
                          <Typography variant="body2" color="text.secondary">
                            <strong>From:</strong>{' '}
                            {selectedThread.lastMessage.fromAgentName ||
                              (selectedThread.lastMessage.fromAgentDid ? displayDid(selectedThread.lastMessage.fromAgentDid) : null) ||
                              selectedThread.lastMessage.fromClientAddress ||
                              'Unknown'}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            <strong>To:</strong>{' '}
                            {selectedThread.lastMessage.toAgentName ||
                              (selectedThread.lastMessage.toAgentDid ? displayDid(selectedThread.lastMessage.toAgentDid) : null) ||
                              selectedThread.lastMessage.toClientAddress ||
                              'Unknown'}
                          </Typography>
                        </Stack>

                        {mailboxMode === 'inbox' && Boolean(selectedFeedbackApprovedMessage) && (
                            <Box>
                              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                                <Button
                                  variant="outlined"
                                  onClick={requestFeedbackAuthForSelectedMessage}
                                  disabled={feedbackAuthLoading}
                                >
                                  {feedbackAuthLoading ? 'Checking feedback auth…' : 'Refresh feedback auth'}
                                </Button>
                                <Button
                                  variant="contained"
                                  onClick={() => setGiveFeedbackOpen(true)}
                                  disabled={
                                    feedbackAuthLoading ||
                                    !feedbackAuthValue ||
                                    !selectedMessageTargetParsed ||
                                    !walletAddress ||
                                    !selectedFolderAgent
                                  }
                                  sx={{
                                    backgroundColor: palette.accent,
                                    '&:hover': { backgroundColor: palette.border },
                                  }}
                                >
                                  Give Feedback
                                </Button>
                              </Stack>

                              {feedbackAuthError && (
                                <Alert severity="error" sx={{ mt: 1 }}>
                                  {feedbackAuthError}
                                </Alert>
                              )}
                              {!feedbackAuthError && !feedbackAuthLoading && !feedbackAuthValue && (
                                <Alert severity="info" sx={{ mt: 1 }}>
                                  Feedback authorization not available yet.
                                </Alert>
                              )}
                            </Box>
                          )}

                        <Stack spacing={1.25}>
                          {[...selectedThread.messages]
                            .slice()
                            .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
                            .map((m) => {
                              const author =
                                m.fromAgentName ||
                                (m.fromAgentDid ? displayDid(m.fromAgentDid) : null) ||
                                m.fromClientAddress ||
                                'Unknown';
                              return (
                                <Paper
                                  key={m.id}
                                  variant="outlined"
                                  sx={{ p: 2, borderColor: palette.border, backgroundColor: palette.surface }}
                                >
                                  <Stack spacing={0.75}>
                                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }} noWrap>
                                          {author}
                                        </Typography>
                                        <Chip
                                          label={getMessageTypeLabel(m.contextType)}
                                          size="small"
                                          color={getMessageTypeColor(m.contextType)}
                                        />
                                      </Stack>
                                      <Typography variant="caption" color="text.secondary" noWrap>
                                        {formatTimestamp(m.createdAt)}
                                      </Typography>
                                    </Stack>
                                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                                      {m.body}
                                    </Typography>
                                  </Stack>
                                </Paper>
                              );
                            })}
                        </Stack>
                      </Stack>
                    )}
                  </Box>
                </Box>
              </Box>
            </Box>
            )}
          </Paper>
        </Stack>
      </Container>

      <Dialog open={composeOpen} onClose={() => setComposeOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
            <Avatar
              src={(selectedFolderAgent?.image || '').trim() || undefined}
              sx={{ width: 28, height: 28, fontSize: 12 }}
            >
              {(selectedFolderAgent?.agentName || 'A').slice(0, 1).toUpperCase()}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap>
                New message
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                From: {selectedFolderAgent?.agentName || `Agent #${selectedFolderAgent?.agentId || ''}`}
              </Typography>
            </Box>
          </Stack>
          <Tooltip title="Compose uses the selected folder as the sender">
            <IconButton aria-label="Sender info">
              <MailOutlineIcon />
            </IconButton>
          </Tooltip>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="compose-intent-type-label">Intent Type</InputLabel>
              <Select
                id="compose-intent-type"
                labelId="compose-intent-type-label"
                value={selectedIntentType}
                label="Intent Type"
                onChange={(e) => {
                  const next = e.target.value as InboxIntentType;
                  setSelectedIntentType(next);

                  // Reset recipient when intent changes (agent list is intent-scoped).
                  setComposeToAgent(null);
                  setComposeToAgentInput('');
                  setComposeToAgentCard(null);

                  // Default task type for the intent.
                  const opt = INBOX_INTENT_TYPE_OPTIONS.find((o) => o.value === next);
                  const defaultTask = opt?.defaultTaskType ?? 'general';
                  setSelectedMessageType(defaultTask as any);

                  // Default association subtype for membership/delegation intents.
                  if (next === 'trust.membership') setAssociationRequestType(AssocType.Membership);
                  if (next === 'trust.delegation') setAssociationRequestType(AssocType.Delegation);
                }}
              >
                {INBOX_INTENT_TYPE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>Choose what you want to accomplish; we’ll suggest agents that support it.</FormHelperText>
            </FormControl>

            <Autocomplete
              options={composeToAgentOptions}
              value={composeToAgent}
              isOptionEqualToValue={(option, value) => option.key === value.key}
              onChange={(_, value) =>
                setComposeToAgent(value ? { ...value, did: normalizeDid(value.did) } : null)
              }
              inputValue={composeToAgentInput}
              onInputChange={(_, value) => setComposeToAgentInput(value)}
              loading={composeToAgentLoading}
              filterOptions={(x) => x}
              getOptionLabel={(opt) =>
                `${opt.agentName || `Agent #${opt.agentId}`} (Chain ${opt.chainId}, ID ${opt.agentId})`
              }
              renderOption={(props, opt) => {
                const name = opt.agentName || `Agent #${opt.agentId}`;
                const img = (opt.image || '').trim();
                return (
                  <li {...props} key={opt.key}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                      <Avatar src={img || undefined} sx={{ width: 22, height: 22, fontSize: 11 }}>
                        {name.slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {opt.did}
                        </Typography>
                      </Box>
                    </Stack>
                  </li>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="To Agent"
                  placeholder={
                    selectedIntentType === 'general'
                      ? 'Search agents…'
                      : 'Search agents (intent-scoped)…'
                  }
                  size="small"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {composeToAgentLoading ? <CircularProgress size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            <FormControl fullWidth size="small" disabled={!composeToAgent || composeToAgentCardLoading}>
              <InputLabel id="compose-message-type-label">Task Type</InputLabel>
              <Select
                id="compose-message-type"
                labelId="compose-message-type-label"
                value={selectedMessageType}
                label="Task Type"
                onChange={(e) => setSelectedMessageType(e.target.value as any)}
              >
                {INBOX_TASK_TYPE_OPTIONS.map((opt) => (
                  <MenuItem
                    key={opt.value}
                    value={opt.value}
                    disabled={
                      Boolean(composeToAgent) &&
                      !isToAgentSkillSupported(opt.requiredToAgentSkills, opt.requiredOsafSkills)
                    }
                  >
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                {!composeToAgent
                  ? 'Pick a recipient first. Task types are derived from the recipient agent card skills.'
                  : composeToAgentCardLoading
                    ? 'Loading recipient agent card…'
                    : 'Task types reflect what the recipient advertises in its agent card.'}
              </FormHelperText>
            </FormControl>



            {selectedMessageType === 'feedback_auth_request' ? (
              <TextField
                label="Why do you want to give feedback?"
                value={feedbackRequestComment}
                onChange={(e) => setFeedbackRequestComment(e.target.value)}
                fullWidth
                multiline
                minRows={5}
                placeholder="e.g., I used this agent and want to share my experience…"
              />
            ) : isValidationRequestTaskType(selectedMessageType) ? (
              <Stack spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="validation-request-kind-label">Validation Type</InputLabel>
                  <Select
                    id="validation-request-kind"
                    labelId="validation-request-kind-label"
                    value={validationRequestKind.startsWith('domain:') ? 'domain' : validationRequestKind}
                    label="Validation Type"
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'domain') {
                        // When domain is selected, initialize with empty domain (user will fill it in)
                        setValidationRequestDomain('');
                        setValidationRequestKind('domain:' as ValidationClaimType);
                      } else {
                        setValidationRequestKind(value as ValidationClaimType);
                        setValidationRequestDomain('');
                      }
                    }}
                  >
                    {VALIDATION_CLAIM_TYPE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                    <MenuItem value="domain">Domain (custom)</MenuItem>
                  </Select>
                  <FormHelperText>Structured request for validators / automation.</FormHelperText>
                </FormControl>
                {(validationRequestKind.startsWith('domain:') || validationRequestKind === 'domain:') && (
                  <TextField
                    label="Domain"
                    value={validationRequestDomain}
                    onChange={(e) => {
                      const domain = e.target.value.trim();
                      setValidationRequestDomain(domain);
                      if (domain) {
                        setValidationRequestKind(`domain:${domain}` as ValidationClaimType);
                      } else {
                        setValidationRequestKind('domain:' as ValidationClaimType);
                      }
                    }}
                    fullWidth
                    placeholder="e.g., healthcare, finance, gaming"
                    helperText="Enter the domain name for the validation claim type"
                  />
                )}
                <TextField
                  label="Details"
                  value={validationRequestDetails}
                  onChange={(e) => setValidationRequestDetails(e.target.value)}
                  fullWidth
                  multiline
                  minRows={5}
                  placeholder="What should be validated, and why?"
                />
                <TextField
                  label="Message"
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  fullWidth
                  multiline
                  minRows={4}
                  placeholder="Optional additional context…"
                />
              </Stack>
            ) : selectedMessageType === 'association_request' ? (
              <Stack spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="association-request-type-label">Association Type</InputLabel>
                  <Select
                    id="association-request-type"
                    labelId="association-request-type-label"
                    value={associationRequestType}
                    label="Association Type"
                    onChange={(e) => setAssociationRequestType(Number(e.target.value))}
                  >
                    {ASSOC_TYPE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText>Type of association relationship</FormHelperText>
                </FormControl>
                <TextField
                  label="Description"
                  value={associationRequestDescription}
                  onChange={(e) => setAssociationRequestDescription(e.target.value)}
                  fullWidth
                  multiline
                  minRows={3}
                  placeholder="Describe the association (e.g., Member of ABC Relief Network alliance)"
                />
                <TextField
                  label="Message"
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  fullWidth
                  multiline
                  minRows={4}
                  placeholder="Optional additional context…"
                />
              </Stack>
            ) : (
              <TextField
                label="Message"
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                fullWidth
                multiline
                minRows={6}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComposeOpen(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSendMessage}
            disabled={sending}
            startIcon={sending ? <CircularProgress size={16} /> : <SendIcon />}
            sx={{ backgroundColor: palette.accent, '&:hover': { backgroundColor: palette.border } }}
          >
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={giveFeedbackOpen} onClose={() => setGiveFeedbackOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          Give Feedback
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            From: {selectedFolderAgent?.agentName || `Agent #${selectedFolderAgent?.agentId || ''}`} · To:{' '}
            {selectedFeedbackApprovedMessage?.fromAgentName ||
              (selectedFeedbackApprovedMessage?.fromAgentDid ? displayDid(selectedFeedbackApprovedMessage.fromAgentDid) : '—')}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                Rating
              </Typography>
              <Rating
                value={feedbackRating}
                onChange={(_, v) => setFeedbackRating(v || 0)}
              />
            </Box>

            <TextField
              label="Comment"
              fullWidth
              multiline
              minRows={3}
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
            />

            {feedbackSuccess && <Alert severity="success">Feedback submitted.</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGiveFeedbackOpen(false)} disabled={submittingFeedback}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={
              submittingFeedback ||
              !feedbackComment.trim() ||
              !feedbackAuthValue ||
              !selectedMessageTargetParsed ||
              !walletAddress
            }
            onClick={async () => {
              if (!feedbackAuthValue || !selectedMessageTargetParsed || !walletAddress) return;
              setSubmittingFeedback(true);
              setFeedbackSuccess(false);
              try {
                const score = Math.max(0, Math.min(5, feedbackRating)) * 20;
                const resp = await fetch('/api/feedback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    agentId: String(selectedMessageTargetParsed.agentId),
                    chainId: selectedMessageTargetParsed.chainId,
                    score,
                    feedback: feedbackComment.trim(),
                    feedbackAuth: feedbackAuthValue,
                    clientAddress: walletAddress,
                    context: selectedMessageFeedbackRequestId
                      ? `feedback_request:${selectedMessageFeedbackRequestId}`
                      : undefined,
                    capability: selectedFromAgentDid ? `fromAgentDid:${normalizeDid(selectedFromAgentDid)}` : undefined,
                  }),
                });
                if (!resp.ok) {
                  const errData = await resp.json().catch(() => ({}));
                  throw new Error(errData.message || errData.error || 'Failed to submit feedback');
                }
                setFeedbackSuccess(true);
                setTimeout(() => {
                  setGiveFeedbackOpen(false);
                  setFeedbackSuccess(false);
                  setFeedbackComment('');
                  setFeedbackRating(5);
                }, 800);
              } catch (e: any) {
                setFeedbackAuthError(e?.message || 'Failed to submit feedback');
              } finally {
                setSubmittingFeedback(false);
              }
            }}
          >
            {submittingFeedback ? 'Submitting…' : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={approveOpen} onClose={() => setApproveOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Approve Feedback Request</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              This marks the feedback request as approved in the ATP database and sends an inbox message back to the requester.
            </Typography>

            <TextField
              label="Approved for (days)"
              type="number"
              value={approveExpiryDays}
              onChange={(e) => setApproveExpiryDays(Number(e.target.value))}
              inputProps={{ min: 1, max: 365 }}
              size="small"
              fullWidth
            />

            {approveSuccess && <Alert severity="success">{approveSuccess}</Alert>}
            {approveError && <Alert severity="error">{approveError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveOpen(false)} disabled={approving}>
            Close
          </Button>
          <Button
            variant="contained"
            disabled={approving || !selectedFeedbackRequestMessage?.contextId}
            startIcon={approving ? <CircularProgress size={16} /> : undefined}
            onClick={async () => {
              try {
                setApproving(true);
                setApproveError(null);
                setApproveSuccess(null);

                const feedbackRequestId = Number(selectedFeedbackRequestMessage?.contextId);
                if (!Number.isFinite(feedbackRequestId) || feedbackRequestId <= 0) {
                  throw new Error('Missing feedback request id on message.');
                }

                if (!selectedFeedbackRequestMessage?.fromAgentDid || !selectedFeedbackRequestMessage?.toAgentDid) {
                  throw new Error('Missing from/to agent DID on message.');
                }

                const res = await fetch('/api/agents-atp/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    skillId: 'atp.feedback.requestapproved',
                    payload: {
                      feedbackRequestId,
                      fromAgentDid: selectedFeedbackRequestMessage.fromAgentDid,
                      toAgentDid: selectedFeedbackRequestMessage.toAgentDid,
                      approvedForDays: approveExpiryDays,
                    },
                    metadata: { source: 'admin-app', timestamp: new Date().toISOString() },
                  }),
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok || data?.success === false) {
                  throw new Error(data?.error || data?.response?.error || 'Failed to approve feedback request');
                }

                setApproveSuccess('Request approved and requester notified.');
                await fetchMessages();
              } catch (e) {
                setApproveError(e instanceof Error ? e.message : 'Failed to approve feedback request');
              } finally {
                setApproving(false);
              }
            }}
            sx={{ backgroundColor: palette.accent, '&:hover': { backgroundColor: palette.border } }}
          >
            {approving ? 'Approving…' : 'Approve'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Validation Response Dialog */}
      <Dialog open={validateDialogOpen} onClose={() => setValidateDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          Submit Validation Response
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Validating:{' '}
            {selectedValidationRequestMessage?.fromAgentName ||
              (selectedValidationRequestMessage?.fromAgentDid
                ? displayDid(selectedValidationRequestMessage.fromAgentDid)
                : '—')}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {checkingValidationRequest ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2">Checking for validation request in Validation Registry...</Typography>
              </Box>
            ) : validationRequestHash ? (
              <>
                <Alert severity={validationResponseAlreadySubmitted ? 'warning' : 'success'}>
                  Validation request found in Validation Registry
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                    Request Hash: {validationRequestHash.slice(0, 10)}...{validationRequestHash.slice(-8)}
                  </Typography>
                  {validationResponseAlreadySubmitted && validationRequestStatus && (
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontWeight: 600 }}>
                      Validation response already submitted (Response: {validationRequestStatus.response}). Cannot submit again.
                    </Typography>
                  )}
                </Alert>

                {/* Display validation request details from registry */}
                {validationRequestStatus && (
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                      Validation Request Details
                    </Typography>
                    <Stack spacing={1}>
                      {validationRequestStatus.agentId !== undefined && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Agent ID (being validated):
                          </Typography>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {typeof validationRequestStatus.agentId === 'bigint' 
                              ? validationRequestStatus.agentId.toString()
                              : String(validationRequestStatus.agentId)}
                          </Typography>
                        </Box>
                      )}
                      {validationRequestStatus.validatorAddress && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Validator Address:
                          </Typography>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            {validationRequestStatus.validatorAddress}
                          </Typography>
                        </Box>
                      )}
                      {validationRequestStatus.requestUri && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Request URI:
                          </Typography>
                          <Typography 
                            variant="body2" 
                            sx={{ 
                              fontFamily: 'monospace', 
                              wordBreak: 'break-all',
                              color: 'primary.main',
                              textDecoration: 'underline',
                              cursor: 'pointer',
                            }}
                            onClick={() => window.open(validationRequestStatus.requestUri, '_blank')}
                          >
                            {validationRequestStatus.requestUri}
                          </Typography>
                        </Box>
                      )}
                      {validationRequestStatus.lastUpdate !== undefined && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Last Update:
                          </Typography>
                          <Typography variant="body2">
                            {new Date(
                              (typeof validationRequestStatus.lastUpdate === 'bigint' 
                                ? Number(validationRequestStatus.lastUpdate) 
                                : validationRequestStatus.lastUpdate) * 1000
                            ).toLocaleString()}
                          </Typography>
                        </Box>
                      )}
                      {validationRequestStatus.response !== undefined && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Response Status:
                          </Typography>
                          <Typography variant="body2">
                            {validationRequestStatus.response === 0 || validationRequestStatus.response === '0' 
                              ? 'Pending (no response yet)' 
                              : `Responded with score: ${validationRequestStatus.response}`}
                          </Typography>
                        </Box>
                      )}
                      {validationRequestStatus.responseUri && (
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Response URI:
                          </Typography>
                          <Typography 
                            variant="body2" 
                            sx={{ 
                              fontFamily: 'monospace', 
                              wordBreak: 'break-all',
                              color: 'primary.main',
                              textDecoration: 'underline',
                              cursor: 'pointer',
                            }}
                            onClick={() => window.open(validationRequestStatus.responseUri, '_blank')}
                          >
                            {validationRequestStatus.responseUri}
                          </Typography>
                        </Box>
                      )}
                    </Stack>
                  </Paper>
                )}

                {!validationResponseAlreadySubmitted && (
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      Response URI will be automatically generated and uploaded to IPFS with the validation result information.
                    </Typography>
                    <TextField
                      label="Response Score (0-100)"
                      type="number"
                      fullWidth
                      value={validationResponseScore}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (!isNaN(val) && val >= 0 && val <= 100) {
                          setValidationResponseScore(val);
                        }
                      }}
                      inputProps={{ min: 0, max: 100 }}
                      helperText="Score from 0 (invalid) to 100 (fully valid)"
                      disabled={validationResponseAlreadySubmitted}
                    />
                  </>
                )}
                {validationResponseError && (
                  <Alert severity="error">{validationResponseError}</Alert>
                )}
              </>
            ) : validationResponseError ? (
              <Alert severity="error">{validationResponseError}</Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setValidateDialogOpen(false)} disabled={validationResponseLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => handleSubmitValidationResponse(validationResponseScore)}
            disabled={
              validationResponseLoading ||
              !validationRequestHash ||
              validationResponseAlreadySubmitted ||
              validationResponseScore < 0 ||
              validationResponseScore > 100
            }
            startIcon={validationResponseLoading ? <CircularProgress size={16} /> : undefined}
            sx={{ backgroundColor: palette.accent, '&:hover': { backgroundColor: palette.border } }}
          >
            {validationResponseLoading ? 'Submitting...' : 'Submit Response'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Association Approval Dialog */}
      <Dialog open={approveAssociationOpen} onClose={() => setApproveAssociationOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Approve Association</DialogTitle>
        <DialogContent dividers>
          {approveAssociationError && <Alert severity="error">{approveAssociationError}</Alert>}
          {approveAssociationPayload ? (
            <Stack spacing={1}>
              <Typography variant="body2">
                <strong>Type:</strong> {approveAssociationPayload.assocType}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                <strong>Description:</strong> {approveAssociationPayload.description || '—'}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                initiator: {approveAssociationPayload.initiatorAddress}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                approver: {approveAssociationPayload.approverAddress}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                digest: {approveAssociationPayload.digest}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2">No association payload found.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveAssociationOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!approveAssociationPayload || approveAssociationLoading}
            onClick={async () => {
              if (!approveAssociationPayload || !selectedFolderAgent) return;
              setApproveAssociationLoading(true);
              setApproveAssociationError(null);
              try {
                const chainId = approveAssociationPayload.chainId;
                const chain = getChainById(chainId);
                if (!eip1193Provider || !walletAddress) throw new Error('Wallet not connected');
                const signerEoa = await getConnectedEoaAddress(eip1193Provider);

                // Switch chain
                if (typeof eip1193Provider.request === 'function') {
                  const targetHex = `0x${chainId.toString(16)}`;
                  try {
                    await eip1193Provider.request({
                      method: 'wallet_switchEthereumChain',
                      params: [{ chainId: targetHex }],
                    });
                  } catch {}
                }

                const isEoaOwnedApprover =
                  Boolean(selectedFolderAgent?.agentAccount) &&
                  String(selectedFolderAgent.agentAccount || '').toLowerCase() === String(signerEoa).toLowerCase();

                // For AA approvers, build the deployed smart account client for bundler submission.
                let approverAccountClient: any | null = null;
                if (!isEoaOwnedApprover) {
                  const bundlerUrl = getClientBundlerUrl(chainId);
                  if (!bundlerUrl) throw new Error(`Bundler URL not configured for chain ${chainId}`);
                  const approverAgentName = selectedFolderAgent.agentName || '';
                  if (!approverAgentName) throw new Error('Approver agent name is required');
                  approverAccountClient = await getDeployedAccountClientByAgentName(
                    bundlerUrl,
                    approverAgentName,
                    walletAddress as `0x${string}`,
                    { chain: chain as any, ethereumProvider: eip1193Provider as any },
                  );
                }

                // Approver signature (prefer matching initiator's signing method)
                const preferredMethod = approveAssociationPayload.signatureMethod;
                // Rebuild typed data (so wallets that don't support eth_sign can use signTypedData).
                const { ethers } = await import('ethers');
                const toMinimalBigEndianBytes = (n: bigint): Uint8Array => {
                  if (n === 0n) return new Uint8Array([0]);
                  let hex = n.toString(16);
                  if (hex.length % 2) hex = `0${hex}`;
                  return ethers.getBytes(`0x${hex}`);
                };
                const formatEvmV1 = (chainId: number, address: string): string => {
                  const addr = ethers.getAddress(address);
                  const chainRef = toMinimalBigEndianBytes(BigInt(chainId));
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
                const initiatorInterop = formatEvmV1(chainId, approveAssociationPayload.initiatorAddress);
                const approverInterop = formatEvmV1(chainId, approveAssociationPayload.approverAddress);
                const typedData = buildAssociationTypedData({
                  initiatorInterop,
                  approverInterop,
                  validAt: approveAssociationPayload.validAt,
                  validUntil: approveAssociationPayload.validUntil,
                  interfaceId: approveAssociationPayload.interfaceId,
                  data: approveAssociationPayload.data,
                });
                const approverSig = await signAssociationDigest({
                  provider: eip1193Provider,
                  signerAddress: signerEoa,
                  digest: approveAssociationPayload.digest,
                  typedData,
                  preferredMethod,
                });

                let res: any = null;
                try {
                  res = await finalizeAssociationWithWallet({
                    chain: chain as any,
                    ...(isEoaOwnedApprover
                      ? {
                          mode: 'eoa' as const,
                          ethereumProvider: eip1193Provider as any,
                          account: signerEoa,
                        }
                      : { mode: 'smartAccount' as const, submitterAccountClient: approverAccountClient }),
                    requesterDid: approveAssociationPayload.initiatorDid,
                    initiatorAddress: approveAssociationPayload.initiatorAddress,
                    approverAddress: approveAssociationPayload.approverAddress,
                    assocType: approveAssociationPayload.assocType,
                    description: approveAssociationPayload.description,
                    validAt: approveAssociationPayload.validAt,
                    data: approveAssociationPayload.data,
                    initiatorSignature: approveAssociationPayload.initiatorSignature,
                    approverSignature: approverSig.signature,
                    onStatusUpdate: (msg: string) => console.log('[Association Approve]', msg),
                  } as any);
                } catch (e: any) {
                  // Retry once with a different signing method (never use personal_sign; it won't validate on-chain).
                  if (!preferredMethod) {
                    const fallbackMethod =
                      approverSig.method === 'eth_sign'
                        ? 'eth_signTypedData_v4'
                        : 'eth_sign';
                    const fallbackSig = await signAssociationDigest({
                      provider: eip1193Provider,
                      signerAddress: signerEoa,
                      digest: approveAssociationPayload.digest,
                      typedData,
                      preferredMethod: fallbackMethod,
                    });
                    res = await finalizeAssociationWithWallet({
                      chain: chain as any,
                      ...(isEoaOwnedApprover
                        ? {
                            mode: 'eoa' as const,
                            ethereumProvider: eip1193Provider as any,
                            account: signerEoa,
                          }
                        : { mode: 'smartAccount' as const, submitterAccountClient: approverAccountClient }),
                      requesterDid: approveAssociationPayload.initiatorDid,
                      initiatorAddress: approveAssociationPayload.initiatorAddress,
                      approverAddress: approveAssociationPayload.approverAddress,
                      assocType: approveAssociationPayload.assocType,
                      description: approveAssociationPayload.description,
                      validAt: approveAssociationPayload.validAt,
                      data: approveAssociationPayload.data,
                      initiatorSignature: approveAssociationPayload.initiatorSignature,
                      approverSignature: fallbackSig.signature,
                      onStatusUpdate: (msg: string) => console.log('[Association Approve]', msg),
                    } as any);
                  } else {
                    throw e;
                  }
                }

                console.log('[Association Approve] Stored association (UserOp hash):', res.txHash);
                setApproveAssociationOpen(false);
              } catch (e: any) {
                setApproveAssociationError(e?.message || 'Failed to approve association');
              } finally {
                setApproveAssociationLoading(false);
              }
            }}
          >
            {approveAssociationLoading ? 'Approving…' : 'Approve & Store'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

