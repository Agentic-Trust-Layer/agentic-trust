'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Address } from 'viem';
import { getAddress } from 'viem';

import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { grayscalePalette as palette } from '@/styles/palette';
import { SUPPORTED_TRUST_MECHANISMS } from '@/models/agentRegistration';

import { signAndSendTransaction } from '@agentic-trust/core/client';
import type { PreparedTransaction } from '@agentic-trust/core/client';
import {
  DEFAULT_CHAIN_ID,
  getChainById,
  getChainDisplayMetadata,
  getChainIdHex as getChainIdHexUtil,
  getSupportedChainIds,
} from '@agentic-trust/core/server';

const CREATE_STEPS = ['Name', 'Information', 'Review & Register'] as const;

const formatAgentSubdomain = (name?: string): string => {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

const buildDefaultAgentUrl = (name?: string): string => {
  const slug = formatAgentSubdomain(name);
  return slug ? `https://${slug}.8004-agent.io` : '';
};

async function ensureEip1193Chain(provider: any, chainId: number) {
  if (!provider?.request) {
    throw new Error('Missing wallet provider (EIP-1193). Connect a wallet to continue.');
  }

  const currentHex = await provider.request({ method: 'eth_chainId' });
  const currentId = typeof currentHex === 'string' ? parseInt(currentHex, 16) : Number.NaN;
  if (Number.isFinite(currentId) && currentId === chainId) return;

  const chain = getChainById(chainId);
  const chainIdHex = getChainIdHexUtil(chainId);

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (e: any) {
    const code = e?.code;
    if (code !== 4902) throw e;
    // Chain not added to wallet yet.
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chainIdHex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls?.default?.http ?? [],
          blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : [],
        },
      ],
    });
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  }
}

export default function AgentRegistration8004EoaPage() {
  const router = useRouter();
  const { isConnected, privateKeyMode, loading, walletAddress, openLoginModal, handleDisconnect } = useAuth();
  const { eip1193Provider } = useWallet();

  const [createStep, setCreateStep] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const supportedChainIds = useMemo(() => {
    try {
      return getSupportedChainIds();
    } catch {
      return [DEFAULT_CHAIN_ID];
    }
  }, []);

  const [selectedChainId, setSelectedChainId] = useState<number>(DEFAULT_CHAIN_ID);
  const chainLabel = useMemo(() => {
    const meta = getChainDisplayMetadata(selectedChainId);
    return meta?.displayName || meta?.chainName || `Chain ${selectedChainId}`;
  }, [selectedChainId]);

  const eoaAddress: Address | null = useMemo(() => {
    try {
      return walletAddress ? (getAddress(walletAddress) as Address) : null;
    } catch {
      return null;
    }
  }, [walletAddress]);

  const canSign = Boolean(isConnected && eoaAddress && eip1193Provider && !privateKeyMode);

  const getDefaultImageUrl = () =>
    typeof window !== 'undefined' ? `${window.location.origin}/8004Agent.png` : '/8004Agent.png';

  const [form, setForm] = useState(() => ({
    agentName: '',
    description: '',
    image: getDefaultImageUrl(),
    agentUrl: '',
  }));

  const [supportedTrust, setSupportedTrust] = useState<string[]>([]);
  const [protocol, setProtocol] = useState<'A2A' | 'MCP' | null>('A2A');
  const [a2aEndpoint, setA2aEndpoint] = useState('');
  const [mcpEndpoint, setMcpEndpoint] = useState('');

  // image upload
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);

  // completion modal
  const [registrationCompleteOpen, setRegistrationCompleteOpen] = useState(false);
  const [registrationCompleteDetails, setRegistrationCompleteDetails] = useState<{
    agentId?: string;
    txHash?: string;
    uaid?: string;
    did8004?: string;
  } | null>(null);

  // autofill agent URL like 8004
  useEffect(() => {
    const defaultUrl = buildDefaultAgentUrl(form.agentName);
    setForm((prev) => {
      const current = (prev.agentUrl || '').trim();
      if (current) return prev;
      if (!defaultUrl) return prev;
      return { ...prev, agentUrl: defaultUrl };
    });
  }, [form.agentName]);

  // default endpoints derived from agentUrl
  useEffect(() => {
    const base = (form.agentUrl || '').trim().replace(/\/$/, '');
    if (!base) return;
    if (protocol === 'A2A') {
      setA2aEndpoint((prev) => (prev.trim() ? prev : `${base}/.well-known/agent-card.json`));
    }
    if (protocol === 'MCP') {
      setMcpEndpoint((prev) => (prev.trim() ? prev : `${base}/api/mcp`));
    }
  }, [form.agentUrl, protocol]);

  const handleImageUploadClick = useCallback(() => {
    setImageUploadError(null);
    imageFileInputRef.current?.click();
  }, []);

  const handleImageFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setImageUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch('/api/ipfs/upload', { method: 'POST', body: formData });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || body?.message || 'Upload failed');
      }
      setForm((prev) => ({ ...prev, image: body?.tokenUri || body?.url || prev.image }));
    } catch (uploadError) {
      setImageUploadError(uploadError instanceof Error ? uploadError.message : 'Image upload failed');
    } finally {
      setUploadingImage(false);
      if (event.target) event.target.value = '';
    }
  }, []);

  const normalizedBaseUrl = (form.agentUrl || '').trim().replace(/\/$/, '');

  const endpoints = useMemo(() => {
    const out: Array<{ name: string; endpoint: string; version?: string }> = [];
    if (protocol === 'A2A' && a2aEndpoint.trim()) {
      out.push({ name: 'A2A', endpoint: a2aEndpoint.trim(), version: '0.3.0' });
    }
    if (protocol === 'MCP' && mcpEndpoint.trim()) {
      out.push({ name: 'MCP', endpoint: mcpEndpoint.trim(), version: '2025-06-18' });
    }
    return out;
  }, [protocol, a2aEndpoint, mcpEndpoint]);

  const validateStep = useCallback((): string | null => {
    if (createStep === 0) {
      if (!selectedChainId || !Number.isFinite(selectedChainId)) return 'Select a chain.';
      if (!form.agentName.trim()) return 'Agent name is required.';
      if (!canSign) return 'Connect a wallet to continue.';
    }
    if (createStep === 1) {
      // no required fields
    }
    if (createStep === 2) {
      if (!canSign) return 'Connect a wallet to register.';
    }
    return null;
  }, [createStep, selectedChainId, form.agentName, canSign]);

  const handleNext = useCallback(() => {
    const err = validateStep();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setCreateStep((s) => Math.min(CREATE_STEPS.length - 1, s + 1));
  }, [validateStep]);

  const handleBack = useCallback(() => {
    setError(null);
    setCreateStep((s) => Math.max(0, s - 1));
  }, []);

  const handleRegister = useCallback(async () => {
    if (registering) return;
    try {
      setRegistering(true);
      setError(null);
      setSuccess(null);
      const stepErr = validateStep();
      if (stepErr) throw new Error(stepErr);
      if (!eoaAddress) throw new Error('Missing connected wallet address.');
      if (!eip1193Provider) throw new Error('Missing wallet provider.');

      await ensureEip1193Chain(eip1193Provider, selectedChainId);

      setSuccess('Preparing ERC-8004 registration transaction…');
      const planRes = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'eoa',
          agentName: form.agentName.trim(),
          // EOA-only flow: agent account is the connected EOA address.
          agentAccount: eoaAddress,
          supportedTrust: supportedTrust.length > 0 ? supportedTrust : undefined,
          description: form.description.trim() ? form.description.trim() : undefined,
          image: form.image.trim() ? form.image.trim() : undefined,
          agentUrl: normalizedBaseUrl || undefined,
          endpoints: endpoints.length > 0 ? endpoints : undefined,
          chainId: selectedChainId,
        }),
      });
      const planBody = await planRes.json().catch(() => ({} as any));
      if (!planRes.ok) {
        throw new Error(planBody?.error || planBody?.message || `Failed to prepare registration (${planRes.status})`);
      }

      if (planBody?.mode !== 'eoa' || !planBody?.transaction?.to || !planBody?.transaction?.data) {
        throw new Error('Server response missing EOA transaction details');
      }

      const txChainId = Number(planBody.transaction.chainId ?? planBody.chainId);
      if (!Number.isFinite(txChainId) || txChainId <= 0) {
        throw new Error('Server response missing valid chainId for transaction');
      }

      const preparedTx: PreparedTransaction = {
        to: planBody.transaction.to as `0x${string}`,
        data: planBody.transaction.data as `0x${string}`,
        value: (planBody.transaction.value ?? '0x0') as `0x${string}`,
        gas: planBody.transaction.gas as `0x${string}` | undefined,
        gasPrice: planBody.transaction.gasPrice as `0x${string}` | undefined,
        maxFeePerGas: planBody.transaction.maxFeePerGas as `0x${string}` | undefined,
        maxPriorityFeePerGas: planBody.transaction.maxPriorityFeePerGas as `0x${string}` | undefined,
        nonce: planBody.transaction.nonce as number | undefined,
        chainId: txChainId,
      };

      setSuccess('MetaMask signature: register agent identity (ERC-8004)…');
      const chain = getChainById(txChainId);
      const txResult = await signAndSendTransaction({
        transaction: preparedTx,
        account: eoaAddress,
        chain,
        ethereumProvider: eip1193Provider as any,
        onStatusUpdate: setSuccess,
        extractAgentId: true,
      });

      const agentId = txResult.agentId ? String(txResult.agentId) : undefined;
      const did8004 = agentId ? `did:8004:${selectedChainId}:${agentId}` : undefined;
      const uaid = agentId ? `uaid:${did8004}` : undefined;

      setRegistrationCompleteDetails({
        agentId,
        txHash: txResult.hash,
        did8004,
        uaid,
      });
      setRegistrationCompleteOpen(true);
      setSuccess(agentId ? `Registered agent ${agentId}` : `Transaction confirmed: ${txResult.hash}`);
    } catch (e: any) {
      setError(e?.message || 'Registration failed');
    } finally {
      setRegistering(false);
    }
  }, [
    eip1193Provider,
    eoaAddress,
    endpoints,
    form.agentName,
    form.description,
    form.image,
    normalizedBaseUrl,
    selectedChainId,
    supportedTrust,
    validateStep,
    registering,
  ]);

  const renderStep = () => {
    if (createStep === 0) {
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Chain</label>
              <select
                value={selectedChainId}
                onChange={(e) => setSelectedChainId(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  border: `1px solid ${palette.border}`,
                  borderRadius: '10px',
                  backgroundColor: palette.surface,
                }}
              >
                {supportedChainIds.map((id) => {
                  const meta = getChainDisplayMetadata(id);
                  const label = meta?.displayName || meta?.chainName || `Chain ${id}`;
                  return (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Agent Account</label>
              <div
                style={{
                  padding: '0.55rem 0.75rem',
                  border: `1px solid ${palette.border}`,
                  borderRadius: '10px',
                  backgroundColor: palette.surfaceMuted,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                }}
              >
                {eoaAddress ?? 'Connect wallet'}
              </div>
              <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: palette.textSecondary }}>
                EOA-only: no smart account, no ENS.
              </div>
            </div>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Agent Name *</label>
            <input
              value={form.agentName}
              onChange={(e) => setForm((p) => ({ ...p, agentName: e.target.value }))}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                backgroundColor: palette.surface,
              }}
            />
          </div>
        </>
      );
    }

    if (createStep === 1) {
      return (
        <>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={4}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                backgroundColor: palette.surface,
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Image</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                value={form.image}
                onChange={(e) => setForm((p) => ({ ...p, image: e.target.value }))}
                style={{
                  flex: 1,
                  padding: '0.55rem 0.75rem',
                  border: `1px solid ${palette.border}`,
                  borderRadius: '10px',
                  backgroundColor: palette.surface,
                }}
              />
              <button
                type="button"
                onClick={handleImageUploadClick}
                disabled={uploadingImage}
                style={{
                  padding: '0.55rem 0.9rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  color: palette.textPrimary,
                  fontWeight: 700,
                  cursor: uploadingImage ? 'not-allowed' : 'pointer',
                  opacity: uploadingImage ? 0.7 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {uploadingImage ? 'Uploading…' : 'Upload'}
              </button>
              <input
                ref={imageFileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleImageFileSelected}
              />
            </div>
            {imageUploadError && (
              <div style={{ marginTop: '0.5rem', color: '#b91c1c', fontSize: '0.9rem' }}>
                {imageUploadError}
              </div>
            )}
          </div>

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Agent URL</label>
            <input
              value={form.agentUrl}
              onChange={(e) => setForm((p) => ({ ...p, agentUrl: e.target.value }))}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                backgroundColor: palette.surface,
              }}
            />
          </div>

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Protocols</label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setProtocol('A2A')}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: '999px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: protocol === 'A2A' ? palette.accent : palette.surfaceMuted,
                  color: protocol === 'A2A' ? palette.surface : palette.textPrimary,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                A2A
              </button>
              <button
                type="button"
                onClick={() => setProtocol('MCP')}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: '999px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: protocol === 'MCP' ? palette.accent : palette.surfaceMuted,
                  color: protocol === 'MCP' ? palette.surface : palette.textPrimary,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                MCP
              </button>
              <button
                type="button"
                onClick={() => setProtocol(null)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: '999px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: protocol === null ? palette.accent : palette.surfaceMuted,
                  color: protocol === null ? palette.surface : palette.textPrimary,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                None
              </button>
            </div>

            {protocol === 'A2A' && (
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>A2A Endpoint</label>
                <input
                  value={a2aEndpoint}
                  onChange={(e) => setA2aEndpoint(e.target.value)}
                  placeholder={normalizedBaseUrl ? `${normalizedBaseUrl}/.well-known/agent-card.json` : ''}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    border: `1px solid ${palette.border}`,
                    borderRadius: '10px',
                    backgroundColor: palette.surface,
                  }}
                />
              </div>
            )}

            {protocol === 'MCP' && (
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>MCP Endpoint</label>
                <input
                  value={mcpEndpoint}
                  onChange={(e) => setMcpEndpoint(e.target.value)}
                  placeholder={normalizedBaseUrl ? `${normalizedBaseUrl}/api/mcp` : ''}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    border: `1px solid ${palette.border}`,
                    borderRadius: '10px',
                    backgroundColor: palette.surface,
                  }}
                />
              </div>
            )}
          </div>

          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Supported trust</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {SUPPORTED_TRUST_MECHANISMS.map((m) => {
                const checked = supportedTrust.includes(m.value);
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => {
                      setSupportedTrust((prev) =>
                        checked ? prev.filter((x) => x !== m.value) : [...prev, m.value],
                      );
                    }}
                    style={{
                      padding: '0.4rem 0.7rem',
                      borderRadius: '999px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: checked ? palette.accent : palette.surfaceMuted,
                      color: checked ? palette.surface : palette.textPrimary,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    title={m.description}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      );
    }

    // Review
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '0.75rem' }}>
          <div style={{ color: palette.textSecondary, fontWeight: 700 }}>Chain</div>
          <div style={{ color: palette.textPrimary }}>{chainLabel}</div>

          <div style={{ color: palette.textSecondary, fontWeight: 700 }}>Agent name</div>
          <div style={{ color: palette.textPrimary }}>{form.agentName.trim() || '—'}</div>

          <div style={{ color: palette.textSecondary, fontWeight: 700 }}>Agent account (EOA)</div>
          <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{eoaAddress ?? '—'}</div>

          <div style={{ color: palette.textSecondary, fontWeight: 700 }}>ENS</div>
          <div style={{ color: palette.textPrimary }}>Not used</div>

          <div style={{ color: palette.textSecondary, fontWeight: 700 }}>Smart account</div>
          <div style={{ color: palette.textPrimary }}>Not used</div>
        </div>

        <div style={{ marginTop: '0.5rem', color: palette.textSecondary, fontSize: '0.95rem' }}>
          This registers an ERC-8004 identity owned by your connected wallet.
        </div>

        <button
          type="button"
          onClick={handleRegister}
                  disabled={!canSign || registering}
          style={{
            marginTop: '0.75rem',
            width: '100%',
            padding: '0.9rem 1rem',
            borderRadius: '12px',
            border: 'none',
                    backgroundColor: canSign && !registering ? palette.accent : palette.borderStrong,
            color: palette.surface,
            fontWeight: 800,
                    cursor: canSign && !registering ? 'pointer' : 'not-allowed',
                    opacity: registering ? 0.75 : 1,
          }}
        >
                  {registering ? 'Registering…' : 'Register ERC-8004 Identity (EOA)'}
        </button>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: palette.background }}>
      <Header
        displayAddress={walletAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={loading || registering}
      />
      <main style={{ padding: '2rem 1rem' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <section
            style={{
              backgroundColor: palette.surface,
              borderRadius: '16px',
              padding: '1.5rem',
              border: `1px solid ${palette.border}`,
              boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
            }}
          >
            <h2 style={{ margin: 0, marginBottom: '1.25rem', color: palette.textPrimary }}>Agent Registration</h2>

            {!canSign && (
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  borderRadius: '12px',
                  padding: '1rem',
                  marginBottom: '1rem',
                }}
              >
                <div style={{ fontWeight: 800, color: palette.textPrimary }}>Connect a wallet</div>
                <div style={{ marginTop: '0.25rem', color: palette.textSecondary }}>
                  This flow registers an ERC-8004 identity directly from your EOA.
                </div>
                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {!isConnected ? (
                    <button
                      type="button"
                      onClick={openLoginModal}
                      disabled={loading}
                      style={{
                        padding: '0.55rem 0.9rem',
                        borderRadius: '999px',
                        border: `1px solid ${palette.borderStrong}`,
                        backgroundColor: palette.accent,
                        color: palette.surface,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Connect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      style={{
                        padding: '0.55rem 0.9rem',
                        borderRadius: '999px',
                        border: `1px solid ${palette.borderStrong}`,
                        backgroundColor: palette.surfaceMuted,
                        color: palette.textPrimary,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Disconnect
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => router.push('/agent-registration/8004')}
                    style={{
                      padding: '0.55rem 0.9rem',
                      borderRadius: '999px',
                      border: `1px solid ${palette.borderStrong}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Use Smart Agent flow
                  </button>
                </div>
                {privateKeyMode && (
                  <div style={{ marginTop: '0.5rem', color: palette.textSecondary, fontSize: '0.9rem' }}>
                    Private-key/server-admin mode is not supported for this simplified EOA flow.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: '1.25rem' }}>
              {/* Steps */}
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: '14px',
                  backgroundColor: palette.surfaceMuted,
                  padding: '0.75rem',
                  height: 'fit-content',
                }}
              >
                {CREATE_STEPS.map((label, idx) => {
                  const active = idx === createStep;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setCreateStep(idx)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.7rem 0.8rem',
                        marginBottom: '0.5rem',
                        borderRadius: '12px',
                        border: `1px solid ${active ? palette.accent : palette.border}`,
                        backgroundColor: active ? palette.surface : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 800, color: palette.textPrimary }}>
                        {idx + 1}. {label}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Content */}
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: '14px',
                  padding: '1.25rem',
                  backgroundColor: palette.surface,
                }}
              >
                {error && (
                  <div
                    style={{
                      border: '1px solid #fecaca',
                      backgroundColor: '#fff1f2',
                      color: '#991b1b',
                      padding: '0.75rem',
                      borderRadius: '12px',
                      marginBottom: '1rem',
                      fontWeight: 700,
                    }}
                  >
                    {error}
                  </div>
                )}
                {success && (
                  <div
                    style={{
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      padding: '0.75rem',
                      borderRadius: '12px',
                      marginBottom: '1rem',
                      fontWeight: 700,
                    }}
                  >
                    {success}
                  </div>
                )}

                {renderStep()}

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
                  <button
                    type="button"
                    onClick={handleBack}
                    disabled={createStep === 0 || registering}
                    style={{
                      padding: '0.65rem 0.9rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
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
                      onClick={handleNext}
                      disabled={registering}
                      style={{
                        padding: '0.65rem 0.9rem',
                        borderRadius: '10px',
                        border: `1px solid ${palette.borderStrong}`,
                        backgroundColor: palette.accent,
                        color: palette.surface,
                        fontWeight: 800,
                        cursor: registering ? 'not-allowed' : 'pointer',
                        opacity: registering ? 0.7 : 1,
                      }}
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRegister}
                      disabled={!canSign || registering}
                      style={{
                        padding: '0.65rem 0.9rem',
                        borderRadius: '10px',
                        border: `1px solid ${palette.borderStrong}`,
                        backgroundColor: canSign && !registering ? palette.accent : palette.borderStrong,
                        color: palette.surface,
                        fontWeight: 800,
                        cursor: canSign && !registering ? 'pointer' : 'not-allowed',
                        opacity: canSign && !registering ? 1 : 0.7,
                      }}
                    >
                      {registering ? 'Registering…' : 'Register'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {registrationCompleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(2,6,23,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            zIndex: 60,
          }}
          onClick={() => setRegistrationCompleteOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '640px',
              borderRadius: '16px',
              padding: '1.25rem',
              backgroundColor: palette.surface,
              border: `1px solid ${palette.border}`,
              boxShadow: '0 18px 60px rgba(15,23,42,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <div style={{ fontWeight: 900, fontSize: '1.1rem', color: palette.textPrimary }}>
                Registration complete
              </div>
              <button
                type="button"
                onClick={() => setRegistrationCompleteOpen(false)}
                style={{
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  borderRadius: '999px',
                  padding: '0.35rem 0.6rem',
                  cursor: 'pointer',
                  fontWeight: 900,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '0.6rem' }}>
                <div style={{ color: palette.textSecondary, fontWeight: 800 }}>Agent ID</div>
                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {registrationCompleteDetails?.agentId ?? '—'}
                </div>
                <div style={{ color: palette.textSecondary, fontWeight: 800 }}>DID</div>
                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {registrationCompleteDetails?.did8004 ?? '—'}
                </div>
                <div style={{ color: palette.textSecondary, fontWeight: 800 }}>UAID</div>
                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {registrationCompleteDetails?.uaid ?? '—'}
                </div>
                <div style={{ color: palette.textSecondary, fontWeight: 800 }}>Transaction</div>
                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {registrationCompleteDetails?.txHash ?? '—'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

