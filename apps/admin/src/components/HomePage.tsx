'use client';

import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Grid,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import {
  ShieldOutlined,
  Twitter,
  Explore as ExploreIcon,
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
            <div>{error}</div>
            {error.includes('No Ethereum wallet found') && (
              <div style={{ marginTop: '0.5rem' }}>
                <a
                  href="https://metamask.io/download/"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: palette.textPrimary, textDecoration: 'underline', fontWeight: 700 }}
                >
                  Install MetaMask
                </a>
              </div>
            )}
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

export function HomePage({
  onNavigateAgents,
  onOpenAdminTools,
  isConnected,
}: HomePageProps) {
  const primaryCta = 'Open Agent Explorer';

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
                Smart Agents · ERC-4337 Smart Accounts · ENS · Trust Graphs
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
                Smart Agents for on-chain trust
              </Typography>
              <Typography variant="h6" sx={{ mt: 2, color: 'text.secondary', maxWidth: 860, mx: 'auto' }}>
                Deploy a Smart Agent with an ERC-4337 Smart Account, publish an ENS identity for discovery, and participate
                in trust graphs built from on-chain feedback and validations.
              </Typography>

              <Grid container spacing={2.5} sx={{ mt: { xs: 4, md: 5 } }}>
                {[
                  {
                    title: 'ERC-4337 Smart Account',
                    body:
                      'A programmable account for your agent. It enables modern signing, sponsorship, and secure automation patterns.',
                    icon: <ShieldOutlined fontSize="large" color="primary" />,
                  },
                  {
                    title: 'ENS for discovery',
                    body:
                      'A human-readable identity used for discovery and routing in clients and the Knowledge Base.',
                    icon: <ExploreIcon fontSize="large" color="primary" />,
                  },
                  {
                    title: 'Identity Registry + Trust Graph',
                    body:
                      'ERC-8004 anchors on-chain trust signals (validations + feedback) that roll up into reputation and graph views.',
                    icon: <ShieldOutlined fontSize="large" color="primary" />,
                  },
                  {
                    title: 'Agentic Trust Ontology',
                    body:
                      'An Agent Knowledge Base and Context Graph that connect identities, endpoints, and trust signals into a queryable model.',
                    icon: <ShieldOutlined fontSize="large" color="primary" />,
                  },
                ].map((card) => (
                  <Grid item xs={12} md={6} key={card.title}>
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
                <Button variant="outlined" size="large" href="/agents">
                  Browse agents
                </Button>
              </Stack>
              <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                Direct link: <MuiLink href="/agents">agentictrust.io/agents</MuiLink>
              </Typography>
            </Box>

            {/* System model */}
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
                  Identity, discovery, and trust
                </Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  Smart Agents are discovered through ENS and evaluated through trust signals that land on-chain.
                </Typography>
                <Grid container spacing={2.5} sx={{ mt: 1 }}>
                  <Grid item xs={12} md={4}>
                    <Card variant="outlined" sx={{ borderRadius: 3, borderColor: palette.border, height: '100%' }}>
                      <CardContent>
                        <Typography variant="h6" fontWeight={900} gutterBottom>
                          ENS identity (discovery)
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          ENS provides a stable, human-readable name that points to your agent’s service metadata and helps
                          clients find the right endpoint.
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Card variant="outlined" sx={{ borderRadius: 3, borderColor: palette.border, height: '100%' }}>
                      <CardContent>
                        <Typography variant="h6" fontWeight={900} gutterBottom>
                          ERC-8004 Identity Registry (trust)
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          ERC-8004 is the on-chain anchor for trust signals like validations and feedback, which drive trust
                          graphs and reputation computation.
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Card variant="outlined" sx={{ borderRadius: 3, borderColor: palette.border, height: '100%' }}>
                      <CardContent>
                        <Typography variant="h6" fontWeight={900} gutterBottom>
                          Knowledge Base + Context Graph
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          The Agentic Trust ontology maps identities, endpoints, and trust signals into a queryable graph
                          used by discovery and analytics.
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* Explore */}
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
                  Explore Smart Agents
                </Typography>
                <Typography
                  variant="body1"
                  color="text.secondary"
                  textAlign="center"
                  sx={{ mb: 4 }}
                >
                  Browse agents, open profiles, and inspect identities (ENS + registries) and trust signals.
                </Typography>
                <Stack direction="row" justifyContent="center" sx={{ mt: 3 }}>
                  <Button variant="contained" size="large" onClick={onNavigateAgents}>
                    {primaryCta}
                  </Button>
                </Stack>
              </CardContent>
            </Card>

            {/* Build locally (CLI) */}
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
                  Build a local A2A agent
                </Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  Scaffold a local agent that serves A2A and is ready to issue feedbackAuth and respond to validations.
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    display: 'inline-block',
                    mt: 1,
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
                <Typography variant="body2" color="text.secondary">
                  Creates a local A2A agent with <strong>/.well-known/agent.json</strong> and an <strong>/a2a</strong> endpoint.
                </Typography>
              </CardContent>
            </Card>

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
                  Come build the Smart Agent trust layer with us.
                </Typography>
                <Stack direction="row" spacing={4} justifyContent="center" sx={{ mt: 3 }}>
                  <MuiLink href="https://x.com/8004agent" target="_blank" color="inherit">
                    <Twitter fontSize="large" />
                  </MuiLink>
                  {onOpenAdminTools && (
                    <MuiLink onClick={onOpenAdminTools} sx={{ cursor: 'pointer' }} color="inherit">
                      <ShieldOutlined fontSize="large" />
                    </MuiLink>
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
                  agentictrust.io — Smart Agents + trust graphs.
                </Typography>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}