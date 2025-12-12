'use client';

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
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useOwnedAgents } from '@/context/OwnedAgentsContext';
import { grayscalePalette as palette } from '@/styles/palette';
import SendIcon from '@mui/icons-material/Send';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import CreateOutlinedIcon from '@mui/icons-material/CreateOutlined';
import SearchIcon from '@mui/icons-material/Search';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import { useRouter } from 'next/navigation';
import { buildDid8004 } from '@agentic-trust/core';

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

export default function MessagesPage() {
  const {
    isConnected,
    privateKeyMode,
    loading,
    walletAddress,
    openLoginModal,
    handleDisconnect,
  } = useAuth();
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
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

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
      return (
        m.toAgentDid === selectedFromAgentDid ||
        (!m.toAgentDid && Boolean(selectedFolderAgent?.agentName) && m.toAgentName === selectedFolderAgent?.agentName)
      );
    },
    [selectedFromAgentDid, selectedFolderAgent?.agentName],
  );

  const isSentMessage = useCallback(
    (m: Message) => {
      if (!selectedFromAgentDid) return false;
      return (
        m.fromAgentDid === selectedFromAgentDid ||
        (!m.fromAgentDid && Boolean(selectedFolderAgent?.agentName) && m.fromAgentName === selectedFolderAgent?.agentName)
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
    setComposeTo('');
    setComposeSubject(
      selectedMessageType === 'feedback_request'
        ? 'Feedback Request'
        : selectedMessageType === 'validation_request'
          ? 'Validation Request'
          : '',
    );
    setComposeBody('');
    setComposeOpen(true);
  }, [selectedFolderAgent, selectedMessageType]);

  const handleSendMessage = useCallback(async () => {
    if (!selectedFolderAgent || !selectedFromAgentDid) {
      setError('Select an agent folder first.');
      return;
    }

    const toRaw = composeTo.trim();
    if (!toRaw) {
      setError('Recipient is required (Agent DID or agent name).');
      return;
    }

    const content = composeBody.trim();
    if (!content) {
      setError('Message body is required.');
      return;
    }

    setSending(true);
    setError(null);

    const toAgentDid = toRaw.startsWith('did:8004:') ? toRaw : undefined;
    const toAgentName = !toAgentDid ? toRaw : undefined;

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selectedMessageType,
          subject:
            composeSubject.trim() ||
            (selectedMessageType === 'feedback_request'
              ? 'Feedback Request'
              : selectedMessageType === 'validation_request'
                ? 'Validation Request'
                : 'Message'),
          content,
          fromClientAddress: walletAddress ?? undefined,
          fromAgentDid: selectedFromAgentDid,
          fromAgentName: selectedFolderAgent.agentName || undefined,
          toAgentDid,
          toAgentName,
          metadata: {
            source: 'admin-app',
            timestamp: new Date().toISOString(),
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to send message');
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
    composeTo,
    composeSubject,
    composeBody,
    selectedMessageType,
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
      default:
        return 'default';
    }
  };

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
                disabled={!isConnected || !selectedFolderAgent}
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
                          {selectedFromAgentDid || '—'}
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
                    {!isConnected ? (
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
                              const from = m.fromAgentName || m.fromAgentDid || m.fromClientAddress || 'Unknown';
                              const to = m.toAgentName || m.toAgentDid || m.toClientAddress || 'Unknown';
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

                        <Divider />

                        <Stack spacing={0.5}>
                          <Typography variant="body2" color="text.secondary">
                            <strong>From:</strong>{' '}
                            {selectedMessage.fromAgentName ||
                              selectedMessage.fromAgentDid ||
                              selectedMessage.fromClientAddress ||
                              'Unknown'}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            <strong>To:</strong>{' '}
                            {selectedMessage.toAgentName ||
                              selectedMessage.toAgentDid ||
                              selectedMessage.toClientAddress ||
                              'Unknown'}
                          </Typography>
                        </Stack>

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

            <TextField
              label="To (agent DID or agent name)"
              placeholder="did:8004:...  or  xyzalliance-arn.8004-agent.eth"
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              fullWidth
              size="small"
            />

            <TextField
              label="Subject"
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
              fullWidth
              size="small"
            />

            <TextField
              label="Message"
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              fullWidth
              multiline
              minRows={6}
            />
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
    </Box>
  );
}

