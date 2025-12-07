'use client';

import { Box, Button, Card, CardContent, Container, Grid, Stack, Typography } from '@mui/material';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import VerifiedIcon from '@mui/icons-material/Verified';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { grayscalePalette as palette } from '@/styles/palette';

const validatorPools = [
  { title: 'DeFi Risk Validators', detail: 'Re-execution, price-feed sanity, MEV risk checks.' },
  { title: 'Healthcare Compliance', detail: 'HIPAA / GDPR guardrails, PHI handling, audit trails.' },
  { title: 'Legal Research', detail: 'Citation validation, precedent retrieval, hallucination audits.' },
  { title: 'Supply-Chain', detail: 'Chain-of-custody proofs, SKU validation, SLA tracking.' },
  { title: 'Security', detail: 'Exploit reproduction, patch verification, AI agent safety nets.' },
];

export default function BecomeValidatorPage() {
  const { isConnected, privateKeyMode, loading, walletAddress, openLoginModal, handleDisconnect } = useAuth();

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
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 }, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Card
          variant="outlined"
          sx={{
            borderRadius: 4,
            borderColor: palette.border,
            backgroundColor: palette.surface,
            boxShadow: '0 12px 28px rgba(15,23,42,0.12)',
          }}
        >
          <CardContent>
            <Typography variant="overline" sx={{ letterSpacing: '0.2em', color: 'text.secondary', fontWeight: 700 }}>
              Agentic Trust · Validators
            </Typography>
            <Typography
              variant="h3"
              sx={{ mt: 1, fontWeight: 800, lineHeight: 1.1, color: 'text.primary', fontSize: { xs: '2rem', md: '2.6rem' } }}
            >
              Become a Validator in the Agent Trust Graph
            </Typography>
            <Typography variant="h6" sx={{ mt: 1.5, color: 'text.secondary', maxWidth: 900 }}>
              Stake-secured validation for ERC-8004 agents. Earn reputation, climb leaderboards, and anchor the Trust Graph with
              verifiable proofs.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ mt: 3 }}>
              <Button variant="contained" startIcon={<ShieldOutlinedIcon />} size="large" href="/agents">
                View Live Trust Graph
              </Button>
              <Button variant="outlined" startIcon={<AutoGraphIcon />} size="large" href="/pools">
                Browse Validator Pools
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Grid container spacing={2}>
          {validatorPools.map((pool) => (
            <Grid item xs={12} md={6} key={pool.title}>
              <Card variant="outlined" sx={{ borderRadius: 3, borderColor: palette.border, backgroundColor: 'background.paper' }}>
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <ShieldOutlinedIcon color="primary" />
                    <Typography variant="h6" fontWeight={700}>
                      {pool.title}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {pool.detail}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Card
          variant="outlined"
          sx={{
            borderRadius: 3,
            borderColor: palette.border,
            backgroundColor: palette.surfaceMuted,
          }}
        >
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center">
                <EmojiEventsOutlinedIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>
                  How it Works
                </Typography>
              </Stack>
              <Typography variant="body1" color="text.secondary">
                • Stake or register as a validator in a vertical pool.<br />
                • Receive validation requests from agents and run your checks (TEE, zkML, re-execution, policy checks).<br />
                • Submit responses on-chain; earn reputation and rewards; slashing for bad responses keeps the signal honest.<br />
                • Leaderboards and badges highlight top validators in each vertical.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card
          variant="outlined"
          sx={{
            borderRadius: 3,
            borderColor: palette.border,
            backgroundColor: 'background.paper',
          }}
        >
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center">
                <VerifiedIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>
                  Ready to onboard?
                </Typography>
              </Stack>
              <Typography variant="body1" color="text.secondary">
                Start with a live pool or propose a new vertical. We’ll help set up delegation flows, validation criteria, and reward
                schedules tailored to your niche.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button variant="contained" startIcon={<AutoGraphIcon />} href="/pools">
                  Join a Pool
                </Button>
                <Button variant="outlined" href="https://github.com/Agentic-Trust-Layer/agentic-trust" target="_blank" rel="noreferrer">
                  Talk to the Team
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

