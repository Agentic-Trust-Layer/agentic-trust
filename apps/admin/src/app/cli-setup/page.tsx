'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';

import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import {
  createAgentWithWallet,
  getCounterfactualSmartAccountAddressByAgentName,
  generateSessionPackage,
  getEnsOrgName,
} from '@agentic-trust/core';

type Draft = {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  chainId: number;
  agentName: string;
  description: string;
  agentUrl?: string;
  agentCategory?: string;
  imageUrl?: string;
  supportedTrust?: string[];
  enableMcp?: boolean;
  enableX402?: boolean;
};

export default function CliSetupPage() {
  const sp = useSearchParams();
  const { isConnected, loading, walletAddress, openLoginModal, handleDisconnect, privateKeyMode } = useAuth();
  const { eip1193Provider } = useWallet();

  const normalizeDnsLabel = (raw: string): string => {
    const trimmed = (raw || '').trim().toLowerCase();
    const withoutEth = trimmed.endsWith('.eth') ? trimmed.slice(0, -'.eth'.length) : trimmed;
    const parts = withoutEth.split('.').filter(Boolean);
    const label = (parts.length > 0 ? parts[0] : trimmed) || '';
    return label
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);
  };

  const draft = useMemo<Draft | null>(() => {
    if (!sp) {
      return null;
    }
    const state = sp.get('state') ?? '';
    const codeChallenge = sp.get('code_challenge') ?? '';
    const redirectUri = sp.get('redirect_uri') ?? '';
    const chainIdRaw = sp.get('chainId') ?? '';
    const agentName = sp.get('agentName') ?? '';
    const description = sp.get('description') ?? '';
    const chainId = Number(chainIdRaw);

    if (!state || !codeChallenge || !redirectUri || !agentName || !Number.isFinite(chainId)) {
      return null;
    }

    const supportedTrustRaw = (sp.get('supportedTrust') ?? '').trim();
    const supportedTrust = supportedTrustRaw
      ? supportedTrustRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    return {
      state,
      codeChallenge,
      redirectUri,
      chainId,
      agentName,
      description,
      agentUrl: sp.get('agentUrl') ?? undefined,
      agentCategory: sp.get('agentCategory') ?? undefined,
      imageUrl: sp.get('imageUrl') ?? undefined,
      supportedTrust,
      enableMcp: sp.get('enableMcp') === 'true',
      enableX402: sp.get('enableX402') === 'true',
    };
  }, [sp]);

  const agentLabel = useMemo(() => normalizeDnsLabel(draft?.agentName ?? ''), [draft?.agentName]);
  const fullEnsName = useMemo(() => (agentLabel ? `${agentLabel}.8004-agent.eth` : ''), [agentLabel]);

  const [description, setDescription] = useState(draft?.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<Array<{ ts: number; msg: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<{
    chainId: number;
    ensName: string;
    agentAccount: string;
    agentUrl?: string;
    a2aEndpoint?: string;
    mcpEndpoint?: string;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<void>)>(null);
  const [flowState, setFlowState] = useState<'idle' | 'confirm' | 'running'>('idle');
  const [activeStep, setActiveStep] = useState(0);

  const pushStatus = (msg: string) => {
    setStatus(msg);
    setStatusLog((prev) => {
      const next = [...prev, { ts: Date.now(), msg }];
      return next.slice(-40);
    });
  };

  const steps = useMemo(
    () => [
      'Establish Agent Smart Account address',
      'Register agent (ENS and 8004 Identity)',
      'Create SessionPackage (delegation for feedback + validation)',
      'Return to CLI',
    ],
    [],
  );

  // Auto-open connect flow when arriving from CLI.
  useEffect(() => {
    if (privateKeyMode) return;
    if (loading) return;
    if (isConnected) return;
    // Best-effort: open the connect/login modal automatically.
    openLoginModal();
  }, [privateKeyMode, loading, isConnected, openLoginModal]);

  if (!draft) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="error">Missing required CLI setup parameters.</Alert>
      </Container>
    );
  }

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
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
          CLI setup: connect + register
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Finish Smart Agent registration of Smart Agent Account (ERC-4337), Smart Agent Name (name.8004-agent.eth), and
          Smart Agent Identity (ERC-8004), then you&apos;ll be redirected back to the CLI.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {status && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {status}
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Progress
          </Typography>
          <Stepper activeStep={activeStep} alternativeLabel>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
          {flowState !== 'idle' && <LinearProgress sx={{ mt: 2 }} />}
          {statusLog.length > 0 && (
            <Box sx={{ mt: 2, maxHeight: 180, overflow: 'auto' }}>
              {statusLog
                .slice()
                .reverse()
                .map((entry) => (
                  <Typography
                    key={`${entry.ts}-${entry.msg}`}
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', fontFamily: 'monospace' }}
                  >
                    {new Date(entry.ts).toLocaleTimeString()} — {entry.msg}
                  </Typography>
                ))}
            </Box>
          )}
        </Paper>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField label="Agent name (ENS label)" value={agentLabel} fullWidth disabled />
          <TextField label="ENS name" value={fullEnsName} fullWidth disabled />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            minRows={3}
          />
          <TextField
            label="Chain ID"
            value={draft.chainId}
            fullWidth
            disabled
          />

          <Button
            variant="contained"
            disabled={!isConnected || !walletAddress || !eip1193Provider || submitting || flowState !== 'idle'}
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              setStatus(null);
              setStatusLog([]);
              setFlowState('confirm');
              setActiveStep(0);
              try {
                pushStatus('Computing smart account address…');
                if (!agentLabel) {
                  throw new Error('Agent name is missing or invalid.');
                }
                const chain =
                  draft.chainId === 11155111
                    ? sepolia
                    : draft.chainId === 84532
                      ? baseSepolia
                      : draft.chainId === 11155420
                        ? optimismSepolia
                        : sepolia;
                const agentAccount = await getCounterfactualSmartAccountAddressByAgentName(
                  agentLabel,
                  walletAddress as `0x${string}`,
                  { ethereumProvider: eip1193Provider, chain },
                );
                setActiveStep(1);

                const endpoints: Array<{ name: string; endpoint: string; version?: string }> = [];
                const baseUrl = (draft.agentUrl ?? '').trim().replace(/\/$/, '');
                if (baseUrl) {
                  endpoints.push({ name: 'A2A', endpoint: `${baseUrl}/a2a`, version: '0.3.0' });
                  endpoints.push({ name: 'MCP', endpoint: `${baseUrl}/mcp`, version: '2025-06-18' });
                }

                // Show a human-readable summary before MetaMask displays the raw UserOperation typed-data.
                setConfirmPayload({
                  chainId: draft.chainId,
                  ensName: fullEnsName,
                  agentAccount,
                  agentUrl: baseUrl || undefined,
                  a2aEndpoint: baseUrl ? `${baseUrl}/a2a` : undefined,
                  mcpEndpoint: baseUrl ? `${baseUrl}/mcp` : undefined,
                });
                setPendingAction(() => async () => {
                  setFlowState('running');
                  setConfirmOpen(false);
                  pushStatus('Opening MetaMask…');
                  pushStatus('Registering agent (ENS and 8004 Identity)…');

                  const result = await createAgentWithWallet({
                    agentData: {
                      agentName: agentLabel,
                      agentAccount,
                      agentCategory: (draft.agentCategory ?? '').trim() || undefined,
                      supportedTrust: draft.supportedTrust?.length ? draft.supportedTrust : undefined,
                      description: description.trim() || undefined,
                      image: (draft.imageUrl ?? '').trim() || undefined,
                      agentUrl: baseUrl || undefined,
                      endpoints: endpoints.length ? endpoints : undefined,
                    },
                    ethereumProvider: eip1193Provider,
                    account: walletAddress as `0x${string}`,
                    chainId: draft.chainId,
                    useAA: true,
                    ensOptions: {
                      enabled: true,
                      orgName: getEnsOrgName(draft.chainId),
                    },
                    onStatusUpdate: (m) => pushStatus(m),
                  });

                  const agentIdNumeric = Number(result.agentId);
                  if (!Number.isFinite(agentIdNumeric)) {
                    throw new Error('Failed to determine agentId from registration result.');
                  }

                  setActiveStep(2);
                  pushStatus('Preparing SessionPackage (delegation for feedback + validation)…');
                  const envRes = await fetch(`/api/chain-env?chainId=${encodeURIComponent(String(draft.chainId))}`, {
                    cache: 'no-store',
                  });
                  if (!envRes.ok) {
                    const err = await envRes.json().catch(() => ({}));
                    throw new Error(err?.message || err?.error || `Failed to load chain env (${envRes.status})`);
                  }
                  const chainEnv = (await envRes.json()) as {
                    rpcUrl: string;
                    bundlerUrl: string;
                    identityRegistry: `0x${string}`;
                    reputationRegistry: `0x${string}`;
                    validationRegistry: `0x${string}`;
                  };

                  const sessionPackage = await generateSessionPackage({
                    agentId: agentIdNumeric,
                    chainId: draft.chainId,
                    agentAccount: agentAccount as `0x${string}`,
                    provider: eip1193Provider,
                    ownerAddress: walletAddress as `0x${string}`,
                    rpcUrl: chainEnv.rpcUrl,
                    bundlerUrl: chainEnv.bundlerUrl,
                    identityRegistry: chainEnv.identityRegistry,
                    reputationRegistry: chainEnv.reputationRegistry,
                    validationRegistry: chainEnv.validationRegistry,
                  });

                  setActiveStep(3);
                  pushStatus('Returning to CLI…');
                  const issueRes = await fetch('/api/cli/issue', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      state: draft.state,
                      code_challenge: draft.codeChallenge,
                      redirect_uri: draft.redirectUri,
                      result: {
                        agentId: result.agentId,
                        txHash: result.txHash,
                        agentAccount,
                        ownerAddress: walletAddress,
                        chainId: draft.chainId,
                        sessionPackage,
                      },
                    }),
                  });
                  if (!issueRes.ok) {
                    const err = await issueRes.json().catch(() => ({}));
                    throw new Error(err?.error || err?.message || `Issue failed (${issueRes.status})`);
                  }
                  const issued = (await issueRes.json()) as any;
                  const code = String(issued?.code ?? '');
                  if (!code) {
                    throw new Error('Missing code from /api/cli/issue');
                  }

                  window.location.href = `${draft.redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(draft.state)}`;
                });

                setConfirmOpen(true);
                return;
              } catch (e: any) {
                setError(e?.message || 'Failed to register agent');
                setFlowState('idle');
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? 'Working…' : 'Register and return to CLI'}
          </Button>
        </Box>

        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>Confirm registration</DialogTitle>
          <DialogContent>
            <Alert severity="success" sx={{ mb: 2 }}>
              Sponsored by a paymaster — gasless.
            </Alert>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              You&apos;ll be asked to sign a smart-account <strong>UserOperation</strong>. Verify the network + smart account
              address below before continuing.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Network
              </Typography>
              <Typography variant="body2">Chain {confirmPayload?.chainId}</Typography>
              <Typography variant="body2" color="text.secondary">
                ENS name
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {confirmPayload?.ensName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Smart account
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {confirmPayload?.agentAccount}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                A2A endpoint
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {confirmPayload?.a2aEndpoint ?? '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                MCP endpoint
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {confirmPayload?.mcpEndpoint ?? '—'}
              </Typography>
            </Box>
            <Alert severity="info" sx={{ mt: 2 }}>
              In MetaMask, confirm you see Sepolia and the smart account address above.
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                setConfirmPayload(null);
                setPendingAction(null);
                setFlowState('idle');
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={async () => {
                if (!pendingAction) return;
                try {
                  setSubmitting(true);
                  await pendingAction();
                } catch (e: any) {
                  setError(e?.message || 'Failed to register agent');
                  setFlowState('idle');
                } finally {
                  setSubmitting(false);
                  setConfirmPayload(null);
                  setPendingAction(null);
                }
              }}
              disabled={submitting}
            >
              Continue in MetaMask
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Box>
  );
}

