'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Box, Button, Container, TextField, Typography } from '@mui/material';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';

import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { getClientChainEnv } from '@/lib/clientChainEnv';
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
  const [error, setError] = useState<string | null>(null);

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
          Finish ERC-8004 registration in the browser, then you'll be redirected back to the CLI.
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
            disabled={!isConnected || !walletAddress || !eip1193Provider || submitting}
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              setStatus(null);
              try {
                setStatus('Computing agent account…');
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

                setStatus('Registering agent on-chain…');
                const endpoints: Array<{ name: string; endpoint: string; version?: string }> = [];
                const baseUrl = (draft.agentUrl ?? '').trim().replace(/\/$/, '');
                if (baseUrl) {
                  endpoints.push({ name: 'A2A', endpoint: `${baseUrl}/api/a2a`, version: '0.3.0' });
                  if (draft.enableMcp) {
                    endpoints.push({ name: 'MCP', endpoint: `${baseUrl}/api/mcp`, version: '2025-06-18' });
                  }
                }

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
                  onStatusUpdate: (m) => setStatus(m),
                });

                const agentIdNumeric = Number(result.agentId);
                if (!Number.isFinite(agentIdNumeric)) {
                  throw new Error('Failed to determine agentId from registration result.');
                }

                setStatus('Generating session package…');
                const chainEnv = getClientChainEnv(draft.chainId);
                if (!chainEnv.rpcUrl) {
                  throw new Error(
                    'Missing RPC URL configuration for this chain. Set NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_* env vars.',
                  );
                }
                if (!chainEnv.bundlerUrl) {
                  throw new Error(
                    'Missing bundler URL configuration for this chain. Set NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_* env vars.',
                  );
                }
                if (!chainEnv.identityRegistry) {
                  throw new Error(
                    'Missing IdentityRegistry address. Set NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_* env vars.',
                  );
                }
                if (!chainEnv.reputationRegistry) {
                  throw new Error(
                    'Missing ReputationRegistry address. Set NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_* env vars.',
                  );
                }
                if (!chainEnv.validationRegistry) {
                  throw new Error(
                    'Missing ValidationRegistry address. Set NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_* env vars.',
                  );
                }

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
              } catch (e: any) {
                setError(e?.message || 'Failed to register agent');
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? 'Working…' : 'Register and return to CLI'}
          </Button>
        </Box>
      </Container>
    </Box>
  );
}

