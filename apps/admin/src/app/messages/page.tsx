'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Container, Typography, Button, TextField, Paper, Stack, Alert, CircularProgress, Chip, Divider, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { grayscalePalette as palette } from '@/styles/palette';
import SendIcon from '@mui/icons-material/Send';
import MessageIcon from '@mui/icons-material/Message';
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
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedMessageType, setSelectedMessageType] = useState<'feedback_request' | 'general' | 'collaboration'>('general');
  const [ownedAgents, setOwnedAgents] = useState<any[]>([]);
  const [loadingOwnedAgents, setLoadingOwnedAgents] = useState(false);
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('');

  const fetchOwnedAgents = useCallback(async () => {
    if (!isConnected || !walletAddress) {
      setOwnedAgents([]);
      setSelectedAgentKey('');
      return;
    }

    setLoadingOwnedAgents(true);
    try {
      const response = await fetch(`/api/agents/owned?eoaAddress=${encodeURIComponent(walletAddress)}&limit=100`);
      if (response.ok) {
        const data = await response.json();
        const agents = Array.isArray(data.agents) ? data.agents : [];
        const mapped = agents.map((agent: any) => ({
          agentId: String(agent.agentId || ''),
          chainId: typeof agent.chainId === 'number' ? agent.chainId : 0,
          agentName: agent.agentName || null,
        }));
        setOwnedAgents(mapped);
        if (mapped.length > 0 && !selectedAgentKey) {
          setSelectedAgentKey(`${mapped[0].chainId}:${mapped[0].agentId}`);
        }
      } else {
        const err = await response.json().catch(() => ({}));
        console.error('[Messages] Owned agents fetch failed', err);
      }
    } catch (err) {
      console.error('[Messages] Owned agents fetch error', err);
    } finally {
      setLoadingOwnedAgents(false);
    }
  }, [isConnected, walletAddress, selectedAgentKey]);

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
    if (isConnected && walletAddress) {
      fetchOwnedAgents();
    }
  }, [isConnected, walletAddress, fetchOwnedAgents]);

  useEffect(() => {
    if (selectedAgentKey) {
      fetchMessages();
    }
  }, [selectedAgentKey, fetchMessages]);

  const handleSendMessage = useCallback(async () => {
    if (!newMessage.trim()) {
      setError('Please enter a message');
      return;
    }

    if (!walletAddress) {
      setError('Wallet address not available. Please connect your wallet.');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: selectedMessageType,
          content: newMessage,
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

      setNewMessage('');
      await fetchMessages();
    } catch (err: any) {
      console.error('[Messages] Failed to send message:', err);
      setError(err?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }, [newMessage, selectedMessageType, walletAddress, fetchMessages]);

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
      case 'collaboration':
        return 'Collaboration';
      default:
        return 'General';
    }
  };

  const getMessageTypeColor = (type: string): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (type) {
      case 'feedback_request':
        return 'primary';
      case 'collaboration':
        return 'secondary';
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
      <Container
        maxWidth="lg"
        sx={{
          py: { xs: 4, md: 6 },
        }}
      >
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, color: palette.textPrimary }}>
              Messages
            </Typography>
            <Typography variant="body2" color="text.secondary">
              View and send messages to agents
            </Typography>
          </Box>

          {isConnected && (
            <Paper
              sx={{
                p: 3,
                border: `1px solid ${palette.border}`,
                borderRadius: '12px',
                backgroundColor: palette.surface,
              }}
            >
              <FormControl fullWidth>
                <InputLabel>Select Agent</InputLabel>
                <Select
                  label="Select Agent"
                  value={selectedAgentKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedAgentKey(val);
                    // Fetch immediately on selection
                    fetchMessages(val);
                  }}
                  disabled={loadingOwnedAgents || ownedAgents.length === 0}
                >
                  {loadingOwnedAgents && (
                    <MenuItem disabled>
                      <CircularProgress size={18} sx={{ mr: 1 }} /> Loading agents...
                    </MenuItem>
                  )}
                  {!loadingOwnedAgents && ownedAgents.length === 0 && (
                    <MenuItem disabled>No owned agents found</MenuItem>
                  )}
                  {ownedAgents.map((agent) => {
                    const key = `${agent.chainId}:${agent.agentId}`;
                    return (
                      <MenuItem key={key} value={key}>
                        {agent.agentName || `Agent #${agent.agentId}`} (Chain {agent.chainId}, ID {agent.agentId})
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Paper>
          )}

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Send Message Section */}
          {isConnected && (
            <Paper
              sx={{
                p: 3,
                border: `1px solid ${palette.border}`,
                borderRadius: '12px',
                backgroundColor: palette.surface,
              }}
            >
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 600, color: palette.textPrimary }}>
                  Send Message
                </Typography>

                <Stack direction="row" spacing={1}>
                  <Chip
                    label="General"
                    onClick={() => setSelectedMessageType('general')}
                    color={selectedMessageType === 'general' ? 'primary' : 'default'}
                    variant={selectedMessageType === 'general' ? 'filled' : 'outlined'}
                  />
                  <Chip
                    label="Feedback Request"
                    onClick={() => setSelectedMessageType('feedback_request')}
                    color={selectedMessageType === 'feedback_request' ? 'primary' : 'default'}
                    variant={selectedMessageType === 'feedback_request' ? 'filled' : 'outlined'}
                  />
                  <Chip
                    label="Collaboration"
                    onClick={() => setSelectedMessageType('collaboration')}
                    color={selectedMessageType === 'collaboration' ? 'primary' : 'default'}
                    variant={selectedMessageType === 'collaboration' ? 'filled' : 'outlined'}
                  />
                </Stack>

                <TextField
                  fullWidth
                  multiline
                  rows={4}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Enter your message..."
                  disabled={sending}
                />

                <Button
                  variant="contained"
                  startIcon={<SendIcon />}
                  onClick={handleSendMessage}
                  disabled={sending || !newMessage.trim()}
                  sx={{
                    backgroundColor: palette.accent,
                    '&:hover': {
                      backgroundColor: palette.border,
                    },
                    alignSelf: 'flex-start',
                  }}
                >
                  {sending ? 'Sending...' : 'Send Message'}
                </Button>
              </Stack>
            </Paper>
          )}

          {/* Messages List */}
          <Paper
            sx={{
              p: 3,
              border: `1px solid ${palette.border}`,
              borderRadius: '12px',
              backgroundColor: palette.surface,
            }}
          >
            <Stack spacing={2}>
              <Typography variant="h6" sx={{ fontWeight: 600, color: palette.textPrimary }}>
                Message History
              </Typography>

              {loadingMessages ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : messages.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <MessageIcon sx={{ fontSize: 48, color: palette.textSecondary, mb: 2 }} />
                  <Typography variant="body2" color="text.secondary">
                    {isConnected ? 'No messages yet. Send your first message above!' : 'Connect your wallet to view messages.'}
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={2}>
                  {messages.map((message) => (
                    <Box
                      key={message.id}
                      sx={{
                        p: 2,
                        border: `1px solid ${palette.border}`,
                        borderRadius: '8px',
                        backgroundColor: palette.surfaceMuted,
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <Chip
                          label={getMessageTypeLabel(message.contextType)}
                          size="small"
                          color={getMessageTypeColor(message.contextType)}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {formatTimestamp(message.createdAt)}
                        </Typography>
                      </Stack>
                      {(message.fromAgentName || message.toAgentName || message.fromAgentDid || message.toAgentDid) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          From: {message.fromAgentName || message.fromAgentDid || message.fromClientAddress || 'Unknown'} → To: {message.toAgentName || message.toAgentDid || message.toClientAddress || 'Unknown'}
                        </Typography>
                      )}
                      {message.subject && (
                        <Typography variant="subtitle2" sx={{ color: palette.textPrimary }}>
                          {message.subject}
                        </Typography>
                      )}
                      <Typography variant="body2" sx={{ color: palette.textPrimary, whiteSpace: 'pre-wrap' }}>
                        {message.body || '(no content)'}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}

