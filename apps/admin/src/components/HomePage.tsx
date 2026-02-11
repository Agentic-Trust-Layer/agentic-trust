'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import {
  AccountTreeOutlined,
  ArrowDownwardRounded,
  ArrowForwardRounded,
  BoltOutlined,
  Explore as ExploreIcon,
  ShieldOutlined,
  Twitter,
  VerifiedOutlined,
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
          Agent Explorer
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
};

export function HomePage({
  onNavigateAgents,
  onOpenAdminTools,
}: HomePageProps) {
  const primaryHeroCta = 'Explore Live Agents →';
  const secondaryHeroCta = 'See how the stack works ↓';
  const explorerCta = 'Agent Explorer →';

  const stackRef = useRef<HTMLDivElement | null>(null);
  const scrollToStack = useCallback(() => {
    stackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const loopLabels = ['Agent', 'Execution', 'Identity', 'Context', 'Trust', 'Discovery', 'Agent'] as const;

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
                Smart Agents · ERC-4337 · ENS · ERC-8004 · Knowledge Base
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
                Smart Agents need more than execution.
              </Typography>
              <Typography
                variant="h4"
                sx={{ mt: 1.5, fontWeight: 800, fontSize: { xs: '1.55rem', md: '2.1rem' }, lineHeight: 1.15 }}
              >
                They need identity, trust, and context.
              </Typography>

              <Typography variant="h6" sx={{ mt: 2.5, color: 'text.secondary', maxWidth: 980, mx: 'auto' }}>
                AgenticTrust is the coordination layer that lets autonomous agents execute actions, prove identity,
                establish trust, and build shared context — all verifiable, composable, and discoverable.
              </Typography>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                justifyContent="center"
                sx={{ mt: 4 }}
              >
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<ExploreIcon />}
                  onClick={onNavigateAgents}
                  sx={{
                    fontSize: '1.1rem',
                    fontWeight: 900,
                    py: 2,
                    px: 4,
                    borderRadius: 3,
                    textTransform: 'none',
                    boxShadow: '0 8px 24px rgba(15,23,42,0.15)',
                  }}
                >
                  {primaryHeroCta}
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  onClick={scrollToStack}
                  sx={{
                    fontSize: '1.02rem',
                    fontWeight: 800,
                    py: 2,
                    px: 3.5,
                    borderRadius: 3,
                    textTransform: 'none',
                    borderColor: palette.borderStrong,
                  }}
                >
                  {secondaryHeroCta}
                </Button>
              </Stack>

              <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary' }}>
                <MuiLink href="/agents" sx={{ fontWeight: 700 }}>
                  agentictrust.io/agents
                </MuiLink>
              </Typography>

              {/* Loop diagram */}
              <Box
                sx={{
                  mt: 4,
                  mx: 'auto',
                  maxWidth: 1040,
                  px: { xs: 1, md: 2 },
                  py: 2,
                  borderRadius: 3,
                  border: `1px solid ${palette.border}`,
                  backgroundColor: 'background.paper',
                  '@keyframes arrowFlow': {
                    '0%': { opacity: 0.35, transform: 'translateX(0px)' },
                    '50%': { opacity: 0.85, transform: 'translateX(4px)' },
                    '100%': { opacity: 0.35, transform: 'translateX(0px)' },
                  },
                  '@media (prefers-reduced-motion: reduce)': {
                    '& .HomeLoop_arrow': { animation: 'none !important' },
                  },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  flexWrap="wrap"
                  alignItems="center"
                  justifyContent="center"
                >
                  {loopLabels.map((label, idx) => (
                    <Box key={`${label}::${idx}`} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        sx={{
                          px: 1.25,
                          py: 0.6,
                          borderRadius: 999,
                          border: `1px solid ${palette.borderStrong}`,
                          backgroundColor: palette.surfaceMuted,
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 900, letterSpacing: '0.04em' }}>
                          {label}
                        </Typography>
                      </Box>
                      {idx < loopLabels.length - 1 && (
                        <ArrowForwardRounded
                          className="HomeLoop_arrow"
                          sx={{
                            color: palette.textMuted,
                            animation: 'arrowFlow 2.6s ease-in-out infinite',
                          }}
                        />
                      )}
                    </Box>
                  ))}
                </Stack>
              </Box>
            </Box>

            {/* Stack */}
            <Box ref={stackRef} id="stack">
              <Card
                variant="outlined"
                sx={{
                  borderRadius: 4,
                  borderColor: palette.border,
                  backgroundColor: 'background.paper',
                }}
              >
                <CardContent>
                  <Typography variant="h4" fontWeight={900} gutterBottom>
                    One agent system. Three interlocking layers.
                  </Typography>
                  <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 980 }}>
                    ERC-4337 is the execution backbone. ENS + ERC-8004 provide identity, discovery, and trust. A Knowledge
                    Base grounded in the Agentic Trust Ontology turns events and metadata into a queryable context graph and
                    memory layer.
                  </Typography>

                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={2}
                    alignItems="stretch"
                    sx={{ mt: 3 }}
                  >
                    <Card variant="outlined" sx={{ flex: 1, borderRadius: 3, borderColor: palette.border }}>
                      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <BoltOutlined color="primary" />
                          <Typography variant="h6" fontWeight={900}>
                            Execution layer
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          Smart agents execute actions via ERC-4337 smart accounts: programmable permissions, delegation, and
                          accountable execution.
                        </Typography>
                        <Box component="ul" sx={{ pl: 2.5, my: 0, color: 'text.secondary' }}>
                          <li>
                            <Typography variant="body2" color="text.secondary">
                              Delegated authority and bounded sessions
                            </Typography>
                          </li>
                          <li>
                            <Typography variant="body2" color="text.secondary">
                              Deterministic, on-chain accountable execution
                            </Typography>
                          </li>
                        </Box>
                      </CardContent>
                    </Card>

                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        px: 1,
                      }}
                    >
                      <ArrowForwardRounded sx={{ display: { xs: 'none', md: 'block' }, color: palette.textMuted }} />
                      <ArrowDownwardRounded sx={{ display: { xs: 'block', md: 'none' }, color: palette.textMuted }} />
                    </Box>

                    <Card variant="outlined" sx={{ flex: 1, borderRadius: 3, borderColor: palette.border }}>
                      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <VerifiedOutlined color="primary" />
                          <Typography variant="h6" fontWeight={900}>
                            Identity, discovery & trust
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          ENS makes agents discoverable. ERC-8004 anchors identity and trust signals (validations + feedback)
                          into graphable reputation.
                        </Typography>
                        <Box component="ul" sx={{ pl: 2.5, my: 0, color: 'text.secondary' }}>
                          <li>
                            <Typography variant="body2" color="text.secondary">
                              Discoverable identities (ENS + UAIDs)
                            </Typography>
                          </li>
                          <li>
                            <Typography variant="body2" color="text.secondary">
                              Verifiable trust signals on-chain (ERC-8004)
                            </Typography>
                          </li>
                        </Box>
                      </CardContent>
                    </Card>

                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        px: 1,
                      }}
                    >
                      <ArrowForwardRounded sx={{ display: { xs: 'none', md: 'block' }, color: palette.textMuted }} />
                      <ArrowDownwardRounded sx={{ display: { xs: 'block', md: 'none' }, color: palette.textMuted }} />
                    </Box>

                    <Card variant="outlined" sx={{ flex: 1, borderRadius: 3, borderColor: palette.border }}>
                      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <AccountTreeOutlined color="primary" />
                          <Typography variant="h6" fontWeight={900}>
                            Context graph & memory
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          A Knowledge Base grounded in the Agentic Trust Ontology connects identities, services, and trust
                          signals into a context graph you can query, audit, and build on.
                        </Typography>
                        <Box component="ul" sx={{ pl: 2.5, my: 0, color: 'text.secondary' }}>
                          <li>
                            <Typography variant="body2" color="text.secondary">
                              Ontology-driven context graph and inference
                            </Typography>
                          </li>
                          <li>
                            <Typography variant="body2" color="text.secondary">
                              Verifiable memory trails and analytics
                            </Typography>
                          </li>
                        </Box>
                      </CardContent>
                    </Card>
                  </Stack>

                  <Typography
                    variant="body1"
                    sx={{ mt: 3, fontStyle: 'italic', color: 'text.secondary', maxWidth: 980 }}
                  >
                    Execution without identity is dangerous. Identity without context is meaningless. Context without execution
                    is inert.
                  </Typography>
                </CardContent>
              </Card>
            </Box>

            {/* Why this matters */}
            <Card
              variant="outlined"
              sx={{
                borderRadius: 4,
                borderColor: palette.border,
                backgroundColor: 'background.paper',
              }}
            >
              <CardContent>
                <Typography variant="h4" fontWeight={900} gutterBottom>
                  Why AgenticTrust exists
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 980 }}>
                  Autonomous agents need bounded authority, verifiable identity, and shared semantics — otherwise you get
                  opaque bots, unsafe delegation, and unverifiable “memory”.
                </Typography>
                <Box component="ul" sx={{ mt: 2, mb: 0, pl: 3 }}>
                  <li>
                    <Typography variant="body1">Bounded authority for autonomous execution</Typography>
                  </li>
                  <li>
                    <Typography variant="body1">Trust can’t be inferred from wallets alone</Typography>
                  </li>
                  <li>
                    <Typography variant="body1">Discovery needs shared semantics (not ad-hoc APIs)</Typography>
                  </li>
                  <li>
                    <Typography variant="body1">Memory must be verifiable and queryable</Typography>
                  </li>
                  <li>
                    <Typography variant="body1">Agents must interoperate across orgs and chains</Typography>
                  </li>
                </Box>
              </CardContent>
            </Card>

            {/* Explorer */}
            <Card
              variant="outlined"
              sx={{
                borderRadius: 4,
                borderColor: palette.border,
                backgroundColor: 'background.paper',
              }}
            >
              <CardContent>
                <Typography variant="h4" fontWeight={900} gutterBottom>
                  See the trust graph in action
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 980 }}>
                  Agent Explorer lets you inspect real agents, identities, service endpoints, and trust signals — live and
                  verifiable.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 3 }}>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<ExploreIcon />}
                    onClick={onNavigateAgents}
                    sx={{
                      fontSize: '1.05rem',
                      fontWeight: 900,
                      py: 1.75,
                      px: 3.5,
                      borderRadius: 3,
                      textTransform: 'none',
                    }}
                  >
                    {explorerCta}
                  </Button>
                  <Typography variant="body2" color="text.secondary" sx={{ alignSelf: { sm: 'center' } }}>
                    No wallet required. Read-only by design.
                  </Typography>
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