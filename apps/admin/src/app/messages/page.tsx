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
import SendIcon from '@mui/icons-material/Send';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import CreateOutlinedIcon from '@mui/icons-material/CreateOutlined';
import SearchIcon from '@mui/icons-material/Search';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import { useRouter } from 'next/navigation';
import { buildDid8004, parseDid8004 } from '@agentic-trust/core';

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
  const { connected: walletConnected, address: walletAddress, privateKeyMode, loading } = useWallet();
  const { ownedAgents: cachedOwnedAgents, loading: ownedAgentsLoading } = useOwnedAgents();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [selectedMessageType, setSelectedMessageType] = useState<'general' | 'feedback_request' | 'validation_request'>('general');
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
  const [validationRequestKind, setValidationRequestKind] = useState<'name' | 'account' | 'app' | 'aid'>('name');
  const [validationRequestDetails, setValidationRequestDetails] = useState('');

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
        ? 'Feedback Request'
        : selectedMessageType === 'validation_request'
          ? 'Validation Request'
          : '',
    );
    setComposeBody('');
    setFeedbackRequestComment('');
    setValidationRequestKind('name');
    setValidationRequestDetails('');
    setComposeOpen(true);
  }, [selectedFolderAgent, selectedMessageType]);

  // Async agent search for "To Agent" autocomplete
  useEffect(() => {
    let cancelled = false;
    const q = composeToAgentInput.trim();

    if (!composeOpen) return;
    if (!q) {
      setComposeToAgentOptions([]);
      setComposeToAgentLoading(false);
      return;
    }

    setComposeToAgentLoading(true);
    (async () => {
      try {
        const response = await fetch(
          `/api/agents/search?query=${encodeURIComponent(q)}&pageSize=10&orderBy=createdAtTime&orderDirection=DESC`,
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
  }, [composeOpen, composeToAgentInput]);

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
            ? `Validation Request: ${validationRequestKind}`
            : 'Message');

        const response = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: selectedMessageType,
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
    walletAddress,
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
        return 'Feedback Request';
      case 'validation_request':
        return 'Validation Request';
      case 'feedback_request_approved':
        return 'Feedback Request Approved';
      default:
        return 'General';
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
                <MenuItem value="general">General</MenuItem>
                <MenuItem value="feedback_request">Feedback Request</MenuItem>
                <MenuItem value="validation_request">Validation Request</MenuItem>
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

            {selectedMessageType !== 'feedback_request' && (
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
                    value={validationRequestKind}
                    label="Validation Type"
                    onChange={(e) => setValidationRequestKind(e.target.value as any)}
                  >
                    <MenuItem value="name">Name</MenuItem>
                    <MenuItem value="account">Account</MenuItem>
                    <MenuItem value="app">App</MenuItem>
                    <MenuItem value="aid">AID</MenuItem>
                  </Select>
                  <FormHelperText>Structured request for validators / automation.</FormHelperText>
                </FormControl>
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
    </Box>
  );
}

