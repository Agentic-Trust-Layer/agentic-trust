'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Container, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import type { AgentsPageAgent } from '@/components/AgentsPage';
// NOTE: We use Hedera WalletConnect (HWC) via dynamic import (client-only).
// Hashpack is phasing out legacy HashConnect.
let HWC_CONNECTOR_SINGLETON: any | null = null;
let HWC_INIT_PROMISE: Promise<void> | null = null;
let HWC_INIT_NETWORK: 'mainnet' | 'testnet' | null = null;

type Props = {
  protocol: string;
  uaid: string;
};

function isValidServiceUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^(uaid:|did:)/i.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ws:' || u.protocol === 'wss:';
  } catch {
    return false;
  }
}

export default function ProtocolRegistrationPage({ protocol, uaid }: Props) {
  const auth = useAuth();
  const wallet = useWallet();

  const normalizedProtocol = useMemo(() => String(protocol || '').trim().toLowerCase(), [protocol]);
  const canonicalUaid = useMemo(() => String(uaid || '').trim(), [uaid]);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agent, setAgent] = useState<AgentsPageAgent | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [holEndpoint, setHolEndpoint] = useState('');
  const [hwcConnector, setHwcConnector] = useState<any | null>(null);
  const [hederaAccountId, setHederaAccountId] = useState<string | null>(null);
  const [hederaSigner, setHederaSigner] = useState<any | null>(null);
  const [walletConnectReady, setWalletConnectReady] = useState(false);
  const [ledgerAuthStatus, setLedgerAuthStatus] = useState<string | null>(null);
  const [ledgerAuthLoading, setLedgerAuthLoading] = useState(false);
  const walletConnectEventsWiredRef = useRef(false);

  useEffect(() => {
    if (!canonicalUaid.startsWith('uaid:')) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    (async () => {
      setAgentLoading(true);
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(canonicalUaid)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          throw new Error((json as any)?.message || (json as any)?.error || `Failed to load agent (${res.status})`);
        }
        const agent = json as AgentsPageAgent;
        setAgent(agent);
        if (typeof agent?.a2aEndpoint === 'string' && isValidServiceUrl(agent.a2aEndpoint)) {
          setHolEndpoint(agent.a2aEndpoint.trim());
        }


      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? 'Failed to load agent');
          setAgent(null);
        }
      } finally {
        if (!cancelled) setAgentLoading(false);
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [canonicalUaid]);

  useEffect(() => {
    if (normalizedProtocol !== 'hol') return;
    let cancelled = false;

    (async () => {
      try {
        const projectId =
          (process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '').trim();
        if (!projectId) {
          setWalletConnectReady(false);
          setError('Missing NEXT_PUBLIC_REOWN_PROJECT_ID (WalletConnect Project ID).');
          return;
        }
        // WalletConnect/Reown Project IDs are 32-char hex strings.
        if (!/^[0-9a-f]{32}$/i.test(projectId)) {
          setWalletConnectReady(false);
          setError(
            'Invalid WalletConnect Project ID format. Expected 32 hex chars from Reown Cloud (not an app name/secret).',
          );
          return;
        }
        if (cancelled) return;

        // Ask server which Hedera network we’re using for HOL (env var is server-only).
        const netRes = await fetch('/api/hol/network', { cache: 'no-store' });
        const netJson = await netRes.json().catch(() => null);
        const network =
          (netJson as any)?.network === 'testnet' || (netJson as any)?.network === 'mainnet'
            ? ((netJson as any).network as 'mainnet' | 'testnet')
            : 'mainnet';

        const { DAppConnector, HederaJsonRpcMethod, HederaSessionEvent, HederaChainId } = await import(
          '@hashgraph/hedera-wallet-connect'
        );
        const { LedgerId } = await import('@hiero-ledger/sdk');
        if (cancelled) return;

        const origin = typeof window !== 'undefined' ? window.location.origin : 'https://agentic-trust.local';
        const metadata: any = {
          name: 'Agentic Trust Admin',
          description: 'HOL registration (ledger signing via Hashpack WalletConnect)',
          url: origin,
          icons: [`${origin}/favicon.ico`],
        };

        const ledgerId = network === 'testnet' ? (LedgerId as any).TESTNET : (LedgerId as any).MAINNET;
        const supportedMethods = HederaJsonRpcMethod ? Object.values(HederaJsonRpcMethod) : ['hedera_signMessage'];
        const supportedEvents = HederaSessionEvent
          ? [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged]
          : ['chainChanged', 'accountsChanged'];
        const supportedChains = HederaChainId ? [HederaChainId.Mainnet, HederaChainId.Testnet] : ['hedera:mainnet', 'hedera:testnet'];
        const connector =
          HWC_CONNECTOR_SINGLETON && HWC_INIT_NETWORK === network
            ? HWC_CONNECTOR_SINGLETON
            : new (DAppConnector as any)(
                metadata,
                ledgerId,
                projectId,
                supportedMethods,
                supportedEvents,
                supportedChains,
              );

        HWC_CONNECTOR_SINGLETON = connector;
        setHwcConnector(connector);

        if (!HWC_INIT_PROMISE || HWC_INIT_NETWORK !== network) {
          HWC_INIT_NETWORK = network;
          HWC_INIT_PROMISE = connector.init({ logger: 'error' });
        }
        await HWC_INIT_PROMISE;
        if (cancelled) return;

        setWalletConnectReady(true);

        if (!walletConnectEventsWiredRef.current) {
          walletConnectEventsWiredRef.current = true;
          // Connector keeps `signers` in sync with sessions; poll-based updates are enough for our flow.
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to init Hedera WalletConnect');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [normalizedProtocol]);

  const header = (
    <Header
      displayAddress={wallet.address ?? null}
      privateKeyMode={wallet.privateKeyMode}
      isConnected={wallet.connected}
      onConnect={auth.openLoginModal}
      onDisconnect={auth.handleDisconnect}
      disableConnect={wallet.loading || auth.loading}
    />
  );

  const title = useMemo(() => {
    switch (normalizedProtocol) {
      case 'ens':
        return 'Register agent: ENS';
      case 'hol':
        return 'Register agent: HOL';
      case 'agentverse':
        return 'Register agent: AgentVerse';
      case 'ans':
        return 'Register agent: ANS';
      case 'aid':
        return 'Register agent: AID';
      default:
        return `Register agent: ${protocol}`;
    }
  }, [normalizedProtocol, protocol]);

  const canSubmitHol =
    normalizedProtocol === 'hol' &&
    canonicalUaid.startsWith('uaid:') &&
    holEndpoint.trim().length > 0;

  async function connectHashpack() {
    setError(null);
    setLedgerAuthStatus(null);
    if (!walletConnectReady || !hwcConnector) {
      setError('WalletConnect is not initialized. Check NEXT_PUBLIC_REOWN_PROJECT_ID.');
      return;
    }
    try {
      await hwcConnector.openModal();
      const signer = Array.isArray(hwcConnector.signers) && hwcConnector.signers.length > 0 ? hwcConnector.signers[0] : null;
      if (!signer) throw new Error('No Hedera signer available after WalletConnect connection.');
      const accountId = signer.getAccountId?.()?.toString?.() ?? null;
      if (!accountId) throw new Error('WalletConnect connected but no accountId was returned.');
      setHederaSigner(signer);
      setHederaAccountId(String(accountId));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to connect Hashpack (WalletConnect)');
    }
  }

  function toBase64(value: Uint8Array) {
    let binary = '';
    for (let i = 0; i < value.length; i++) binary += String.fromCharCode(value[i]);
    return btoa(binary);
  }

  async function authenticateWithHashpack() {
    setError(null);
    setLedgerAuthStatus(null);
    if (!hederaSigner || !hederaAccountId) {
      setError('Connect Hashpack first.');
      return;
    }
    setLedgerAuthLoading(true);
    try {
      const chalRes = await fetch('/api/hol/ledger-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: hederaAccountId }),
      });
      const chalJson = await chalRes.json().catch(() => null);
      if (!chalRes.ok) {
        throw new Error((chalJson as any)?.message || (chalJson as any)?.error || `Challenge failed (${chalRes.status})`);
      }
      const challenge = (chalJson as any)?.challenge;
      const challengeId = String(challenge?.challengeId ?? '');
      const message = String(challenge?.message ?? '');
      if (!challengeId || !message) {
        throw new Error('Invalid broker challenge response');
      }

      const payload = new TextEncoder().encode(message);
      const signatures = await hederaSigner.sign([payload]);
      const entry = signatures?.[0];
      if (!entry?.signature) throw new Error('WalletConnect signer did not return a signature');
      const signature = toBase64(entry.signature);
      const publicKey =
        entry?.publicKey?.toString?.() ||
        (typeof hederaSigner.getAccountKey === 'function' ? (await hederaSigner.getAccountKey())?.toString?.() : undefined);

      const verifyRes = await fetch('/api/hol/ledger-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: hederaAccountId,
          challengeId,
          signature,
          signatureKind: 'raw',
          ...(publicKey ? { publicKey } : {}),
        }),
      });
      const verifyJson = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok) {
        const body = (verifyJson as any)?.body;
        const details = body ? `\n${JSON.stringify(body, null, 2)}` : '';
        throw new Error(
          (verifyJson as any)?.message ||
            (verifyJson as any)?.error ||
            `Verify failed (${verifyRes.status})${details}`,
        );
      }
      const apiKey = (verifyJson as any)?.verified?.apiKey;
      setLedgerAuthStatus(apiKey?.prefix ? `Authenticated (key ${apiKey.prefix}…${apiKey.lastFour})` : 'Authenticated');
    } finally {
      setLedgerAuthLoading(false);
    }
  }

  async function submitHol() {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      if (!ledgerAuthStatus) {
        await authenticateWithHashpack();
      }
      const res = await fetch('/api/hol/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uaid: canonicalUaid,
          endpoint: holEndpoint.trim(),
          communicationProtocol: 'a2a'
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((json as any)?.message || (json as any)?.error || `HOL registration failed (${res.status})`);
      }
      setSuccess('HOL registration submitted.');
    } catch (e: any) {
      setError(e?.message ?? 'HOL registration failed');
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      {header}
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ fontWeight: 800, fontSize: '1.35rem' }}>{title}</Box>

          {canonicalUaid ? (
            <Box sx={{ color: 'text.secondary', fontFamily: 'monospace', wordBreak: 'break-all' }}>{canonicalUaid}</Box>
          ) : (
            <Alert severity="warning">Missing `uaid` query parameter.</Alert>
          )}

          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}

          {normalizedProtocol !== 'hol' ? (
            <Alert severity="info">
              This protocol flow isn’t implemented yet in-app. The UI entrypoint is wired; we can implement the full
              write flow once the protocol’s registration SDK/API details are available.
            </Alert>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button
                  variant="outlined"
                  disabled={!walletConnectReady || saving}
                  onClick={connectHashpack}
                >
                  Connect Hashpack (WalletConnect)
                </Button>
                <Button
                  variant="outlined"
                  disabled={!hederaAccountId || ledgerAuthLoading || saving}
                  onClick={authenticateWithHashpack}
                >
                  {ledgerAuthLoading ? 'Authenticating…' : 'Authenticate ledger'}
                </Button>
                <Box sx={{ color: 'text.secondary' }}>
                  {hederaAccountId ? `Account: ${hederaAccountId}` : walletConnectReady ? 'WalletConnect ready' : 'WalletConnect not ready'}
                </Box>
              </Box>
              {ledgerAuthStatus && <Alert severity="success">{ledgerAuthStatus}</Alert>}

              <TextField label="UAID" value={canonicalUaid} fullWidth disabled />

              {agentLoading ? (
                <Alert severity="info">Loading agent details…</Alert>
              ) : agent ? (
                <Alert severity="success">
                  Agent loaded: {(agent.agentName ?? `#${agent.agentId}`) as string}
                </Alert>
              ) : (
                <Alert severity="warning">Agent details not loaded. Registration will still attempt UAID-only write.</Alert>
              )}

              <TextField
                label="A2A endpoint"
                value={canonicalUaid}
                onChange={(e) => setHolEndpoint(e.target.value)}
                placeholder="https://your-agent.example.com/a2a"
                fullWidth
                disabled={saving}
              />


              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  disabled={!canSubmitHol || saving}
                  onClick={() => setConfirmOpen(true)}
                >
                  Register to HOL
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      </Container>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm HOL registration</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ color: 'text.secondary' }}>HOL UAID</Box>
            <Box sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{canonicalUaid || '—'}</Box>
            <Box sx={{ color: 'text.secondary', mt: 2 }}>A2A endpoint</Box>
            <Box sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{holEndpoint.trim() || '—'}</Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submitHol} variant="contained" disabled={!canSubmitHol || saving}>
            {saving ? 'Registering…' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

