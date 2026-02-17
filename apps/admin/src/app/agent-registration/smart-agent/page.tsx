'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Address } from 'viem';
import { getAddress } from 'viem';
import { mainnet, sepolia, baseSepolia, optimismSepolia, linea, lineaSepolia } from 'viem/chains';

import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { grayscalePalette as palette } from '@/styles/palette';
import { getClientBundlerUrl } from '@/lib/clientChainEnv';

import {
  getCounterfactualSmartAccountAddressByAgentName,
  getDeployedAccountClientByAgentName,
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
} from '@agentic-trust/core/client';
import { DEFAULT_CHAIN_ID, getEnsOrgName } from '@agentic-trust/core/server';
import { buildDidEnsFromAgentAndOrg } from '@/app/api/names/_lib/didEns';

const CREATE_STEPS = ['Name', 'Information', 'Review & Register'] as const;

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

function chainIdToHex(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

async function ensureEip1193Chain(provider: any, chainId: number) {
  if (!provider?.request) {
    throw new Error('Missing wallet provider (EIP-1193). Connect a wallet to continue.');
  }
  const currentHex = await provider.request({ method: 'eth_chainId' });
  const currentId = typeof currentHex === 'string' ? parseInt(currentHex, 16) : Number.NaN;
  if (Number.isFinite(currentId) && currentId === chainId) return;
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: chainIdToHex(chainId) }],
  });
}

function isL1ChainId(chainId: number): boolean {
  return chainId === 1 || chainId === 11155111;
}

function getDefaultAgentBaseUrl(): string {
  const envBase = (process.env.NEXT_PUBLIC_AGENTIC_TRUST_AGENT_BASE_URL || '').trim();
  const originBase = typeof window !== 'undefined' ? String(window.location.origin || '').trim() : '';
  const base = (envBase || originBase).replace(/\/+$/, '');
  return base;
}

function formatAgentSlug(name?: string): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

const buildDefaultAgentUrl = (name?: string): string => {
  const safe = formatAgentSlug(name);
  if (!safe) return '';
  const base = getDefaultAgentBaseUrl();
  // For hosted envs like https://t.agentictrust.io, prefer path-based URLs.
  if (base && /^https?:\/\/[^/]+\.agentictrust\.io(?::\d+)?$/i.test(base)) return `${base}/${safe}`;
  // Fallback to subdomain pattern.
  return `https://${safe}.agentictrust.io`;
};

function normalizeEnsAgentLabel(params: { agentName: string; orgName: string | null }): string {
  const rawOrg = String(params.orgName || '').trim();
  const rawAgent = String(params.agentName || '').trim();
  const cleanOrgName = rawOrg.replace(/\.eth$/i, '').toLowerCase();
  const orgPattern = cleanOrgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return rawAgent
    .replace(new RegExp(`^${orgPattern}\\.`, 'i'), '')
    .replace(/\.eth$/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

export default function SmartAgentRegistrationPage() {
  const router = useRouter();
  const { isConnected, privateKeyMode, loading, walletAddress, openLoginModal, handleDisconnect } = useAuth();
  const { eip1193Provider } = useWallet();

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const onResize = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth <= 640);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [createStep, setCreateStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selectedChainId, setSelectedChainId] = useState<number>(DEFAULT_CHAIN_ID);
  const chain = CHAIN_BY_ID[selectedChainId] ?? CHAIN_BY_ID[DEFAULT_CHAIN_ID];
  const chainLabel = useMemo(
    () => SUPPORTED_CHAINS.find((c) => c.id === selectedChainId)?.label ?? String(selectedChainId),
    [selectedChainId],
  );

  const canSign = Boolean(isConnected && walletAddress && eip1193Provider && !privateKeyMode);

  const [ensOrgName, setEnsOrgName] = useState<string | null>(null);
  const [ensChecking, setEnsChecking] = useState(false);
  const [ensAvailable, setEnsAvailable] = useState<boolean | null>(null);
  const [ensExisting, setEnsExisting] = useState<{ image: string | null; url: string | null; description: string | null } | null>(null);

  const [aaComputing, setAaComputing] = useState(false);
  const [aaAddress, setAaAddress] = useState<string | null>(null);

  const [registering, setRegistering] = useState(false);
  const [registrationCompleteOpen, setRegistrationCompleteOpen] = useState(false);
  const [registrationCompleteDetails, setRegistrationCompleteDetails] = useState<{
    smartAccount?: string;
    ensName?: string;
    uaid?: string;
    userOpHash?: string;
  } | null>(null);

  const [form, setForm] = useState(() => {
    const getDefaultImageUrl = () =>
      typeof window !== 'undefined' ? `${window.location.origin}/8004Agent.png` : '/8004Agent.png';
    return {
      agentName: '',
      agentAccount: '',
      description: '',
      image: getDefaultImageUrl(),
      agentUrl: '',
    };
  });
  const [agentUrlAutofillDisabled, setAgentUrlAutofillDisabled] = useState(false);
  const previousDefaultAgentUrlRef = React.useRef<string>('');

  const handleResetAgentUrlToDefault = useCallback(() => {
    const next = buildDefaultAgentUrl(form.agentName);
    setAgentUrlAutofillDisabled(false);
    setForm((prev) => ({ ...prev, agentUrl: next }));
    previousDefaultAgentUrlRef.current = next;
  }, [form.agentName]);

  const ensFullNamePreview =
    form.agentName && ensOrgName ? `${form.agentName.toLowerCase()}.${ensOrgName.toLowerCase()}.eth` : '';

  // keep ENS org name synced
  useEffect(() => {
    try {
      const name = getEnsOrgName(selectedChainId);
      setEnsOrgName(name || null);
    } catch {
      setEnsOrgName(null);
    }
  }, [selectedChainId]);

  // autofill agent URL like 8004
  useEffect(() => {
    const defaultUrl = buildDefaultAgentUrl(form.agentName);
    setForm((prev) => {
      const current = (prev.agentUrl || '').trim();
      if (!defaultUrl) return prev;

      const base = getDefaultAgentBaseUrl().replace(/\/+$/, '');
      const normalizedCurrent = current.replace(/\/+$/, '');
      const previousDefault = (previousDefaultAgentUrlRef.current || '').trim();

      // Autofill rules:
      // - If user never edited the field → always keep in sync.
      // - If user edited the field, still "self-heal" when the value is just the bare base URL
      //   (common during dev/hot-reload state preservation).
      if (agentUrlAutofillDisabled) {
        const isBareBase = Boolean(base) && normalizedCurrent === base;
        const isPreviousDefault = Boolean(previousDefault) && current === previousDefault;
        if (!isBareBase && !isPreviousDefault) return prev;
      }

      previousDefaultAgentUrlRef.current = defaultUrl;
      return { ...prev, agentUrl: defaultUrl };
    });
  }, [form.agentName, agentUrlAutofillDisabled]);

  // ENS availability
  useEffect(() => {
    if (!form.agentName || !ensOrgName) {
      setEnsAvailable(null);
      setEnsChecking(false);
      setEnsExisting(null);
      return;
    }
    let cancelled = false;
    setEnsChecking(true);
    setEnsAvailable(null);
    setEnsExisting(null);

    (async () => {
      try {
        const encodedEnsDid = buildDidEnsFromAgentAndOrg(selectedChainId, form.agentName, ensOrgName);
        const response = await fetch(`/api/names/${encodedEnsDid}`, { method: 'GET' });
        if (cancelled) return;
        if (!response.ok) {
          setEnsAvailable(null);
          return;
        }
        const data = await response.json().catch(() => ({} as any));
        const available = data?.nameInfo?.available === true;
        setEnsAvailable(available);
        if (!available && data?.nameInfo) {
          setEnsExisting({
            image: data.nameInfo.image || null,
            url: data.nameInfo.url || null,
            description: data.nameInfo.description || null,
          });
        }
      } catch {
        if (!cancelled) setEnsAvailable(null);
      } finally {
        if (!cancelled) setEnsChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [form.agentName, ensOrgName, selectedChainId]);

  // compute AA address like 8004
  useEffect(() => {
    const name = form.agentName.trim();
    if (!name || !eip1193Provider || !walletAddress) {
      setAaAddress(null);
      setForm((prev) => ({ ...prev, agentAccount: '' }));
      return;
    }
    let cancelled = false;
    setAaComputing(true);
    (async () => {
      try {
        const eoa = getAddress(walletAddress) as Address;
        const computed = await getCounterfactualSmartAccountAddressByAgentName(name, eoa, {
          ethereumProvider: eip1193Provider as any,
          chain,
        });
        if (cancelled) return;
        setAaAddress(computed);
        setForm((prev) => ({ ...prev, agentAccount: computed }));
      } catch {
        if (!cancelled) {
          setAaAddress(null);
          setForm((prev) => ({ ...prev, agentAccount: '' }));
        }
      } finally {
        if (!cancelled) setAaComputing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.agentName, walletAddress, eip1193Provider, chain]);

  const canProceed = useMemo(() => {
    switch (createStep) {
      case 0: {
        if (!form.agentName.trim()) return { ok: false, message: 'Agent name is required.' };
        if (!ensOrgName) return { ok: false, message: 'ENS org name is not configured for this chain.' };
        if (ensAvailable !== true) return { ok: false, message: 'ENS name must be available.' };
        if (!form.agentAccount.trim().startsWith('0x')) return { ok: false, message: 'Smart account address is not ready yet.' };
        return { ok: true };
      }
      case 1: {
        if (!form.description.trim()) return { ok: false, message: 'Description is required.' };
        if (!String(form.agentUrl || '').trim()) return { ok: false, message: 'Agent URL is required.' };
        return { ok: true };
      }
      case 2:
      default:
        return { ok: true };
    }
  }, [createStep, form.agentName, form.agentAccount, form.description, form.agentUrl, ensOrgName, ensAvailable]);

  const openCompletionModal = useCallback((details: any) => {
    setRegistrationCompleteDetails(details);
    setRegistrationCompleteOpen(true);
  }, []);

  const handleRegister = useCallback(async () => {
    setError(null);
    setSuccess(null);

    if (privateKeyMode) {
      throw new Error('Smart Agent flow requires a connected wallet (private key mode is not supported).');
    }
    if (!walletAddress) {
      throw new Error('Connect a wallet to continue.');
    }
    if (!eip1193Provider) {
      throw new Error('Missing wallet provider (EIP-1193).');
    }
    if (!ensFullNamePreview || ensAvailable !== true || !ensOrgName) {
      throw new Error('ENS name must be available.');
    }
    if (!form.agentName.trim()) {
      throw new Error('Agent name is required.');
    }

    const bundlerUrl = getClientBundlerUrl(selectedChainId);
    if (!bundlerUrl) {
      throw new Error(`Missing bundler URL for chainId ${selectedChainId}.`);
    }

    setRegistering(true);
    try {
      await ensureEip1193Chain(eip1193Provider, selectedChainId);

      const eoa = getAddress(walletAddress) as Address;
      // Ensure deployed smart account exists (deploy via bundler if needed).
      const accountClient = await getDeployedAccountClientByAgentName(bundlerUrl, form.agentName.trim(), eoa, {
        ethereumProvider: eip1193Provider,
        chain,
      });
      const aaAddr = getAddress(String(accountClient?.address || '')) as Address;

      const agentLabel = form.agentName.trim();
      const baseUrl = String(form.agentUrl || '').trim();
      const agentDescription = String(form.description || '').trim();

      // ENS on-chain registration (same endpoints/shape as 8004 flow).
      if (isL1ChainId(selectedChainId)) {
        setSuccess(`Creating ENS subdomain for agent: ${agentLabel}`);
        await fetch('/api/names/add-to-l1-org', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agentAccount: aaAddr,
            orgName: ensOrgName,
            agentName: agentLabel,
            agentUrl: baseUrl,
            chainId: selectedChainId,
          }),
        });

        setSuccess('Preparing ENS metadata update...');
        const infoRes = await fetch('/api/names/set-l1-name-info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agentAddress: aaAddr,
            orgName: ensOrgName,
            agentName: agentLabel,
            agentUrl: baseUrl,
            agentDescription,
            chainId: selectedChainId,
          }),
        });
        const infoJson = (await infoRes.json().catch(() => null)) as any;
        const serverUserOpHash = typeof infoJson?.userOpHash === 'string' ? infoJson.userOpHash : null;
        if (!serverUserOpHash) {
          const infoCallsRaw = Array.isArray(infoJson?.calls) ? (infoJson.calls as any[]) : [];
          const calls = infoCallsRaw
            .map((c) => {
              const to = typeof c?.to === 'string' ? (c.to as `0x${string}`) : null;
              const data = typeof c?.data === 'string' ? (c.data as `0x${string}`) : null;
              if (!to || !data) return null;
              let value: bigint | undefined = undefined;
              if (c?.value !== null && c?.value !== undefined) {
                try {
                  value = BigInt(c.value);
                } catch {
                  value = undefined;
                }
              }
              return { to, data, value };
            })
            .filter(Boolean) as Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }>;
          if (calls.length > 0) {
            setSuccess('MetaMask signature: update ENS metadata (URL/description/image)');
            const uoHash = await sendSponsoredUserOperation({
              bundlerUrl,
              chain,
              accountClient,
              calls,
            });
            await waitForUserOperationReceipt({ bundlerUrl, chain, hash: uoHash });
          }
        }
      } else {
        // L2 ENS: prepare calls server-side and execute via AA.
        const cleanLabel = normalizeEnsAgentLabel({ agentName: form.agentName, orgName: ensOrgName });
        setSuccess('Preparing L2 ENS calls...');
        const addRes = await fetch('/api/names/add-to-l2-org', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agentAddress: aaAddr,
            orgName: ensOrgName,
            agentName: cleanLabel,
            agentUrl: baseUrl,
            agentDescription,
            agentImage: form.image || undefined,
            chainId: selectedChainId,
          }),
        });
        const addJson = (await addRes.json().catch(() => null)) as any;
        if (!addRes.ok) {
          const msg = addJson?.message || addJson?.error || 'Failed to add name to L2 org';
          throw new Error(msg);
        }
        const addCallsRaw = Array.isArray(addJson?.calls) ? (addJson.calls as any[]) : [];
        const addCalls = addCallsRaw
          .map((c) => {
            const to = typeof c?.to === 'string' ? (c.to as `0x${string}`) : null;
            const data = typeof c?.data === 'string' ? (c.data as `0x${string}`) : null;
            if (!to || !data) return null;
            let value: bigint | undefined = undefined;
            if (c?.value !== null && c?.value !== undefined) {
              try {
                value = BigInt(c.value);
              } catch {
                value = undefined;
              }
            }
            return { to, data, value };
          })
          .filter(Boolean) as Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }>;
        if (addCalls.length > 0) {
          const uoHash = await sendSponsoredUserOperation({
            bundlerUrl,
            chain,
            accountClient,
            calls: addCalls,
          });
          await waitForUserOperationReceipt({ bundlerUrl, chain, hash: uoHash });
        }

        const infoRes = await fetch('/api/names/set-l2-name-info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            agentAddress: aaAddr,
            orgName: ensOrgName,
            agentName: cleanLabel,
            agentUrl: baseUrl,
            agentDescription,
            chainId: selectedChainId,
          }),
        });
        const infoJson = (await infoRes.json().catch(() => null)) as any;
        const infoCallsRaw = Array.isArray(infoJson?.calls) ? (infoJson.calls as any[]) : [];
        const infoCalls = infoCallsRaw
          .map((c) => {
            const to = typeof c?.to === 'string' ? (c.to as `0x${string}`) : null;
            const data = typeof c?.data === 'string' ? (c.data as `0x${string}`) : null;
            if (!to || !data) return null;
            let value: bigint | undefined = undefined;
            if (c?.value !== null && c?.value !== undefined) {
              try {
                value = BigInt(c.value);
              } catch {
                value = undefined;
              }
            }
            return { to, data, value };
          })
          .filter(Boolean) as Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }>;
        if (infoCalls.length > 0) {
          const uoHash = await sendSponsoredUserOperation({
            bundlerUrl,
            chain,
            accountClient,
            calls: infoCalls,
          });
          await waitForUserOperationReceipt({ bundlerUrl, chain, hash: uoHash });
        }
      }

      // UAID preview (did:ethr anchor) for convenience.
      const uaid = await (async () => {
        try {
          const res = await fetch('/api/agents/generate-uaid', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              agentAccount: aaAddr,
              chainId: selectedChainId,
              uid: `did:ethr:${selectedChainId}:${aaAddr.toLowerCase()}`,
              registry: 'smart-agent',
              proto: 'a2a',
              nativeId: `eip155:${selectedChainId}:${aaAddr}`,
            }),
          });
          const json = (await res.json().catch(() => null)) as any;
          const v = typeof json?.uaid === 'string' ? json.uaid.trim() : '';
          return v || null;
        } catch {
          return null;
        }
      })();

      setSuccess(`Smart Agent created: ${ensFullNamePreview}`);
      openCompletionModal({
        smartAccount: aaAddr,
        ensName: ensFullNamePreview,
        uaid: uaid ?? undefined,
      });

      // Best-effort: trigger knowledge base sync after agent creation.
      try {
        const kbChainId =
          selectedChainId === 1 || selectedChainId === 59144 ? String(selectedChainId) : 'all';
        void fetch(`/api/sync/agent-pipeline?chainId=${encodeURIComponent(kbChainId)}`, { method: 'POST' });
      } catch {
        // ignore
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setRegistering(false);
    }
  }, [
    privateKeyMode,
    walletAddress,
    eip1193Provider,
    selectedChainId,
    chain,
    form.agentName,
    form.agentUrl,
    form.description,
    form.image,
    ensFullNamePreview,
    ensAvailable,
    ensOrgName,
    openCompletionModal,
  ]);

  const renderStep = () => {
    const gridCols = isMobile ? '1fr' : '220px 1fr';
    const labelStyle: React.CSSProperties = {
      color: palette.textSecondary,
      paddingTop: isMobile ? 0 : '0.55rem',
      fontWeight: 700,
    };
    const fieldStyle: React.CSSProperties = {
      width: '100%',
      minWidth: 0,
      boxSizing: 'border-box',
      padding: '0.55rem 0.7rem',
      borderRadius: '10px',
      border: `1px solid ${palette.border}`,
      background: palette.surfaceMuted,
      color: palette.textPrimary,
    };

    switch (createStep) {
      case 0: {
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: isMobile ? '0.55rem' : '0.75rem' }}>
              <label style={labelStyle}>Chain</label>
              <select
                value={String(selectedChainId)}
                onChange={(e) => {
                  setSelectedChainId(Number(e.target.value));
                  setEnsAvailable(null);
                  setAaAddress(null);
                }}
                style={fieldStyle}
              >
                {SUPPORTED_CHAINS.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.label} ({c.id})
                  </option>
                ))}
              </select>

              <label style={labelStyle}>Agent name *</label>
              <input
                value={form.agentName}
                onChange={(e) => setForm((prev) => ({ ...prev, agentName: e.target.value }))}
                style={fieldStyle}
              />

              {!isMobile ? <div /> : null}
              <div
                style={{
                  gridColumn: isMobile ? '1 / -1' : '2',
                  color: palette.textSecondary,
                  fontSize: '0.92rem',
                  lineHeight: 1.45,
                  minWidth: 0,
                }}
              >
                <div style={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                  {ensFullNamePreview || 'Enter an agent name…'}
                </div>
                <div style={{ marginTop: '0.25rem' }}>
                  {ensChecking
                    ? 'Checking ENS…'
                    : ensAvailable === true
                      ? 'Available'
                      : ensAvailable === false
                        ? 'Not available'
                        : 'Awaiting input'}
                </div>
                {ensExisting && (
                  <div style={{ marginTop: '0.5rem' }}>
                    {ensExisting.image && (
                      <img
                        src={ensExisting.image}
                        alt="ENS avatar"
                        style={{ height: '40px', width: 'auto', borderRadius: '6px' }}
                      />
                    )}
                  </div>
                )}
              </div>

              <label style={labelStyle}>Smart account</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <code style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                  {form.agentAccount || (aaComputing ? 'Computing…' : '—')}
                </code>
              </div>
            </div>
          </>
        );
      }
      case 1: {
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: isMobile ? '0.55rem' : '0.75rem' }}>
              <label style={labelStyle}>Description *</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={5}
                style={fieldStyle}
              />

              <label style={labelStyle}>Image URL</label>
              <input
                value={form.image}
                onChange={(e) => setForm((prev) => ({ ...prev, image: e.target.value }))}
                style={fieldStyle}
              />

              <label style={labelStyle}>Agent URL *</label>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                <input
                  value={form.agentUrl}
                  onChange={(e) => {
                    setAgentUrlAutofillDisabled(true);
                    setForm((prev) => ({ ...prev, agentUrl: e.target.value }));
                  }}
                  placeholder="https://your-agent.com"
                  style={{ ...fieldStyle, flex: '1 1 260px' }}
                />
                <button
                  type="button"
                  onClick={handleResetAgentUrlToDefault}
                  style={{
                    padding: '0.55rem 0.75rem',
                    borderRadius: '10px',
                    border: `1px solid ${palette.borderStrong}`,
                    background: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontWeight: 800,
                    cursor: 'pointer',
                    flex: '0 0 auto',
                  }}
                  title="Reset to the default URL derived from the agent name"
                >
                  Reset
                </button>
              </div>
            </div>
          </>
        );
      }
      case 2:
      default: {
        return (
          <>
            <div style={{ color: palette.textSecondary, lineHeight: 1.5 }}>
              <div>
                Chain: <b>{chainLabel}</b>
              </div>
              <div>
                Agent name: <b>{form.agentName || '—'}</b>
              </div>
              <div>
                ENS: <code style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{ensFullNamePreview || '—'}</code>
              </div>
              <div>
                Smart account:{' '}
                <code style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{form.agentAccount || '—'}</code>
              </div>
              <div>
                Agent URL: <code style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{form.agentUrl || '—'}</code>
              </div>
            </div>
          </>
        );
      }
    }
  };

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

      <main style={{ padding: isMobile ? '1rem' : '2rem', maxWidth: '1400px', margin: '0 auto' }}>
        {!canSign && (
          <div
            style={{
              border: `1px solid ${palette.border}`,
              borderRadius: '10px',
              padding: '1rem',
              marginBottom: '1rem',
              background: palette.surfaceMuted,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: '0.35rem' }}>Wallet required</div>
            <div style={{ color: palette.textSecondary, lineHeight: 1.45 }}>
              This flow requires an EIP-1193 wallet connection. Private key mode is not supported.
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              border: `1px solid ${palette.borderStrong}`,
              borderRadius: '10px',
              padding: '0.85rem 1rem',
              marginBottom: '1rem',
              background: palette.surfaceMuted,
              color: palette.textPrimary,
            }}
          >
            <div style={{ fontWeight: 800, color: palette.dangerText, marginBottom: '0.25rem' }}>Error</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{error}</div>
          </div>
        )}

        {success && (
          <div
            style={{
              border: `1px solid ${palette.borderStrong}`,
              borderRadius: '10px',
              padding: '0.85rem 1rem',
              marginBottom: '1rem',
              background: palette.surfaceMuted,
              color: palette.textPrimary,
            }}
          >
            <div style={{ fontWeight: 800, color: palette.successText, marginBottom: '0.25rem' }}>Success</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{success}</div>
          </div>
        )}

        <section
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: '8px',
            padding: isMobile ? '1rem' : '1.5rem',
            background: palette.surface,
          }}
        >
          <h2 style={{ margin: '0 0 1rem', fontSize: '1.5rem' }}>Agent Registration</h2>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            {CREATE_STEPS.map((label, idx) => {
              const active = idx === createStep;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setCreateStep(idx)}
                  disabled={idx > createStep}
                  style={{
                    padding: '0.4rem 0.75rem',
                    borderRadius: '999px',
                    border: `1px solid ${palette.borderStrong}`,
                    background: active ? palette.accent : palette.surfaceMuted,
                    color: active ? palette.surface : palette.textPrimary,
                    fontWeight: 700,
                    cursor: idx > createStep ? 'not-allowed' : 'pointer',
                    fontSize: '0.9rem',
                    opacity: idx > createStep ? 0.6 : 1,
                  }}
                >
                  {idx + 1}. {label}
                </button>
              );
            })}
          </div>

          {renderStep()}

          <div
            style={{
              marginTop: '1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => setCreateStep((s) => Math.max(0, s - 1))}
              disabled={createStep === 0 || registering}
              style={{
                padding: '0.55rem 0.85rem',
                borderRadius: '10px',
                border: `1px solid ${palette.borderStrong}`,
                background: palette.surfaceMuted,
                color: palette.textPrimary,
                fontWeight: 800,
                cursor: createStep === 0 || registering ? 'not-allowed' : 'pointer',
                opacity: createStep === 0 || registering ? 0.6 : 1,
              }}
            >
              Back
            </button>

            {createStep < CREATE_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (!canProceed.ok) {
                    setError(canProceed.message || 'Please complete required fields.');
                    return;
                  }
                  setError(null);
                  setCreateStep((s) => Math.min(CREATE_STEPS.length - 1, s + 1));
                }}
                disabled={!canProceed.ok || registering}
                style={{
                  padding: '0.55rem 0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.borderStrong}`,
                  background: palette.accent,
                  color: palette.surface,
                  fontWeight: 800,
                  cursor: !canProceed.ok || registering ? 'not-allowed' : 'pointer',
                  opacity: !canProceed.ok || registering ? 0.6 : 1,
                }}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  handleRegister().catch(() => null);
                }}
                disabled={!canProceed.ok || !canSign || registering}
                style={{
                  padding: '0.55rem 0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.borderStrong}`,
                  background: palette.accent,
                  color: palette.surface,
                  fontWeight: 800,
                  cursor: !canProceed.ok || !canSign || registering ? 'not-allowed' : 'pointer',
                  opacity: !canProceed.ok || !canSign || registering ? 0.6 : 1,
                }}
              >
                {registering ? 'Registering…' : 'Register'}
              </button>
            )}
          </div>
        </section>

        {registrationCompleteOpen && registrationCompleteDetails && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1.25rem',
              zIndex: 50,
            }}
            onClick={() => setRegistrationCompleteOpen(false)}
          >
            <div
              style={{
                background: palette.surface,
                borderRadius: '16px',
                border: `1px solid ${palette.border}`,
                maxWidth: '640px',
                width: '100%',
                padding: '1.25rem',
                boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>Registration complete</div>
              <div style={{ marginTop: '0.75rem', color: palette.textSecondary, lineHeight: 1.5 }}>
                {registrationCompleteDetails.smartAccount && (
                  <div>
                    Smart account: <code>{registrationCompleteDetails.smartAccount}</code>
                  </div>
                )}
                {registrationCompleteDetails.ensName && (
                  <div>
                    ENS: <code>{registrationCompleteDetails.ensName}</code>
                  </div>
                )}
                {registrationCompleteDetails.uaid && (
                  <div>
                    UAID: <code>{registrationCompleteDetails.uaid}</code>
                  </div>
                )}
              </div>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setRegistrationCompleteOpen(false)}
                  style={{
                    padding: '0.55rem 0.85rem',
                    borderRadius: '10px',
                    border: `1px solid ${palette.borderStrong}`,
                    background: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/agents')}
                  style={{
                    padding: '0.55rem 0.85rem',
                    borderRadius: '10px',
                    border: `1px solid ${palette.borderStrong}`,
                    background: palette.accent,
                    color: palette.surface,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Back to agents
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

