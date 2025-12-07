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
                Agentic Trust Community
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
                Explore Trust Graphs for ERC-8004 Agents
              </Typography>
              <Typography
                variant="h6"
                sx={{ mt: 2, color: 'text.secondary', maxWidth: 840, mx: 'auto' }}
              >
                Visualize · Build · Validate · Discover. A community-first front door to the
                ERC-8004 identity, validation, and reputation registries — built for devs who want
                signal, not hype.
              </Typography>
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

            {/* Why now cards */}
            <Grid container spacing={3}>
              {[
                {
                  title: 'Trust Graphs are live',
                  body:
                    'Validator ↔ Agent ↔ Reviewer relationships are on-chain today via the ERC-8004 Validation Registry.',
                  icon: <AutoGraph fontSize="large" color="primary" />,
                },
                {
                  title: 'First-mover window',
                  body:
                    'Registries are young (<2k agents). Building now sets the canonical UX and data moat for the next wave.',
                  icon: <Timeline fontSize="large" color="primary" />,
                },
                {
                  title: 'Delegation + VCs',
                  body:
                    'Relational verifiable credentials with MetaMask smart accounts enable real enterprise handshakes.',
                  icon: <ShieldOutlined fontSize="large" color="primary" />,
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
                    <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {card.icon}
                        <Typography variant="h6" fontWeight={700}>
                          {card.title}
                        </Typography>
                      </Box>
                      <Typography variant="body1" color="text.secondary">
                        {card.body}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            {/* Mental model */}
            <Card
              variant="outlined"
              sx={{
                borderRadius: 4,
                borderColor: palette.border,
                backgroundColor: 'background.paper',
              }}
            >
              <CardContent>
                <Typography variant="h4" fontWeight={700} gutterBottom>
                  The Mental Model Everyone Just Adopted
                </Typography>
                <Typography variant="body1" color="text.secondary" gutterBottom>
                  Trust Graphs are now the default way to read ERC-8004 reputation:
                </Typography>
                <List>
                  {[
                    'Validators (stake-secured, TEE, zkML, re-execution) ↔ Agents ↔ Reviewers with relational VCs.',
                    'All data lives on Mainnet + major L2s via the Identity, Validation, and Reputation registries.',
                    'No silos or “vibes” — only composable, economic, on-chain trust.',
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

            {/* No-code steps */}
            <Card
              variant="outlined"
              sx={{
                borderRadius: 4,
                borderColor: palette.border,
                backgroundColor: 'background.paper',
              }}
            >
              <CardContent>
                <Typography variant="h4" fontWeight={700} gutterBottom textAlign="center">
                  Start Exploring — No Code Required
                </Typography>
                <Typography
                  variant="body1"
                  color="text.secondary"
                  textAlign="center"
                  sx={{ mb: 4 }}
                >
                  Compress idea → validation from 60 days to 60 minutes.
                </Typography>
                <List>
                  {[
                    'Name your agent and give it a one-line mission.',
                    'Pick an icon and short brand description (agents have branding).',
                    'Publish to the ERC-8004 Identity Registry via MetaMask smart accounts.',
                    'Run your first gamified validation mission (DeFi, research, legal, healthcare verticals).',
                    'Watch your node appear in the live Trust Graph as validators stake on you.',
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
                  Most agent concepts die before real validation. Here the loop is 60 minutes, not 60
                  days.
                </Typography>
                <Stack direction="row" justifyContent="center" sx={{ mt: 3 }}>
                  <Button variant="contained" size="large" onClick={onNavigateAgents}>
                    Start Your Agent Journey
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