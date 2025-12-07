'use client';

import { Box, Button, Card, CardContent, Container, Grid, Stack, Typography, Chip } from '@mui/material';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import Groups2OutlinedIcon from '@mui/icons-material/Groups2Outlined';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { grayscalePalette as palette } from '@/styles/palette';

const poolDetails = [
  {
    title: 'DeFi Risk',
    tags: ['Re-execution', 'Price feeds', 'MEV risk'],
    summary: 'Validate DeFi agent executions, price sanity, and liquidation logic.',
  },
  {
    title: 'Healthcare Compliance',
    tags: ['HIPAA', 'GDPR', 'Audit trail'],
    summary: 'Policy checks for PHI handling, auditability, and compliant responses.',
  },
  {
    title: 'Legal Research',
    tags: ['Citations', 'Hallucination checks', 'Precedent'],
    summary: 'Validate legal research agents for citation accuracy and precedent coverage.',
  },
  {
    title: 'Supply-Chain',
    tags: ['Chain-of-custody', 'SLA tracking', 'SKU validation'],
    summary: 'Verify provenance, SLA adherence, and SKU checks for logistics agents.',
  },
  {
    title: 'Security',
    tags: ['Exploit repro', 'Patch verify', 'Safety nets'],
    summary: 'Re-execute exploits, validate patches, and enforce AI safety guardrails.',
  },
  {
    title: 'Research',
    tags: ['Data quality', 'Attribution', 'Bias checks'],
    summary: 'Evaluate research agents for source attribution, freshness, and bias controls.',
  },
];

export default function PoolsPage() {
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
              Agentic Trust · Validator Pools
            </Typography>
            <Typography
              variant="h3"
              sx={{ mt: 1, fontWeight: 800, lineHeight: 1.1, color: 'text.primary', fontSize: { xs: '2rem', md: '2.4rem' } }}
            >
              Browse Vertical Validator Pools
            </Typography>
            <Typography variant="h6" sx={{ mt: 1.5, color: 'text.secondary', maxWidth: 900 }}>
              Stake-secured validation with on-chain proofs, reputation, and slashing. Pick a vertical, join the pool, and start
              earning trust and rewards.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ mt: 3 }}>
              <Button variant="contained" startIcon={<AutoGraphIcon />} size="large" href="/agents">
                View Live Trust Graph
              </Button>
              <Button
                variant="outlined"
                startIcon={<ShieldOutlinedIcon />}
                size="large"
                href="https://github.com/Agentic-Trust-Layer/agentic-trust"
                target="_blank"
                rel="noreferrer"
              >
                Talk to the Team
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Grid container spacing={2}>
          {poolDetails.map((pool) => (
            <Grid item xs={12} md={6} key={pool.title}>
              <Card variant="outlined" sx={{ borderRadius: 3, borderColor: palette.border, backgroundColor: 'background.paper' }}>
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <ShieldOutlinedIcon color="primary" />
                    <Typography variant="h6" fontWeight={700}>
                      {pool.title}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
                    {pool.tags.map((tag) => (
                      <Chip key={tag} label={tag} size="small" />
                    ))}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {pool.summary}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                    <Button variant="contained" size="small" startIcon={<AutoGraphIcon />} href="/validator">
                      Become a Validator
                    </Button>
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<Groups2OutlinedIcon />}
                      href="https://github.com/Agentic-Trust-Layer/agentic-trust"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Collaborate
                    </Button>
                  </Stack>
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
                  Pool Mechanics
                </Typography>
              </Stack>
              <Typography variant="body1" color="text.secondary">
                • Stake to join a pool; higher stake and reputation increase routing priority.<br />
                • Receive validation requests matched by vertical and validator reputation.<br />
                • Submit responses on-chain; scores propagate into the Trust Graph and pool leaderboards.<br />
                • Slashing and dispute resolution keep signals honest; badges highlight top performers.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

