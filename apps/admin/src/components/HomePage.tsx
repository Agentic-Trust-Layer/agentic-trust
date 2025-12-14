'use client';

import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Grid,
  Link as MuiLink,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import {
  ArrowOutward,
  AutoGraph,
  Explore as ExploreIcon,
  GitHub,
  Group,
  ShieldOutlined,
  Telegram,
  Timeline,
  Twitter,
  Verified,
  Forum,
} from '@mui/icons-material';
import { useWeb3Auth } from './Web3AuthProvider';
import { useWallet } from './WalletProvider';
import { grayscalePalette as palette } from '@/styles/palette';

const neutralButtonStyle = (disabled?: boolean) => ({
  padding: '1rem',
  backgroundColor: disabled ? palette.accentMuted : palette.accent,
  color: palette.surface,
  border: `1px solid ${palette.borderStrong}`,
  borderRadius: '8px',
  fontSize: '1rem',
  fontWeight: 'bold',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.65 : 1,
});

type LoginModalProps = {
  onClose?: () => void;
};

export function LoginModal({ onClose }: LoginModalProps) {
  const { connect, loading } = useWeb3Auth();
  const {
    connect: walletConnect,
    connected: walletConnected,
    loading: walletLoading,
  } = useWallet();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSocialLogin = async (
    provider: 'google' | 'facebook' | 'twitter' | 'github',
  ) => {
    try {
      setConnecting(true);
      setError(null);
      await connect('social', provider);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to connect';
      if (!errorMessage.toLowerCase().includes('cancelled')) {
        setError(errorMessage);
      }
      setConnecting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          position: 'relative',
          padding: '3rem',
          backgroundColor: palette.surface,
          borderRadius: '12px',
          border: `1px solid ${palette.border}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          maxWidth: '500px',
          width: '100%',
        }}
      >
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '1rem',
              right: '1rem',
              border: 'none',
              background: 'transparent',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: palette.textMuted,
            }}
            aria-label="Close login modal"
          >
            ×
          </button>
        )}

        <h1
          style={{
            marginBottom: '2rem',
            fontSize: '2rem',
            fontWeight: 'bold',
            textAlign: 'center',
          }}
        >
          Agentic Trust Community Connect
        </h1>

        {error && (
          <div
            style={{
              marginBottom: '1.5rem',
              padding: '1rem',
              backgroundColor: palette.dangerSurface,
              borderRadius: '4px',
              color: palette.dangerText,
              border: `1px solid ${palette.borderStrong}`,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <button
            onClick={() => handleSocialLogin('google')}
            disabled={loading || connecting}
            style={neutralButtonStyle(loading || connecting)}
          >
            {connecting ? 'Connecting...' : 'Continue with Google'}
          </button>

          <button
            onClick={() => handleSocialLogin('github')}
            disabled={loading || connecting}
            style={neutralButtonStyle(loading || connecting)}
          >
            {connecting ? 'Connecting...' : 'Continue with GitHub'}
          </button>

          <button
            onClick={() => handleSocialLogin('twitter')}
            disabled={loading || connecting}
            style={neutralButtonStyle(loading || connecting)}
          >
            {connecting ? 'Connecting...' : 'Continue with Twitter'}
          </button>

          <button
            onClick={() => handleSocialLogin('facebook')}
            disabled={loading || connecting}
            style={neutralButtonStyle(loading || connecting)}
          >
            {connecting ? 'Connecting...' : 'Continue with Facebook'}
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              margin: '1rem 0',
            }}
          >
            <div
              style={{ flex: 1, height: '1px', backgroundColor: palette.border }}
            />
            <span style={{ color: palette.textMuted }}>OR</span>
            <div
              style={{ flex: 1, height: '1px', backgroundColor: palette.border }}
            />
          </div>

          <button
            onClick={async () => {
              try {
                setConnecting(true);
                setError(null);
                await walletConnect();
                setConnecting(false);
              } catch (err) {
                const errorMessage =
                  err instanceof Error
                    ? err.message
                    : 'Failed to connect wallet';
                setError(errorMessage);
                setConnecting(false);
              }
            }}
            disabled={walletLoading || connecting || walletConnected}
            style={neutralButtonStyle(walletLoading || connecting || walletConnected)}
          >
            {walletConnected
              ? 'Wallet Connected'
              : walletLoading || connecting
              ? 'Connecting...'
              : 'Connect Direct Wallet'}
          </button>
        </div>
      </div>
    </div>
  );
}

type HomePageProps = {
  onNavigateAgents: () => void;
  onOpenAdminTools?: () => void;
  isConnected?: boolean;
};

const articleUrl =
  'https://blockchain.news/ainews/agent-trust-graphs-for-erc-8004-ai-agents-visualizing-on-chain-validator-networks-and-real-reputation-scores';

export function HomePage({
  onNavigateAgents,
  onOpenAdminTools,
  isConnected,
}: HomePageProps) {
  const primaryCta = 'Explore the Agent Community';

  return (
    <Box
      component="main"
      sx={{
        bgcolor: 'background.default',
        color: 'text.primary',
        borderRadius: 4,
        border: `1px solid ${palette.border}`,
        boxShadow: '0 24px 60px rgba(15,23,42,0.12)',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: { xs: 3, md: 5 },
          py: { xs: 6, md: 8 },
          bgcolor: 'background.default',
        }}
      >
        <Container maxWidth="lg">
          <Stack spacing={{ xs: 8, md: 10 }}>
            {/* Hero */}
            <Box textAlign="center">
              <Typography
                variant="overline"
                sx={{ letterSpacing: '0.2em', color: 'text.secondary', fontWeight: 700 }}
              >
                ERC-8004 · Identity · Validation · Reputation
              </Typography>
              <Typography
                variant="h2"
                sx={{
                  mt: 2,
                  fontWeight: 800,
                  fontSize: { xs: '2.4rem', md: '3.4rem' },
                  lineHeight: 1.1,
                }}
              >
                8004 Smart Agents
              </Typography>
              <Typography variant="h6" sx={{ mt: 2, color: 'text.secondary', maxWidth: 860, mx: 'auto' }}>
                Ship an on-chain agent identity with a smart-account owner, a unique ENS name, and trust-graph-native
                feedback + validations.
              </Typography>

              <Box
                component="pre"
                sx={{
                  display: 'inline-block',
                  mt: 3,
                  mb: 1,
                  px: 2,
                  py: 1,
                  borderRadius: 2,
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  color: palette.textPrimary,
                  fontFamily: 'monospace',
                  fontSize: { xs: '0.9em', md: '0.95em' },
                  lineHeight: 1.45,
                  whiteSpace: 'pre',
                  userSelect: 'all',
                }}
              >
                npx @agentic-trust/create-8004-agent
              </Box>
              <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 860, mx: 'auto' }}>
                Creates a local A2A agent with <strong>/.well-known/agent.json</strong> and an <strong>/a2a</strong>{' '}
                endpoint ready to issue <strong>feedbackAuth</strong> and respond to validations.
              </Typography>

              <Grid container spacing={2.5} sx={{ mt: { xs: 4, md: 5 } }}>
                {[
                  {
                    title: 'Smart-account owner',
                    body:
                      'Owned by a smart account with EIP-1271 signature validation and DID support (did:ethr).',
                    icon: <ShieldOutlined fontSize="large" color="primary" />,
                  },
                  {
                    title: 'Unique ENS name',
                    body:
                      'A human-readable, resolvable name like <name>.8004-agent.eth for discovery and routing.',
                    icon: <Verified fontSize="large" color="primary" />,
                  },
                  {
                    title: 'Trust Graph ready',
                    body:
                      'Feedback + validations attach to your agent and propagate through ERC-8004 identity, validation, and reputation registries.',
                    icon: <AutoGraph fontSize="large" color="primary" />,
                  },
                ].map((card) => (
                  <Grid item xs={12} md={4} key={card.title}>
                    <Card
                      variant="outlined"
                      sx={{
                        height: '100%',
                        borderRadius: 3,
                        borderColor: palette.border,
                        backgroundColor: 'background.paper',
                      }}
                    >
                      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {card.icon}
                          <Typography variant="h6" fontWeight={800}>
                            {card.title}
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          {card.body}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                justifyContent="center"
                sx={{ mt: 4 }}
              >
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<ExploreIcon />}
                  onClick={onNavigateAgents}
                >
                  {primaryCta}
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  endIcon={<ArrowOutward />}
                  href="/agent-registration"
                >
                  Register an Agent (2 min)
                </Button>
                <Button
                  variant="text"
                  size="large"
                  endIcon={<ArrowOutward />}
                  href={articleUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Read the Article
                </Button>
              </Stack>
            </Box>

            {/* How it works */}
            <Card
              variant="outlined"
              sx={{
                borderRadius: 4,
                borderColor: palette.border,
                backgroundColor: 'background.paper',
              }}
            >
              <CardContent>
                <Typography variant="h4" fontWeight={800} gutterBottom>
                  How an 8004 Smart Agent works
                </Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  A simple loop: publish identity → serve A2A → collect validations + feedback → show up in the Trust
                  Graph.
                </Typography>
                <List>
                  {[
                    'Your agent publishes /.well-known/agent.json and exposes an A2A endpoint.',
                    'Validators issue on-chain validations (and can be organized into pools).',
                    'Reviewers request feedbackAuth from the agent, then submit feedback on-chain.',
                    'Everything becomes queryable and visualizable as an ERC-8004 Trust Graph.',
                  ].map((item) => (
                    <ListItem key={item} disableGutters>
                      <ListItemIcon>
                        <Verified color="primary" />
                      </ListItemIcon>
                      <ListItemText primary={item} />
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>

            {/* Getting started */}
            <Card
              variant="outlined"
              sx={{
                borderRadius: 4,
                borderColor: palette.border,
                backgroundColor: 'background.paper',
              }}
            >
              <CardContent>
                <Typography variant="h4" fontWeight={800} gutterBottom textAlign="center">
                  Get started in minutes
                </Typography>
                <Typography
                  variant="body1"
                  color="text.secondary"
                  textAlign="center"
                  sx={{ mb: 4 }}
                >
                  Two paths: build a local agent with the CLI, or register directly in the UI.
                </Typography>
                <List>
                  {[
                    'Run the CLI to scaffold an A2A agent (includes feedbackAuth + validation wiring).',
                    'Start your dev server (your agent.json + A2A endpoint come online).',
                    'Register the agent to the ERC-8004 Identity Registry (MetaMask smart account).',
                    'Share your ENS name / endpoint so validators and reviewers can find you.',
                    'Collect validations + feedback; watch the Trust Graph and reputation score update.',
                  ].map((item, idx) => (
                    <ListItem key={item} disableGutters>
                      <ListItemIcon>
                        <Chip label={idx + 1} color="primary" size="small" />
                      </ListItemIcon>
                      <ListItemText primary={item} />
                    </ListItem>
                  ))}
                </List>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  textAlign="center"
                  sx={{ mt: 2, fontStyle: 'italic' }}
                >
                  Tip: if your agent can’t issue feedbackAuth yet, it probably needs a SessionPackage configured.
                </Typography>
                <Stack direction="row" justifyContent="center" sx={{ mt: 3 }}>
                  <Button variant="contained" size="large" onClick={onNavigateAgents}>
                    Explore Agents
                  </Button>
                </Stack>
              </CardContent>
            </Card>

            {/* Trust graph + validator pools */}
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Card
                  variant="outlined"
                  sx={{
                    height: '100%',
                    borderRadius: 4,
                    borderColor: palette.border,
                    backgroundColor: 'background.paper',
                  }}
                >
                  <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AutoGraph color="primary" />
                      <Typography variant="h5" fontWeight={700}>
                        Live Trust Graph Viewer
                      </Typography>
                    </Box>
                    <Typography variant="body1" color="text.secondary">
                      Real-time graph of agents, validation relationships, reviewer credentials, and
                      reputation score propagation. Filter by vertical, zoom into clusters, click a
                      node for on-chain proofs.
                    </Typography>
                    <Button variant="contained" onClick={onNavigateAgents} startIcon={<ExploreIcon />}>
                      Open the Trust Graph
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card
                  variant="outlined"
                  sx={{
                    height: '100%',
                    borderRadius: 4,
                    borderColor: palette.border,
                    backgroundColor: 'background.paper',
                  }}
                >
                  <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Group color="primary" />
                      <Typography variant="h5" fontWeight={700}>
                        Gamified Vertical Validator Pools
                      </Typography>
                    </Box>
                    <Typography variant="body1" color="text.secondary">
                      DeFi risk, healthcare compliance, legal research, supply-chain, security, and
                      more. Stake → validate → earn reputation and rewards → climb leaderboards.
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {[
                        'DeFi Risk',
                        'Healthcare',
                        'Legal Research',
                        'Supply Chain',
                        'Security',
                        'Research',
                      ].map((pool) => (
                        <Chip key={pool} label={pool} variant="outlined" />
                      ))}
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <Button variant="outlined" href="/pools">
                        Browse Pools
                      </Button>
                      <Button variant="contained" href="/validator">
                        Become a Validator
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {/* Community */}
            <Card
              variant="outlined"
              sx={{
                borderRadius: 4,
                borderColor: palette.border,
                backgroundColor: 'background.paper',
              }}
            >
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={700} gutterBottom>
                  Built in Public — Join the Community
                </Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  The first useful layer on top of ERC-8004 while the registries are still young.
                  Come build the trust layer with us.
                </Typography>
                <Stack direction="row" spacing={4} justifyContent="center" sx={{ mt: 3 }}>
                  <MuiLink href="https://x.com/8004agent" target="_blank" color="inherit">
                    <Twitter fontSize="large" />
                  </MuiLink>
                  
                  <MuiLink href="https://github.com/Agentic-Trust-Layer/agentic-trust" target="_blank" color="inherit">
                    <GitHub fontSize="large" />
                  </MuiLink>
                  {onOpenAdminTools && (
                    <MuiLink onClick={onOpenAdminTools} sx={{ cursor: 'pointer' }} color="inherit">
                      <ShieldOutlined fontSize="large" />
                    </MuiLink>
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
                  agentictrust.io — December 2025 · First-mover coordination layer for ERC-8004 trust
                  graphs.
                </Typography>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </Box>
      <Divider />
    </Box>
  );
}