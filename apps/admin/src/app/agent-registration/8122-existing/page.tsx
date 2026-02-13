'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Address } from 'viem';
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  toHex,
} from 'viem';
import { mainnet, sepolia, baseSepolia, optimismSepolia, linea, lineaSepolia } from 'viem/chains';

import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { grayscalePalette as palette } from '@/styles/palette';
import { getClientBundlerUrl } from '@/lib/clientChainEnv';

import {
  getDeployedAccountClientByAgentName,
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
} from '@agentic-trust/core/client';

import type { Erc8122MetadataEntry } from '@agentic-trust/8122-sdk';
import { agentRegistryAbi, agentRegistrarAbi } from '@agentic-trust/8122-sdk';

type Registry8122 = {
  chainId: number;
  registryAddress: string;
  registrarAddress?: string | null;
  registryName?: string | null;
};

const SUPPORTED_CHAINS = [
  { id: 1, label: 'Ethereum Mainnet' },
  { id: 11155111, label: 'Sepolia' },
  { id: 84532, label: 'Base Sepolia' },
  { id: 11155420, label: 'Optimism Sepolia' },
  { id: 59144, label: 'Linea Mainnet' },
  { id: 59141, label: 'Linea Sepolia' },
] as const;

const CHAIN_BY_ID: Record<number, any> = {
  1: mainnet,
  11155111: sepolia,
  84532: baseSepolia,
  11155420: optimismSepolia,
  59144: linea,
  59141: lineaSepolia,
};

function safeUrl(raw: string): string | null {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function parseDidEthrFromUaid(uaid: string): { chainId: number; account: Address } | null {
  const m = /^uaid:did:ethr:(\d+):(0x[a-fA-F0-9]{40})\b/.exec(String(uaid || '').trim());
  if (!m) return null;
  const chainId = Number(m[1]);
  const account = getAddress(m[2]) as Address;
  if (!Number.isFinite(chainId) || chainId <= 0) return null;
  return { chainId, account };
}

function buildDid8122(params: { chainId: number; registry: Address; agentId: bigint }): string {
  return `did:8122:${params.chainId}:${params.registry}:${params.agentId.toString()}`;
}

function buildDidEthr(params: { chainId: number; account: Address }): string {
  return `did:ethr:${params.chainId}:${params.account.toLowerCase()}`;
}

async function generateSmartAgentUaid(params: {
  chainId: number;
  account: Address;
  registry: Address;
  proto: 'a2a' | 'mcp';
  nativeId?: string;
}): Promise<{ uaid: string; didEthr: string }> {
  const didEthr = buildDidEthr({ chainId: params.chainId, account: params.account });
  const res = await fetch('/api/agents/generate-uaid', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentAccount: params.account,
      chainId: params.chainId,
      uid: didEthr,
      registry: params.registry,
      proto: params.proto,
      ...(typeof params.nativeId === 'string' && params.nativeId.trim() ? { nativeId: params.nativeId.trim() } : {}),
    }),
  });
  const json = (await res.json().catch(() => null)) as any;
  const uaid = typeof json?.uaid === 'string' ? json.uaid.trim() : '';
  if (!res.ok || !uaid) {
    throw new Error(json?.message || json?.error || 'Failed to generate UAID.');
  }
  return { uaid, didEthr };
}

async function ensureEip1193Chain(provider: any, chainId: number) {
  if (!provider?.request) {
    throw new Error('Missing wallet provider (EIP-1193). Connect a wallet to continue.');
  }
  const currentHex = await provider.request({ method: 'eth_chainId' });
  const currentId = typeof currentHex === 'string' ? parseInt(currentHex, 16) : Number.NaN;
  if (Number.isFinite(currentId) && currentId === chainId) return;
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] });
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as any;
    if (typeof anyErr.shortMessage === 'string' && anyErr.shortMessage.trim()) return anyErr.shortMessage;
    if (typeof anyErr.message === 'string' && anyErr.message.trim()) return anyErr.message;
  }
  return String(err);
}

export default function AgentRegistration8122ExistingPage() {
  const searchParams = useSearchParams();
  const uaidParam = searchParams?.get('uaid') ?? '';
  const uaid = decodeURIComponent(uaidParam || '').trim();

  const { eip1193Provider } = useWallet();
  const {
    isConnected,
    privateKeyMode,
    loading,
    walletAddress,
    openLoginModal,
    handleDisconnect,
  } = useAuth();

  const parsedEthr = useMemo(() => (uaid ? parseDidEthrFromUaid(uaid) : null), [uaid]);
  const chainId = parsedEthr?.chainId ?? 11155111;
  const chain = CHAIN_BY_ID[chainId] ?? sepolia;
  const chainLabel = useMemo(
    () => SUPPORTED_CHAINS.find((c) => c.id === chainId)?.label ?? String(chainId),
    [chainId],
  );

  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<any>(null);

  const [registriesLoading, setRegistriesLoading] = useState(false);
  const [registriesError, setRegistriesError] = useState<string | null>(null);
  const [registries, setRegistries] = useState<Registry8122[]>([]);
  const [selectedRegistrar, setSelectedRegistrar] = useState<string>('');

  const [registering, setRegistering] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRegister = Boolean(isConnected && walletAddress && eip1193Provider && !privateKeyMode && parsedEthr?.account);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setAgentError(null);
    setAgentLoading(true);
    setAgentDetail(null);
    setSuccess(null);
    setError(null);

    (async () => {
      try {
        if (!uaid || !uaid.startsWith('uaid:')) {
          throw new Error('Missing UAID. Open this page from an agent detail view.');
        }
        const res = await fetch(`/api/agents/${encodeURIComponent(uaid)}`, { cache: 'no-store', signal: controller.signal });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.message || json?.error || `Failed to load agent (${res.status})`);
        if (cancelled) return;
        setAgentDetail(json);
      } catch (e) {
        if (cancelled) return;
        setAgentError(formatError(e));
      } finally {
        if (!cancelled) setAgentLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [uaid]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setRegistriesError(null);
    setRegistriesLoading(true);
    setRegistries([]);

    (async () => {
      try {
        const res = await fetch('/api/registries/8122', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chainId, first: 250, skip: 0 }),
          signal: controller.signal,
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || json?.message || `Failed to load collections (${res.status})`);
        const rows = Array.isArray(json?.registries) ? (json.registries as Registry8122[]) : [];
        if (cancelled) return;
        setRegistries(rows);
        const firstRegistrar =
          rows.find((r) => typeof r?.registrarAddress === 'string' && r.registrarAddress?.trim())?.registrarAddress ??
          '';
        setSelectedRegistrar((prev) => prev || firstRegistrar || '');
      } catch (e) {
        if (cancelled) return;
        setRegistriesError(formatError(e));
      } finally {
        if (!cancelled) setRegistriesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [chainId]);

  const agentName = useMemo(() => {
    const name = typeof agentDetail?.agentName === 'string' ? agentDetail.agentName.trim() : '';
    return name || '—';
  }, [agentDetail]);

  const ensName = useMemo(() => {
    const name = typeof agentDetail?.agentName === 'string' ? agentDetail.agentName.trim() : '';
    return /\.eth$/i.test(name) ? name : null;
  }, [agentDetail]);

  const a2aEndpoint = useMemo(() => {
    const ep = typeof agentDetail?.a2aEndpoint === 'string' ? agentDetail.a2aEndpoint.trim() : '';
    return ep || null;
  }, [agentDetail]);

  const description = useMemo(() => {
    const d = typeof agentDetail?.description === 'string' ? agentDetail.description.trim() : '';
    return d || '';
  }, [agentDetail]);

  const image = useMemo(() => {
    const img = typeof agentDetail?.image === 'string' ? agentDetail.image.trim() : '';
    return img || '';
  }, [agentDetail]);

  const agentLabelForAa = useMemo(() => {
    if (ensName) return String(ensName).split('.')[0]?.trim() || '';
    const raw = typeof agentDetail?.agentName === 'string' ? agentDetail.agentName.trim() : '';
    return raw.split('.')[0]?.trim() || raw;
  }, [agentDetail, ensName]);

  const selectedRegistrarLabel = useMemo(() => {
    const registrar = selectedRegistrar.trim().toLowerCase();
    const r = registries.find((x) => String(x.registrarAddress || '').trim().toLowerCase() === registrar);
    const name = typeof r?.registryName === 'string' ? r.registryName.trim() : '';
    return name ? `${name} (${r?.registrarAddress})` : (r?.registrarAddress ?? selectedRegistrar);
  }, [registries, selectedRegistrar]);

  const handleRegister = useCallback(async () => {
    setError(null);
    setSuccess(null);
    if (!canRegister) {
      setError('Connect wallet (EOA) to sign, and open from a Smart Agent (uaid:did:ethr:...).');
      return;
    }
    if (!parsedEthr?.account) {
      setError('UAID is not a smart-agent UAID (did:ethr).');
      return;
    }
    const registrarRaw = selectedRegistrar.trim();
    if (!registrarRaw) {
      setError('Select an ERC-8122 collection (registrar).');
      return;
    }

    const endpoint = safeUrl(a2aEndpoint || '');

    setRegistering(true);
    try {
      await ensureEip1193Chain(eip1193Provider, chainId);

      const registrar = getAddress(registrarRaw) as Address;
      const eoa = getAddress(walletAddress!) as Address;
      const bundlerUrl = getClientBundlerUrl(chainId);
      if (!bundlerUrl) throw new Error(`Missing bundler URL for chainId ${chainId}.`);

      const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
      if (typeof rpcUrl !== 'string' || !rpcUrl.trim()) throw new Error(`No RPC URL available for chainId ${chainId}.`);
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

      // Ensure the MetaMask account client exists for this agent name (should already be deployed).
      const accountClient = await getDeployedAccountClientByAgentName(bundlerUrl, agentLabelForAa, eoa, {
        ethereumProvider: eip1193Provider,
        chain,
      });
      const aaAddr = getAddress(String(accountClient?.address || '')) as Address;
      if (aaAddr !== parsedEthr.account) {
        throw new Error(`Smart Account mismatch. UAID targets ${parsedEthr.account} but computed AA is ${aaAddr}.`);
      }

      // Registrar basics
      const code = await publicClient.getBytecode({ address: registrar });
      if (!code || code === '0x') throw new Error(`Registrar address has no bytecode (wrong chain?): ${registrar}`);

      const mintPrice = (await publicClient.readContract({
        address: registrar,
        abi: agentRegistrarAbi,
        functionName: 'mintPrice',
      })) as bigint;

      const registry = (await publicClient.readContract({
        address: registrar,
        abi: agentRegistrarAbi,
        functionName: 'registry',
      })) as Address;

      const metadata: Erc8122MetadataEntry[] = [
        { key: 'name', value: toHex(agentName) as `0x${string}` },
        { key: 'description', value: toHex(description) as `0x${string}` },
        { key: 'image', value: toHex(image) as `0x${string}` },
      ];
      // Endpoint is optional in this flow (some Smart Agents may not have A2A configured yet).
      // If present, include it as A2A metadata for the registrar.
      if (endpoint) {
        metadata.push({ key: 'endpoint_type', value: toHex('a2a') as `0x${string}` });
        metadata.push({ key: 'endpoint', value: toHex(endpoint) as `0x${string}` });
      }
      if (ensName) metadata.push({ key: 'ens_name', value: toHex(ensName) as `0x${string}` });

      const { uaid: uaidBeforeMint } = await generateSmartAgentUaid({
        chainId,
        account: aaAddr,
        registry: getAddress(registry) as Address,
        proto: 'a2a',
      });
      metadata.push({ key: 'uaid', value: toHex(uaidBeforeMint) as `0x${string}` });

      metadata.push({
        key: 'agent_account',
        value: encodeAbiParameters([{ type: 'address' }], [aaAddr]) as `0x${string}`,
      });

      setSuccess('MetaMask signature: mint ERC-8122 agent (UserOperation)…');
      const mintData = encodeFunctionData({
        abi: agentRegistrarAbi,
        functionName: 'mint',
        args: [aaAddr, metadata],
      });
      const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain,
        accountClient,
        calls: [{ to: registrar, data: mintData, value: mintPrice }],
      });
      const uoReceipt = await waitForUserOperationReceipt({ bundlerUrl, chain, hash: userOpHash });

      const txHash =
        ((uoReceipt as any)?.receipt?.transactionHash as `0x${string}` | undefined) ||
        ((uoReceipt as any)?.transactionHash as `0x${string}` | undefined) ||
        null;
      if (!txHash) throw new Error(`UserOperation sent but transactionHash not returned. userOp=${userOpHash}`);

      const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      let agentId: bigint | null = null;
      for (const log of (mintReceipt as any)?.logs || []) {
        try {
          const decoded = decodeEventLog({ abi: agentRegistrarAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === 'AgentMinted') {
            agentId = (decoded.args as any).agentId as bigint;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (agentId == null) throw new Error(`Mint mined but AgentMinted event not found. tx=${txHash}`);

      // Best-effort: set UAID with nativeId after mint.
      try {
        const did8122 = buildDid8122({ chainId, registry: getAddress(registry) as Address, agentId });
        const { uaid: uaidAfterMint } = await generateSmartAgentUaid({
          chainId,
          account: aaAddr,
          registry: getAddress(registry) as Address,
          proto: 'a2a',
          nativeId: did8122,
        });
        const setData = encodeFunctionData({
          abi: agentRegistryAbi,
          functionName: 'setMetadata',
          args: [agentId, 'uaid', toHex(uaidAfterMint) as `0x${string}`],
        });
        const uoHash = await sendSponsoredUserOperation({
          bundlerUrl,
          chain,
          accountClient,
          calls: [{ to: getAddress(registry) as Address, data: setData }],
        });
        await waitForUserOperationReceipt({ bundlerUrl, chain, hash: uoHash });
      } catch {
        // ignore
      }

      setSuccess(`Registered agent into ERC-8122 collection. Minted agentId=${agentId.toString()} on ${chainLabel}.`);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setRegistering(false);
    }
  }, [a2aEndpoint, agentLabelForAa, agentName, canRegister, chain, chainId, chainLabel, description, eip1193Provider, ensName, image, parsedEthr, selectedRegistrar, walletAddress]);

  return (
    <>
      <Header
        displayAddress={walletAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={loading}
      />

      <main style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>Agent Registration</div>
          <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.6rem' }}>ERC-8122 (use existing Smart Agent)</h1>
          <div style={{ marginTop: '0.5rem', color: palette.textSecondary, lineHeight: 1.4 }}>
            Select an ERC-8122 collection and register this existing Smart Agent into it.
          </div>
        </div>

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            padding: '1rem',
            background: palette.surface,
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Smart Agent</h2>
          {agentLoading ? (
            <div style={{ marginTop: '0.75rem', color: palette.textSecondary }}>Loading agent…</div>
          ) : agentError ? (
            <div style={{ marginTop: '0.75rem', color: palette.dangerText }}>
              Error: <code>{agentError}</code>
            </div>
          ) : (
            <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '220px 1fr', gap: '0.75rem' }}>
              <div style={{ color: palette.textSecondary }}>UAID</div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{uaid || '—'}</div>
              <div style={{ color: palette.textSecondary }}>Chain</div>
              <div>{chainLabel} ({chainId})</div>
              <div style={{ color: palette.textSecondary }}>Name</div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{agentName}</div>
              <div style={{ color: palette.textSecondary }}>A2A</div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{a2aEndpoint || '—'}</div>
              <div style={{ color: palette.textSecondary }}>ENS</div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{ensName || '—'}</div>
            </div>
          )}
        </section>

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            padding: '1rem',
            background: palette.surface,
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>ERC-8122 Collection</h2>
          <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '220px 1fr', gap: '0.75rem' }}>
            <div style={{ color: palette.textSecondary, paddingTop: '0.55rem' }}>Collection</div>
            <select
              value={selectedRegistrar}
              onChange={(e) => setSelectedRegistrar(e.target.value)}
              disabled={registriesLoading || registries.length === 0}
              style={{
                padding: '0.55rem 0.7rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
              }}
            >
              <option value="">{registriesLoading ? 'Loading…' : registries.length === 0 ? 'No collections found' : 'Select…'}</option>
              {registries
                .filter((r) => typeof r?.registrarAddress === 'string' && r.registrarAddress?.trim())
                .map((r) => {
                  const addr = String(r.registrarAddress || '').trim();
                  const label = r.registryName ? `${r.registryName} — ${addr}` : addr;
                  return (
                    <option key={addr.toLowerCase()} value={addr}>
                      {label}
                    </option>
                  );
                })}
            </select>
          </div>
          {registriesError && (
            <div style={{ marginTop: '0.75rem', color: palette.dangerText }}>
              Error: <code>{registriesError}</code>
            </div>
          )}
        </section>

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            padding: '1rem',
            background: palette.surface,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Register</h2>
          <div style={{ marginTop: '0.75rem', color: palette.textSecondary }}>
            Selected collection: <code>{selectedRegistrarLabel || '—'}</code>
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={!canRegister || registering || agentLoading || Boolean(agentError)}
              onClick={() => void handleRegister()}
              style={{
                padding: '0.65rem 0.95rem',
                borderRadius: '10px',
                border: `1px solid ${palette.borderStrong}`,
                background: registering ? palette.borderStrong : palette.accent,
                color: palette.surface,
                fontWeight: 900,
                cursor: registering ? 'not-allowed' : 'pointer',
                opacity: !canRegister || registering ? 0.7 : 1,
              }}
              title={!canRegister ? 'Connect wallet (EOA) and open from a Smart Agent' : 'Register into collection'}
            >
              {registering ? 'Registering…' : 'Register into ERC-8122 Collection'}
            </button>
            {!isConnected && (
              <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>Connect your wallet to continue.</div>
            )}
            {privateKeyMode && (
              <div style={{ color: palette.dangerText, fontSize: '0.9rem' }}>Not available in server-admin mode.</div>
            )}
          </div>

          {success && (
            <div style={{ marginTop: '0.75rem', color: palette.textPrimary }}>
              <strong>Success:</strong> {success}
            </div>
          )}
          {error && (
            <div style={{ marginTop: '0.75rem', color: palette.dangerText }}>
              <strong>Error:</strong> {error}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

