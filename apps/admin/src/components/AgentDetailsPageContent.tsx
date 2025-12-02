'use client';

import { Box, Container, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Button, Typography, Stack, TextField, Alert, Rating } from '@mui/material';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import AgentDetailsTabs, {
  type AgentDetailsFeedbackSummary,
  type AgentDetailsValidationsSummary,
} from '@/components/AgentDetailsTabs';
import type { AgentsPageAgent } from '@/components/AgentsPage';
import BackToAgentsButton from '@/components/BackToAgentsButton';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { buildDid8004 } from '@agentic-trust/core';
import { grayscalePalette as palette } from '@/styles/palette';
import SettingsIcon from '@mui/icons-material/Settings';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ShareIcon from '@mui/icons-material/Share';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';

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
};

type DialogState = {
  type: 'give-feedback' | null;
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
}: AgentDetailsPageContentProps) {
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

  const did8004 = useMemo(() => buildDid8004(chainId, Number(agent.agentId)), [chainId, agent.agentId]);

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

  // Fetch agent card when feedback dialog opens
  useEffect(() => {
    if (dialogState.type === 'give-feedback' && agent.a2aEndpoint && !agentCard) {
      const fetchAgentCard = async (a2aEndpoint: string) => {
        try {
          // Construct the agent-card.json URL from the A2A endpoint
          if (a2aEndpoint.includes('agent-card.json')) {
            const response = await fetch(a2aEndpoint);
            if (response.ok) {
                const card = await response.json();
                setAgentCard(card);
            }
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

          if (data.feedbackAuthId === "0x0") {
            setFeedbackAuth(null);
            return;
          }
          if (data.feedbackAuthId) {
            setFeedbackAuth(data.feedbackAuthId);
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
      // Request feedback auth with review period
      // This would trigger a request to the agent
      alert('Requesting feedback authorization from agent...');
      return;
    }
    openDialog('give-feedback');
  }, [feedbackAuth, openDialog]);

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
            border: '1px solid rgba(15,23,42,0.08)',
            background:
              'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(15,23,42,0.6) 55%, rgba(37,99,235,0.7) 100%)',
            color: '#f8fafc',
            display: 'flex',
            gap: { xs: '1.5rem', md: '2.5rem' },
            flexWrap: 'wrap',
            alignItems: 'stretch',
            boxShadow: '0 18px 45px rgba(15,23,42,0.25)',
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
              color: 'rgba(248,250,252,0.9)',
              backgroundColor: 'rgba(15,23,42,0.5)',
              '&:hover': {
                backgroundColor: 'rgba(15,23,42,0.7)',
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
                color: 'rgba(248,250,252,0.7)',
                marginBottom: '0.35rem',
              }}
            >
              Agent Details
            </p>
            <h1
              style={{
                margin: 0,
                fontSize: '2.5rem',
                lineHeight: 1.1,
              }}
            >
              {agent.agentName || `Agent #${agent.agentId}`}
            </h1>
            <p
              style={{
                margin: '0.5rem 0 0',
                fontSize: '1rem',
                color: 'rgba(248,250,252,0.8)',
                fontWeight: 500,
              }}
            >
              Agent: #{agent.agentId}
            </p>
            <div
              style={{
                marginTop: '1.25rem',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.85rem',
              }}
            >
              {[
                { label: 'Chain', value: chainId.toString() },
                { label: 'Owner', value: ownerDisplay },
                { label: 'Validations', value: validationSummaryText },
                { label: 'Reputation', value: reviewsSummaryText },
              ].map((chip) => (
                <div
                  key={chip.label}
                  style={{
                    padding: '0.5rem 0.85rem',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(15,23,42,0.5)',
                    border: '1px solid rgba(248,250,252,0.18)',
                    fontSize: '0.85rem',
                  }}
                >
                  <strong style={{ fontWeight: 600 }}>{chip.label}:</strong>{' '}
                  <span style={{ fontWeight: 500 }}>{chip.value}</span>
                </div>
              ))}
            </div>
            
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
                    bgcolor: 'rgba(15,23,42,0.6)',
                    border: '1px solid rgba(248,250,252,0.3)',
                    '&:hover': {
                      bgcolor: 'rgba(15,23,42,0.8)',
                    },
                    textTransform: 'none',
                    fontWeight: 600,
                  }}
                >
                  Manage Agent
                </Button>
              )}

              {agent.a2aEndpoint && isConnected && (
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={feedbackAuthLoading ? null : <ChatBubbleOutlineIcon />}
                  onClick={handleGiveFeedback}
                  disabled={feedbackAuthLoading}
                  sx={{
                    bgcolor: feedbackAuth ? 'rgba(15,23,42,0.6)' : 'rgba(15,23,42,0.4)',
                    border: '1px solid rgba(248,250,252,0.3)',
                    color: feedbackAuth ? '#f8fafc' : 'rgba(248,250,252,0.7)',
                    '&:hover': {
                      bgcolor: feedbackAuth ? 'rgba(15,23,42,0.8)' : 'rgba(15,23,42,0.5)',
                    },
                    textTransform: 'none',
                    fontWeight: 600,
                  }}
                >
                  {feedbackAuthLoading ? 'Checking authorization...' : 'Give Feedback'}
                </Button>
              )}
            </Stack>

            <div
              style={{
                marginTop: '1.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
                fontSize: '0.95rem',
              }}
            >
              {agent.a2aEndpoint && (
                <div>
                  <span style={{ color: 'rgba(248,250,252,0.6)' }}>A2A:</span>{' '}
                  <a
                    href={agent.a2aEndpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#bfdbfe',
                      textDecoration: 'none',
                      wordBreak: 'break-all',
                    }}
                  >
                    {agent.a2aEndpoint}
                  </a>
                </div>
              )}
              {agent.agentAccountEndpoint && (
                <div>
                  <span style={{ color: 'rgba(248,250,252,0.6)' }}>MCP:</span>{' '}
                  <a
                    href={agent.agentAccountEndpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#bfdbfe',
                      textDecoration: 'none',
                      wordBreak: 'break-all',
                    }}
                  >
                    {agent.agentAccountEndpoint}
                  </a>
                </div>
              )}
            </div>
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
                width: '260px',
                borderRadius: '24px',
                overflow: 'hidden',
                border: '1px solid rgba(248,250,252,0.2)',
                boxShadow: '0 10px 30px rgba(15,23,42,0.35)',
                backgroundColor: 'rgba(15,23,42,0.4)',
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
                  width: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            </div>
          </Box>
        </Box>

        <AgentDetailsTabs
          agent={agent}
          feedbackItems={feedbackItems}
          feedbackSummary={feedbackSummary}
          validations={validations}
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
                A2A Endpoint
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

                const feedbackResult = await feedbackResponse.json();

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
    </Box>
  );
}

