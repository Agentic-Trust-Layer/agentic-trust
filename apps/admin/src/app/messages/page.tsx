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
import SendIcon from '@mui/icons-material/Send';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import CreateOutlinedIcon from '@mui/icons-material/CreateOutlined';
import SearchIcon from '@mui/icons-material/Search';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import { useRouter } from 'next/navigation';
import { buildDid8004, parseDid8004, getDeployedAccountClientByAgentName } from '@agentic-trust/core';
import { getChainById, DEFAULT_CHAIN_ID } from '@agentic-trust/core/server';
import { requestNameValidationWithWallet, requestAppValidationWithWallet } from '@agentic-trust/core/client';
import { getClientBundlerUrl } from '@/lib/clientChainEnv';
import { keccak256, toHex } from 'viem';
import type { Chain } from 'viem';

type Message = {
  id: number;
  subject: string | null;
  body: string;
  contextType: string;
  contextId: string | null;
  fromAgentDid: string | null;
  fromAgentName: string | null;
  toAgentDid: string | null;
  toAgentName: string | null;
  fromClientAddress: string | null;
  toClientAddress: string | null;
  createdAt: number | null;
  readAt: number | null;
};

type AgentSearchOption = {
  key: string; // `${chainId}:${agentId}`
  chainId: number;
  agentId: string;
  agentName: string | null;
  image: string | null;
  did: string;
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
  const [selectedMessageType, setSelectedMessageType] = useState<'general' | 'feedback_request' | 'validation_request' | 'give_feedback'>('general');
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('');
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [folderSearch, setFolderSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [mailboxMode, setMailboxMode] = useState<'inbox' | 'sent'>('inbox');

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeToAgent, setComposeToAgent] = useState<AgentSearchOption | null>(null);
  const [composeToAgentInput, setComposeToAgentInput] = useState('');
  const [composeToAgentOptions, setComposeToAgentOptions] = useState<AgentSearchOption[]>([]);
  const [composeToAgentLoading, setComposeToAgentLoading] = useState(false);

  const [feedbackRequestComment, setFeedbackRequestComment] = useState('');
  const [validationRequestKind, setValidationRequestKind] = useState<ValidationClaimType>('compliance');
  const [validationRequestDetails, setValidationRequestDetails] = useState('');
  const [validationRequestDomain, setValidationRequestDomain] = useState('');

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

  const inboxCount = useMemo(() => messages.filter(isInboxMessage).length, [messages, isInboxMessage]);
  const sentCount = useMemo(() => messages.filter(isSentMessage).length, [messages, isSentMessage]);

  const selectedMessage = useMemo(() => {
    if (!selectedMessageId) return null;
    return messages.find((m) => m.id === selectedMessageId) ?? null;
  }, [messages, selectedMessageId]);

  const selectedMessageTargetDid = useMemo(() => {
    if (!selectedMessage) return null;
    // For feedback_request_approved, the sender is the target agent that will issue feedbackAuth.
    const did = normalizeDid(selectedMessage.fromAgentDid);
    return did || null;
  }, [selectedMessage]);

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
    if (!selectedMessage?.contextId) return null;
    const n = Number(selectedMessage.contextId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [selectedMessage]);

  const requestFeedbackAuthForSelectedMessage = useCallback(async () => {
    if (!selectedMessage) return;
    if (selectedMessage.contextType !== 'feedback_request_approved') return;
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
          skillId: 'agent.feedback.requestAuth',
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

      setFeedbackAuthValue(String(auth));
    } catch (err: any) {
      setFeedbackAuthError(err?.message || 'Failed to request feedback authorization');
    } finally {
      setFeedbackAuthLoading(false);
    }
  }, [
    selectedMessage,
    selectedMessageTargetDid,
    selectedMessageTargetParsed,
    selectedMessageFeedbackRequestId,
    walletAddress,
  ]);

  // Check if validation request exists in Validation Registry
  const checkValidationRequest = useCallback(async () => {
    if (!selectedMessage || selectedMessage.contextType !== 'validation_request') return;
    if (!selectedMessage.fromAgentDid || !selectedMessage.toAgentDid) return;
    if (!selectedFolderAgent) return;

    setCheckingValidationRequest(true);
    setValidationRequestHash(null);
    setValidationRequestStatus(null);

    try {
      // Parse the from agent DID (the agent being validated)
      const fromDid = normalizeDid(selectedMessage.fromAgentDid);
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
      
      if (allValidations.length > 0) {
        // Sort by lastUpdate descending (most recent first)
        const sorted = [...allValidations].sort((a: any, b: any) => {
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
        setValidationResponseError('No validation requests found in Validation Registry for this agent. The on-chain validation request may not have been created yet.');
      }
    } catch (err: any) {
      setValidationResponseError(err?.message || 'Failed to check validation request');
    } finally {
      setCheckingValidationRequest(false);
    }
  }, [selectedMessage, selectedFolderAgent]);

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
    if (!validationRequestHash || !selectedFolderAgent || !selectedMessage || !validationRequestStatus) return;
    
    // Check if response already exists
    if (validationRequestStatus.response !== undefined && validationRequestStatus.response !== 0 && validationRequestStatus.response !== '0') {
      setValidationResponseError(`Validation response already submitted (response: ${validationRequestStatus.response}). Cannot submit again.`);
      return;
    }

    if (!selectedMessage.fromAgentDid) {
      setValidationResponseError('From agent DID is required');
      return;
    }

    setValidationResponseLoading(true);
    setValidationResponseError(null);

    try {
      // Parse from agent DID to get agentId
      const fromDid = normalizeDid(selectedMessage.fromAgentDid);
      if (!fromDid.startsWith('did:8004:')) {
        throw new Error('From agent DID is not a valid did:8004');
      }
      const fromParsed = parseDid8004(fromDid);
      const requestingAgentId = fromParsed.agentId.toString();

      // Get validation kind from message metadata (metadata is stored in message context, check API response structure)
      // For now, use defaults - can be enhanced to parse from message body or context
      const validationKind = 'compliance';
      const validationDetails = 'Validation Request';

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
        taskId: generateTaskId(),
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
      const currentAgentDid = buildDid8004(selectedFolderAgent.chainId, selectedFolderAgent.agentId);
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
          skillId: 'atp.validation.respond',
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

      setValidateDialogOpen(false);
      setValidationRequestHash(null);
      setValidationRequestStatus(null);
      await fetchMessages();
    } catch (err: any) {
      setValidationResponseError(err?.message || 'Failed to submit validation response');
    } finally {
      setValidationResponseLoading(false);
    }
  }, [validationRequestHash, validationRequestStatus, selectedFolderAgent, selectedMessage, validationRequestDetails, fetchMessages]);

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
    if (selectedMessage?.contextType === 'feedback_request_approved') {
      // fire-and-forget; errors shown in UI
      requestFeedbackAuthForSelectedMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMessageId]);

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

  const visibleMessages = useMemo(() => {
    const mailboxFiltered =
      mailboxMode === 'sent' ? messages.filter(isSentMessage) : messages.filter(isInboxMessage);
    const q = messageSearch.trim().toLowerCase();
    if (!q) return mailboxFiltered;
    return mailboxFiltered.filter((m) => {
      const subj = (m.subject || '').toLowerCase();
      const body = (m.body || '').toLowerCase();
      const from = (m.fromAgentName || m.fromAgentDid || '').toLowerCase();
      const to = (m.toAgentName || m.toAgentDid || '').toLowerCase();
      return subj.includes(q) || body.includes(q) || from.includes(q) || to.includes(q);
    });
  }, [messages, messageSearch, mailboxMode, isInboxMessage, isSentMessage]);

  const handleOpenCompose = useCallback(() => {
    if (!selectedFolderAgent) {
      setError('Select an agent folder first.');
      return;
    }
    setError(null);
    setComposeToAgent(null);
    setComposeToAgentInput('');
    setComposeSubject(
      selectedMessageType === 'feedback_request'
        ? 'Request Feedback Permission'
        : selectedMessageType === 'validation_request'
          ? 'Request Validation'
          : selectedMessageType === 'give_feedback'
            ? 'Give Feedback'
            : '',
    );
    setComposeBody('');
    setFeedbackRequestComment('');
    setValidationRequestKind('compliance');
    setValidationRequestDetails('');
    setValidationRequestDomain('');
    setComposeOpen(true);
  }, [selectedFolderAgent, selectedMessageType]);

  // Async agent search for "To Agent" autocomplete
  // For validation requests, filter by agents with capability "Validation" or "Orchestration"
  useEffect(() => {
    let cancelled = false;
    const q = composeToAgentInput.trim();

    if (!composeOpen) return;
    
    setComposeToAgentLoading(true);
    (async () => {
      try {
        // For validation requests, we want to show all agents with Validation or Orchestration capability
        // We'll fetch all agents and filter client-side, or use a search query
        const searchQuery = selectedMessageType === 'validation_request' 
          ? (q || '') // For validation requests, allow empty query to show all matching agents
          : q; // For other message types, require a query
        
        if (!searchQuery && selectedMessageType !== 'validation_request') {
          setComposeToAgentOptions([]);
          setComposeToAgentLoading(false);
          return;
        }

        const response = await fetch(
          `/api/agents/search?query=${encodeURIComponent(searchQuery)}&pageSize=50&orderBy=createdAtTime&orderDirection=DESC`,
          { cache: 'no-store' },
        );
        if (!response.ok) {
          throw new Error(`Failed to search agents (${response.status})`);
        }
        const data = await response.json();
        let agents = Array.isArray(data?.agents) ? data.agents : [];
        
        // Filter by agentCategory for validation requests
        if (selectedMessageType === 'validation_request') {
          agents = agents.filter((a: any) => {
            const validCategories = [
              'Governance / Validation Agents',
              'Orchestrator / Coordinator Agents',
            ];
            
            // Check agentCategory in registration JSON (rawJson field)
            try {
              const rawJson = a?.rawJson;
              if (rawJson && typeof rawJson === 'string') {
                const registration = JSON.parse(rawJson);
                const agentCategory = registration?.agentCategory;
                if (typeof agentCategory === 'string') {
                  return validCategories.includes(agentCategory);
                }
              }
              // Also check if agentCategory is directly on the agent object
              const agentCategory = a?.agentCategory;
              if (typeof agentCategory === 'string') {
                return validCategories.includes(agentCategory);
              }
              return false;
            } catch {
              return false;
            }
          });
        }
        
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
  }, [composeOpen, composeToAgentInput, selectedMessageType]);

  // Load validation/orchestration agents when compose dialog opens for validation requests
  useEffect(() => {
    if (!composeOpen || selectedMessageType !== 'validation_request') return;
    
    // Trigger the agent search with empty query to load all validation/orchestration agents
    if (!composeToAgentInput) {
      // Set a minimal query to trigger the search, or we can fetch directly
      const loadValidationAgents = async () => {
        try {
          const response = await fetch(
            `/api/agents/search?pageSize=100&orderBy=createdAtTime&orderDirection=DESC`,
            { cache: 'no-store' },
          );
          if (!response.ok) return;
          const data = await response.json();
          let agents = Array.isArray(data?.agents) ? data.agents : [];
          
          // Filter by agentCategory
          const validCategories = [
            'Governance / Validation Agents',
            'Orchestrator / Coordinator Agents',
          ];
          agents = agents.filter((a: any) => {
            try {
              // Check agentCategory in registration JSON (rawJson field)
              const rawJson = a?.rawJson;
              if (rawJson && typeof rawJson === 'string') {
                const registration = JSON.parse(rawJson);
                const agentCategory = registration?.agentCategory;
                if (typeof agentCategory === 'string') {
                  return validCategories.includes(agentCategory);
                }
              }
              // Also check if agentCategory is directly on the agent object
              const agentCategory = a?.agentCategory;
              if (typeof agentCategory === 'string') {
                return validCategories.includes(agentCategory);
              }
              return false;
            } catch {
              return false;
            }
          });
          
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
          
          setComposeToAgentOptions(mapped);
        } catch (e) {
          // Ignore errors
        }
      };
      
      void loadValidationAgents();
    }
  }, [composeOpen, selectedMessageType, composeToAgentInput]);

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
      if (selectedMessageType === 'feedback_request') {
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
        if (!content) {
          throw new Error('Message body is required.');
        }

        const subject =
          composeSubject.trim() ||
          (selectedMessageType === 'validation_request'
            ? `Request Validation: ${validationRequestKind}`
            : selectedMessageType === 'give_feedback'
              ? 'Give Feedback'
              : 'Message');

        // For validation requests, also create an on-chain validation request
        if (selectedMessageType === 'validation_request') {
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
            const toAgentDid = composeToAgent.did;
            const toAgentResponse = await fetch(`/api/agents/${encodeURIComponent(toAgentDid)}`);
            if (!toAgentResponse.ok) {
              throw new Error('Failed to fetch To Agent details');
            }
            const toAgentData = await toAgentResponse.json();
            const validatorAddress = toAgentData?.agentAccount || toAgentData?.account;
            
            if (!validatorAddress) {
              throw new Error('To Agent account address not found. The agent must have an account address to be used as a validator.');
            }

            console.log('[Validation Request] Using To Agent as validator:', {
              toAgentDid,
              toAgentName: composeToAgent.agentName,
              validatorAddress,
            });

            // Determine which validation function to use based on validationKind
            // Map ValidationClaimType to appropriate validator
            const useNameValidator = validationRequestKind === 'compliance' || validationRequestKind === 'identity';
            const requestValidationFn = useNameValidator ? requestNameValidationWithWallet : requestAppValidationWithWallet;

            // Create on-chain validation request
            const requesterDid = buildDid8004(chainId, selectedFolderAgent.agentId);
            const validationResult = await requestValidationFn({
              requesterDid,
              requestUri,
              requestHash,
              chain: chain as any,
              requesterAccountClient: agentAccountClient,
              validatorAddress, // Pass the "To Agent" account address as the validator
              onStatusUpdate: (msg: string) => console.log('[Validation Request]', msg),
            } as any);

            console.log('[Validation Request] Created on-chain:', {
              txHash: validationResult.txHash,
              validatorAddress: validationResult.validatorAddress,
              requestHash: validationResult.requestHash,
            });
          } catch (validationErr: any) {
            console.error('[Validation Request] Failed to create on-chain validation request:', validationErr);
            // Continue with message sending even if validation request creation fails
            // The user will still get the message notification
          }
        }

        const response = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: selectedMessageType === 'give_feedback' ? 'give_feedback' : selectedMessageType,
            subject,
            content,
            fromClientAddress: walletAddress ?? undefined,
            fromAgentDid: selectedFromAgentDid,
            fromAgentName: selectedFolderAgent.agentName || undefined,
            toAgentDid: composeToAgent.did,
            toAgentName: composeToAgent.agentName || undefined,
            metadata: {
              source: 'admin-app',
              timestamp: new Date().toISOString(),
              ...(selectedMessageType === 'validation_request'
                ? { validationKind: validationRequestKind, validationDetails: validationRequestDetails || undefined }
                : {}),
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || errorData.error || 'Failed to send message');
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
    walletAddress,
    eip1193Provider,
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
      case 'feedback_request':
        return 'Request Feedback Permission';
      case 'validation_request':
        return 'Request Validation';
      case 'feedback_request_approved':
        return 'Feedback Request Approved';
      case 'give_feedback':
        return 'Give Feedback';
      default:
        return 'General Message';
    }
  };

  const getMessageTypeColor = (type: string): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (type) {
      case 'feedback_request':
        return 'primary';
      case 'validation_request':
        return 'warning';
      case 'feedback_request_approved':
        return 'success';
      default:
        return 'default';
    }
  };

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
                          setSelectedMessageId(null);
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
                                setSelectedMessageId(null);
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
                                setSelectedMessageId(null);
                              }}
                              color={mailboxMode === 'sent' ? 'primary' : 'default'}
                              variant={mailboxMode === 'sent' ? 'filled' : 'outlined'}
                              size="small"
                            />
                          </Stack>
                        </Box>

                        {visibleMessages.length === 0 ? (
                          <Box sx={{ p: 3 }}>
                            <Typography color="text.secondary">
                              {mailboxMode === 'sent' ? 'No sent messages.' : 'No inbox messages.'}
                            </Typography>
                          </Box>
                        ) : (
                          <List disablePadding>
                            {visibleMessages.map((m) => {
                              const selected = m.id === selectedMessageId;
                              const unread = mailboxMode === 'inbox' && !m.readAt;
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
                              const subj = m.subject || getMessageTypeLabel(m.contextType);
                              const preview = (m.body || '').slice(0, 120);
                              return (
                                <React.Fragment key={m.id}>
                                  <ListItemButton
                                    selected={selected}
                                    onClick={() => setSelectedMessageId(m.id)}
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
                                              label={getMessageTypeLabel(m.contextType)}
                                              size="small"
                                              color={getMessageTypeColor(m.contextType)}
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
                    {!selectedMessage ? (
                      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Stack spacing={1} alignItems="center">
                          <MailOutlineIcon color="action" />
                          <Typography variant="body2" color="text.secondary">
                            Select a message to read.
                          </Typography>
                        </Stack>
                      </Box>
                    ) : (
                      <Stack spacing={2}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
                              {selectedMessage.subject || getMessageTypeLabel(selectedMessage.contextType)}
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                              <Chip
                                label={getMessageTypeLabel(selectedMessage.contextType)}
                                size="small"
                                color={getMessageTypeColor(selectedMessage.contextType)}
                              />
                              <Typography variant="caption" color="text.secondary">
                                {formatTimestamp(selectedMessage.createdAt)}
                              </Typography>
                            </Stack>
                          </Box>
                        </Stack>

                        {mailboxMode === 'inbox' &&
                          selectedMessage.contextType === 'feedback_request' &&
                          selectedMessage.contextId && (
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

                        {mailboxMode === 'inbox' &&
                          selectedMessage.contextType === 'validation_request' && (
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

                        <Divider />

                        <Stack spacing={0.5}>
                          <Typography variant="body2" color="text.secondary">
                            <strong>From:</strong>{' '}
                            {selectedMessage.fromAgentName ||
                              (selectedMessage.fromAgentDid ? displayDid(selectedMessage.fromAgentDid) : null) ||
                              selectedMessage.fromClientAddress ||
                              'Unknown'}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            <strong>To:</strong>{' '}
                            {selectedMessage.toAgentName ||
                              (selectedMessage.toAgentDid ? displayDid(selectedMessage.toAgentDid) : null) ||
                              selectedMessage.toClientAddress ||
                              'Unknown'}
                          </Typography>
                        </Stack>

                        {mailboxMode === 'inbox' &&
                          selectedMessage.contextType === 'feedback_request_approved' && (
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

                        <Paper variant="outlined" sx={{ p: 2, borderColor: palette.border, backgroundColor: palette.surface }}>
                          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                            {selectedMessage.body}
                          </Typography>
                        </Paper>
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
              <InputLabel id="compose-message-type-label">Message Type</InputLabel>
              <Select
                id="compose-message-type"
                labelId="compose-message-type-label"
                value={selectedMessageType}
                label="Message Type"
                onChange={(e) => setSelectedMessageType(e.target.value as any)}
              >
                <MenuItem value="general">General Message</MenuItem>
                <MenuItem value="feedback_request">Request Feedback Permission</MenuItem>
                <MenuItem value="validation_request">Request Validation</MenuItem>
                <MenuItem value="give_feedback">Give Feedback</MenuItem>
              </Select>
              <FormHelperText>
                Use standard types for inbox filtering. Sender is the selected agent folder.
              </FormHelperText>
            </FormControl>

            <Autocomplete
              options={composeToAgentOptions}
              value={composeToAgent}
              onChange={(_, value) => setComposeToAgent(value)}
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
                  placeholder="Search agents…"
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

            {selectedMessageType !== 'feedback_request' && selectedMessageType !== 'give_feedback' && (
              <TextField
                label="Subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                fullWidth
                size="small"
              />
            )}

            {selectedMessageType === 'feedback_request' ? (
              <TextField
                label="Why do you want to give feedback?"
                value={feedbackRequestComment}
                onChange={(e) => setFeedbackRequestComment(e.target.value)}
                fullWidth
                multiline
                minRows={5}
                placeholder="e.g., I used this agent and want to share my experience…"
              />
            ) : selectedMessageType === 'validation_request' ? (
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
            ) : selectedMessageType === 'give_feedback' ? (
              <Stack spacing={2}>
                <TextField
                  label="Message"
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  fullWidth
                  multiline
                  minRows={6}
                  placeholder="Share your feedback about this agent…"
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
            {selectedMessage?.fromAgentName || (selectedMessage?.fromAgentDid ? displayDid(selectedMessage.fromAgentDid) : '—')}
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
            disabled={approving || !selectedMessage?.contextId}
            startIcon={approving ? <CircularProgress size={16} /> : undefined}
            onClick={async () => {
              try {
                setApproving(true);
                setApproveError(null);
                setApproveSuccess(null);

                const feedbackRequestId = Number(selectedMessage?.contextId);
                if (!Number.isFinite(feedbackRequestId) || feedbackRequestId <= 0) {
                  throw new Error('Missing feedback request id on message.');
                }

                if (!selectedMessage?.fromAgentDid || !selectedMessage?.toAgentDid) {
                  throw new Error('Missing from/to agent DID on message.');
                }

                const res = await fetch('/api/agents-atp/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    skillId: 'atp.feedback.requestapproved',
                    payload: {
                      feedbackRequestId,
                      fromAgentDid: selectedMessage.fromAgentDid,
                      toAgentDid: selectedMessage.toAgentDid,
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
            Validating: {selectedMessage?.fromAgentName || (selectedMessage?.fromAgentDid ? displayDid(selectedMessage.fromAgentDid) : '—')}
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
    </Box>
  );
}

