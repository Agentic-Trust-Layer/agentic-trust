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

type AgentDetailsPageContentProps = {
  agent: AgentsPageAgent;
  feedbackItems: unknown[];
  feedbackSummary: AgentDetailsFeedbackSummary;
  validations: AgentDetailsValidationsSummary | null;
  heroImageSrc: string;
  heroImageFallbackSrc: string;
  displayDid: string;
  chainId: number;
  ownerDisplay: string;
  validationSummaryText: string;
  reviewsSummaryText: string;
  onChainMetadata?: Record<string, string>;
};

type DialogState = {
  type: 'give-feedback' | 'feedback-request' | null;
  loading?: boolean;
};

export default function AgentDetailsPageContent({
  agent,
  feedbackItems,
  feedbackSummary,
  validations,
  heroImageSrc,
  heroImageFallbackSrc,
  displayDid,
  chainId,
  ownerDisplay,
  validationSummaryText,
  reviewsSummaryText,
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
  const [agentCard, setAgentCard] = useState<any>(null);
  const [trustGraphModalOpen, setTrustGraphModalOpen] = useState(false);
  const [reviewsModalOpen, setReviewsModalOpen] = useState(false);
  const [validationsModalOpen, setValidationsModalOpen] = useState(false);
  const [feedbackRequestReason, setFeedbackRequestReason] = useState('');
  const [sendingFeedbackRequest, setSendingFeedbackRequest] = useState(false);
  const [feedbackRequestSuccess, setFeedbackRequestSuccess] = useState(false);
  const [feedbackRequestError, setFeedbackRequestError] = useState<string | null>(null);
  const [selectedFromAgentId, setSelectedFromAgentId] = useState<string>('');

  const did8004 = useMemo(() => buildDid8004(chainId, Number(agent.agentId)), [chainId, agent.agentId]);
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

  const completedValidationCount = validations?.completed?.length ?? 0;
  const pendingValidationCount = validations?.pending?.length ?? 0;
  const feedbackCount =
    typeof feedbackSummary?.count === 'string'
      ? parseInt(feedbackSummary.count, 10)
      : feedbackSummary?.count ?? 0;
  const feedbackAverage = feedbackSummary?.averageScore ?? null;
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

  const [derivedAssociationCounts, setDerivedAssociationCounts] = useState<{
    initiated: number;
    approved: number;
  } | null>(null);

  useEffect(() => {
    if (!agent.agentAccount) {
      setDerivedAssociationCounts(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/associations?account=${encodeURIComponent(agent.agentAccount)}&chainId=${chainId}`,
          { cache: 'no-store' },
        );
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!json || json.ok === false || !Array.isArray(json.associations)) {
          setDerivedAssociationCounts(null);
          return;
        }
        const centerLower = agent.agentAccount.toLowerCase();
        let initiated = 0;
        let approved = 0;
        for (const a of json.associations as any[]) {
          const initiator = typeof (a?.initiator ?? a?.initiatorAddress) === 'string'
            ? String(a.initiator ?? a.initiatorAddress).toLowerCase()
            : '';
          const approver = typeof (a?.approver ?? a?.approverAddress) === 'string'
            ? String(a.approver ?? a.approverAddress).toLowerCase()
            : '';
          if (initiator && initiator === centerLower) initiated += 1;
          if (approver && approver === centerLower) approved += 1;
        }
        setDerivedAssociationCounts({ initiated, approved });
      } catch {
        if (!cancelled) setDerivedAssociationCounts(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent.agentAccount, chainId]);

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
    console.log('[AgentDetails] Ownership debug:', {
      isConnected,
      walletAddress,
      agentOwnerAddress: agent.ownerAddress,
      agentAccount: agent.agentAccount,
      showManageButton,
      ownershipVerified,
      ownershipChecking,
      agentId: agent.agentId
    });
  }, [isConnected, walletAddress, agent.ownerAddress, agent.agentAccount, showManageButton, ownershipVerified, ownershipChecking, agent.agentId]);

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
          // Extract base domain from A2A endpoint and construct agent.json URL
          // Agent descriptor is always at base domain/.well-known/agent.json
          let cardUrl: string;
          if (a2aEndpoint.includes('agent.json')) {
            cardUrl = a2aEndpoint;
          } else {
            // Extract origin (base domain) from the A2A endpoint URL
            const url = new URL(a2aEndpoint);
            cardUrl = `${url.origin}/.well-known/agent.json`;
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
        const params = new URLSearchParams({
          clientAddress: walletAddress,
          agentId: agent.agentId.toString(),
          chainId: chainId.toString(),
        });

        const response = await fetch(
          `/api/agents/${encodeURIComponent(did8004)}/feedback-auth?${params.toString()}`,
        );

        

        if (cancelled) return;

        if (response.ok) {
          const data = await response.json();

          const feedbackAuthId =
            (data?.feedbackAuthId as string | undefined) ??
            (data?.feedbackAuth as string | undefined) ??
            null;

          if (feedbackAuthId === '0x0') {
            setFeedbackAuth(null);
            return;
          }
          if (feedbackAuthId) {
            setFeedbackAuth(feedbackAuthId);
          } else {
            setFeedbackAuth(null);
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
  }, [agent.a2aEndpoint, agent.agentId, chainId, did8004, isConnected, walletAddress]);

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
    if (!agent.tokenUri) return;
    router.push(`/admin-tools/${encodeURIComponent(did8004)}?tab=registration`);
  }, [agent.tokenUri, did8004, router]);

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
          type: 'feedback_request',
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
          requestType: 'feedback_request',
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
                  value={`${(derivedAssociationCounts?.initiated ?? indexerInitiatedAssociationsCount ?? '—').toString()} initiated · ${(derivedAssociationCounts?.approved ?? indexerApprovedAssociationsCount ?? '—').toString()} approved`}
                  title={`Derived from /api/associations: ${
                    derivedAssociationCounts
                      ? `${derivedAssociationCounts.initiated}/${derivedAssociationCounts.approved}`
                      : '—'
                  } · Indexer fields: ${
                    indexerInitiatedAssociationsCount ?? '—'
                  }/${indexerApprovedAssociationsCount ?? '—'}`}
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
                    title={`Trust Ledger${typeof (agent as any).trustLedgerBadgeCount === 'number' ? ` · badges: ${(agent as any).trustLedgerBadgeCount}` : ''}`}
                  >
                    score: {Math.round((agent as any).trustLedgerScore)} · rank: #{(agent as any).trustLedgerOverallRank}
                  </Typography>
                )}
            </Stack>
          </Stack>
        </Box>

        <AgentDetailsTabs
          agent={agent}
          feedbackItems={feedbackItems}
          feedbackSummary={feedbackSummary}
          validations={validations}
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

          {agentCard?.skills && agentCard.skills.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Skill (optional)
              </Typography>
              <TextField
                select
                fullWidth
                value={feedbackSkillId}
                onChange={(e) => setFeedbackSkillId(e.target.value)}
                disabled={submittingFeedback}
                SelectProps={{
                  native: true,
                }}
              >
                <option value="">Select a skill…</option>
                {agentCard.skills.map((skill: any) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name || skill.id}
                  </option>
                ))}
              </TextField>
            </Box>
          )}

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

                // Request feedbackAuth from server-side API endpoint
                const feedbackAuthParams = new URLSearchParams();
                feedbackAuthParams.set('clientAddress', clientAddress);
                if (agentName && typeof agentName === 'string') {
                  feedbackAuthParams.set('agentName', agentName);
                }
                if (agentId) {
                  feedbackAuthParams.set('agentId', agentId);
                }
                if (chainId) {
                  feedbackAuthParams.set('chainId', chainId.toString());
                }

                const feedbackAuthResponse = await fetch(`/api/agents/${encodeURIComponent(did8004)}/feedback-auth?${feedbackAuthParams.toString()}`);
                if (!feedbackAuthResponse.ok) {
                  const errorData = await feedbackAuthResponse.json().catch(() => ({}));
                  throw new Error(errorData.message || errorData.error || 'Failed to get feedback auth');
                }

                const feedbackAuthData = await feedbackAuthResponse.json();
                const feedbackAuthId = feedbackAuthData.feedbackAuthId;
                const resolvedAgentId = feedbackAuthData.agentId || agentId;
                const resolvedChainId = feedbackAuthData.chainId || chainId;

                if (!feedbackAuthId) {
                  throw new Error('No feedbackAuth returned by provider');
                }

                if (!resolvedAgentId) {
                  throw new Error('Agent ID is required');
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
        feedbackSummary={feedbackSummary}
        validations={validations}
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

