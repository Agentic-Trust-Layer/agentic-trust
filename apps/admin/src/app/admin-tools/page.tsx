'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallet } from '@/components/WalletProvider';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import type { Address, Chain } from 'viem';
import { buildDid8004, generateSessionPackage, getDeployedAccountClientByAgentName, updateAgentRegistrationWithWallet, requestValidationWithWallet } from '@agentic-trust/core';
import type { DiscoverParams as AgentSearchParams, DiscoverResponse } from '@agentic-trust/core/server';
import {
  getSupportedChainIds,
  getChainDisplayMetadata,
  getChainById,
  DEFAULT_CHAIN_ID,
  getChainBundlerUrl,
} from '@agentic-trust/core/server';
type Agent = DiscoverResponse['agents'][number];

const CHAIN_SUFFIX_MAP: Record<number, string> = {
  11155111: 'SEPOLIA',
  84532: 'BASE_SEPOLIA',
  11155420: 'OPTIMISM_SEPOLIA',
};

const getEnvVarHints = (chainId: number) => {
  const suffix = CHAIN_SUFFIX_MAP[chainId];
  if (!suffix) return null;
  return {
    rpcClient: `NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_${suffix}`,
    rpcServer: `AGENTIC_TRUST_RPC_URL_${suffix}`,
    bundlerClient: `NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_${suffix}`,
    bundlerServer: `AGENTIC_TRUST_BUNDLER_URL_${suffix}`,
  };
};

export default function AdminPage() {

  // Get consolidated wallet state from useWallet hook
  // This includes: connected, address, eip1193Provider, privateKeyMode
  const { 
    connected: eoaConnected, 
    address: eoaAddress, 
    eip1193Provider,
    privateKeyMode,
    loading,
  } = useWallet();
  const {
    isConnected: authConnected,
    privateKeyMode: authPrivateKeyMode,
    loading: authLoading,
    openLoginModal,
    handleDisconnect: authHandleDisconnect,
  } = useAuth();

  const router = useRouter();
  const searchParams = useSearchParams();
  const queryAgentId = searchParams?.get('agentId') ?? null;
  const queryChainId = searchParams?.get('chainId') ?? null;
  const queryAgentAddress = searchParams?.get('agentAccount') ?? null;
  const isEditMode = queryAgentId !== null && queryChainId !== null;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Get admin EOA for private key mode display
  const [adminEOA, setAdminEOA] = useState<string | null>(null);
  useEffect(() => {
    if (privateKeyMode) {
      (async () => {
        try {
          const res = await fetch('/api/admin/address', { method: 'GET' });
          if (res.ok) {
            const data = await res.json();
            if (data?.address && typeof data.address === 'string') {
              setAdminEOA(data.address);
            }
          }
        } catch {
          // ignore
        }
      })();
    }
  }, [privateKeyMode]);

  const supportedChainIds = React.useMemo(() => getSupportedChainIds(), []);

  const CHAIN_METADATA = React.useMemo((): Record<number, ReturnType<typeof getChainDisplayMetadata>> => {
    const entries: Record<number, ReturnType<typeof getChainDisplayMetadata>> = {};
    supportedChainIds.forEach(chainId => {
      try {
        entries[chainId] = getChainDisplayMetadata(chainId);
      } catch (error) {
        console.warn('[chain] Unable to load metadata for chain', chainId, error);
      }
    });
    return entries;
  }, [supportedChainIds]);

  function formatJsonIfPossible(text: string): string {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  }

  async function loadRegistrationContent(uri: string): Promise<string> {
    const trimmed = uri?.trim();
    if (!trimmed) {
      throw new Error('Registration URI is empty.');
    }

    if (trimmed.startsWith('data:')) {
      const commaIndex = trimmed.indexOf(',');
      if (commaIndex === -1) {
        throw new Error('Malformed data URI.');
      }
      const header = trimmed.slice(0, commaIndex);
      const payload = trimmed.slice(commaIndex + 1);
      const isBase64 = /;base64/i.test(header);

      if (isBase64) {
        try {
          const decoded =
            typeof window !== 'undefined' && typeof window.atob === 'function'
              ? window.atob(payload)
              : payload;
          return formatJsonIfPossible(decoded);
        } catch (error) {
          throw new Error('Unable to decode base64 data URI.');
        }
      }
      try {
        const decoded = decodeURIComponent(payload);
        return formatJsonIfPossible(decoded);
      } catch {
        return formatJsonIfPossible(payload);
      }
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return formatJsonIfPossible(trimmed);
    }

    let resolvedUrl = trimmed;
    if (trimmed.startsWith('ipfs://')) {
      const path = trimmed.slice('ipfs://'.length);
      resolvedUrl = `https://ipfs.io/ipfs/${path}`;
    }

    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch registration (HTTP ${response.status}).`);
    }
    const text = await response.text();
    return formatJsonIfPossible(text);
  }

  const headerAddress = authPrivateKeyMode ? (adminEOA || eoaAddress) : eoaAddress;
  const [activeManagementTab, setActiveManagementTab] = useState<
    'agentInfo' | 'registration' | 'session' | 'delete' | 'transfer' | 'validation'
  >('agentInfo');
 
  const handleGenerateSessionPackage = useCallback(
    async () => {
      if (!isEditMode || !queryAgentId || !queryChainId || !queryAgentAddress) {
        return;
      }

      try {
        setSessionPackageError(null);
        setSessionPackageLoading(true);
        setSessionPackageText(null);

        if (!eip1193Provider || !headerAddress) {
          throw new Error('Wallet not connected. Connect your wallet to generate a session package.');
        }

        const parsedChainId = Number.parseInt(queryChainId, 10);
        if (!Number.isFinite(parsedChainId)) {
          throw new Error('Invalid chainId in URL');
        }

        const agentIdNumeric = Number.parseInt(queryAgentId, 10);
        if (!Number.isFinite(agentIdNumeric)) {
          throw new Error('Agent ID is invalid.');
        }

        const pkg = await generateSessionPackage({
          agentId: agentIdNumeric,
          chainId: parsedChainId,
          agentAccount: queryAgentAddress as `0x${string}`,
          provider: eip1193Provider,
          ownerAddress: headerAddress as `0x${string}`,
        });

        setSessionPackageText(JSON.stringify(pkg, null, 2));
      } catch (error: any) {
        console.error('Error creating session package (admin-tools):', error);
        setSessionPackageError(
          error?.message ?? 'Failed to create session package. Please try again.',
        );
      } finally {
        setSessionPackageLoading(false);
      }
    },
    [isEditMode, queryAgentId, queryChainId, queryAgentAddress, eip1193Provider, headerAddress],
  );
  const adminReady = authPrivateKeyMode || authConnected;
  const adminGate = (
    <section
      style={{
        background: 'linear-gradient(135deg, #f6f6f6, #f9f9f9)',
        borderRadius: '24px',
        padding: '3rem',
        border: '1px solid #ededed',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#4f4f4f',
          fontWeight: 700,
          marginBottom: '1rem',
        }}
      >
        Admin Tools
      </p>
      <h2 style={{ margin: 0, fontSize: '2.25rem', color: '#4a4a4a' }}>
        Connect a wallet or admin key to manage agents.
      </h2>
      <p style={{ marginTop: '1rem', color: '#4a4a4a', fontSize: '1.05rem' }}>
        Create, update, delete, and transfer ERC-8004 agents once authenticated.
      </p>
      <div style={{ marginTop: '2rem' }}>
        <button
          onClick={openLoginModal}
          style={{
            padding: '0.85rem 2rem',
            borderRadius: '999px',
            border: 'none',
            backgroundColor: '#4f4f4f',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Connect to Continue
        </button>
      </div>
    </section>
  );


  const [registrationLatestTokenUri, setRegistrationLatestTokenUri] = useState<string | null>(null);
  const [registrationTokenUriLoading, setRegistrationTokenUriLoading] = useState(false);
  const [registrationPreviewText, setRegistrationPreviewText] = useState<string | null>(null);
  const [registrationPreviewLoading, setRegistrationPreviewLoading] = useState(false);
  const [registrationPreviewError, setRegistrationPreviewError] = useState<string | null>(null);
  const registrationEditRef = useRef<HTMLTextAreaElement | null>(null);
  const [registrationEditSaving, setRegistrationEditSaving] = useState(false);
  const [registrationEditError, setRegistrationEditError] = useState<string | null>(null);

  const [registrationParsed, setRegistrationParsed] = useState<Record<string, any> | null>(null);
  const [registrationImage, setRegistrationImage] = useState<string>('');
  const [registrationA2aEndpoint, setRegistrationA2aEndpoint] = useState<string>('');
  const [registrationMcpEndpoint, setRegistrationMcpEndpoint] = useState<string>('');
  const [registrationImageError, setRegistrationImageError] = useState<string | null>(null);
  const [registrationA2aError, setRegistrationA2aError] = useState<string | null>(null);
  const [registrationMcpError, setRegistrationMcpError] = useState<string | null>(null);

  const [sessionPackageText, setSessionPackageText] = useState<string | null>(null);
  const [sessionPackageLoading, setSessionPackageLoading] = useState(false);
  const [sessionPackageError, setSessionPackageError] = useState<string | null>(null);
  const [sessionPackageProgress, setSessionPackageProgress] = useState(0);
  const sessionPackageProgressTimerRef = useRef<number | null>(null);

  const validateUrlLike = useCallback((value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^(https?:\/\/|ipfs:\/\/|data:)/i.test(trimmed)) {
      return null;
    }
    return 'Should start with http(s)://, ipfs://, or data:';
  }, []);

  // Load registration JSON when viewing the Registration tab in edit mode
  useEffect(() => {
    if (!isEditMode || activeManagementTab !== 'registration' || !queryAgentId || !queryChainId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setRegistrationTokenUriLoading(true);
        setRegistrationPreviewLoading(true);
        setRegistrationPreviewError(null);
        setRegistrationPreviewText(null);
        setRegistrationLatestTokenUri(null);
        setRegistrationEditError(null);
        setRegistrationParsed(null);
        setRegistrationImage('');
        setRegistrationA2aEndpoint('');
        setRegistrationMcpEndpoint('');
        setRegistrationImageError(null);
        setRegistrationA2aError(null);
        setRegistrationMcpError(null);

        const parsedChainId = Number.parseInt(queryChainId, 10);
        if (!Number.isFinite(parsedChainId)) {
          throw new Error('Invalid chainId in URL');
        }

        const did8004 = buildDid8004(parsedChainId, queryAgentId);
        const response = await fetch(`/api/agents/${encodeURIComponent(did8004)}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || errorData.error || 'Failed to fetch agent details for registration',
          );
        }

        const agentDetails = await response.json();
        if (cancelled) return;

        const tokenUri: string | undefined = agentDetails.tokenUri;
        setRegistrationLatestTokenUri(tokenUri ?? null);
        setRegistrationTokenUriLoading(false);

        if (!tokenUri) {
          setRegistrationPreviewLoading(false);
          setRegistrationPreviewError('No registration URI available for this agent.');
          return;
        }

        try {
          const text = await loadRegistrationContent(tokenUri);
          if (cancelled) return;

          const formatted = formatJsonIfPossible(text);
          let parsed: any;
          try {
            parsed = JSON.parse(formatted);
          } catch {
            setRegistrationParsed(null);
            setRegistrationPreviewText(formatted);
            setRegistrationPreviewError(
              'Registration JSON is not valid JSON. Field-by-field editing is disabled.',
            );
            setRegistrationPreviewLoading(false);
            return;
          }

          const image = typeof parsed.image === 'string' ? parsed.image : '';
          const endpoints = Array.isArray(parsed.endpoints) ? parsed.endpoints : [];
          const a2a = endpoints.find(
            (e: any) => e && typeof e.name === 'string' && e.name.toLowerCase() === 'a2a',
          );
          const mcp = endpoints.find(
            (e: any) => e && typeof e.name === 'string' && e.name.toLowerCase() === 'mcp',
          );

          setRegistrationParsed(parsed);
          setRegistrationImage(image);
          setRegistrationA2aEndpoint(
            a2a && typeof a2a.endpoint === 'string' ? a2a.endpoint : '',
          );
          setRegistrationMcpEndpoint(
            mcp && typeof mcp.endpoint === 'string' ? mcp.endpoint : '',
          );
          setRegistrationImageError(validateUrlLike(image) ?? null);
          setRegistrationA2aError(
            a2a && typeof a2a.endpoint === 'string' ? validateUrlLike(a2a.endpoint) : null,
          );
          setRegistrationMcpError(
            mcp && typeof mcp.endpoint === 'string' ? validateUrlLike(mcp.endpoint) : null,
          );

          setRegistrationPreviewText(JSON.stringify(parsed, null, 2));
          setRegistrationPreviewLoading(false);
        } catch (error: any) {
          if (cancelled) return;
          setRegistrationPreviewError(
            error?.message ?? 'Unable to load registration JSON from tokenUri.',
          );
          setRegistrationPreviewLoading(false);
        }
      } catch (error: any) {
        if (cancelled) return;
        setRegistrationTokenUriLoading(false);
        setRegistrationPreviewLoading(false);
        setRegistrationPreviewError(
          error?.message ?? 'Failed to load registration information for this agent.',
        );
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    isEditMode,
    activeManagementTab,
    queryAgentId,
    queryChainId,
    validateUrlLike,
  ]);

  // Keep preview JSON in sync with field-by-field edits
  useEffect(() => {
    if (!registrationParsed) {
      return;
    }

    const next: any = { ...registrationParsed };

    const img = registrationImage.trim();
    if (img) {
      next.image = img;
    } else {
      if ('image' in next) {
        delete next.image;
      }
    }

    const originalEndpoints = Array.isArray(registrationParsed.endpoints)
      ? registrationParsed.endpoints
      : [];

    const remaining = originalEndpoints.filter(
      (e: any) =>
        !e ||
        typeof e.name !== 'string' ||
        !/^(a2a|mcp)$/i.test(e.name),
    );

    const prevA2a = originalEndpoints.find(
      (e: any) => e && typeof e.name === 'string' && e.name.toLowerCase() === 'a2a',
    );
    const prevMcp = originalEndpoints.find(
      (e: any) => e && typeof e.name === 'string' && e.name.toLowerCase() === 'mcp',
    );

    const a2aUrl = registrationA2aEndpoint.trim();
    const mcpUrl = registrationMcpEndpoint.trim();

    if (a2aUrl) {
      remaining.push({
        ...(prevA2a || {}),
        name: 'A2A',
        endpoint: a2aUrl,
        version:
          (prevA2a && typeof prevA2a.version === 'string' && prevA2a.version) ||
          '0.3.0',
      });
    }

    if (mcpUrl) {
      remaining.push({
        ...(prevMcp || {}),
        name: 'MCP',
        endpoint: mcpUrl,
        version:
          (prevMcp && typeof prevMcp.version === 'string' && prevMcp.version) ||
          '2025-06-18',
      });
    }

    next.endpoints = remaining;

    try {
      setRegistrationPreviewText(JSON.stringify(next, null, 2));
    } catch {
      // If something goes wrong in stringification, leave previous text
    }
  }, [
    registrationParsed,
    registrationImage,
    registrationA2aEndpoint,
    registrationMcpEndpoint,
  ]);

  // Session package progress bar (60s max)
  useEffect(() => {
    if (!sessionPackageLoading) {
      if (sessionPackageProgressTimerRef.current !== null) {
        window.clearInterval(sessionPackageProgressTimerRef.current);
        sessionPackageProgressTimerRef.current = null;
      }
      setSessionPackageProgress(0);
      return;
    }

    const start = Date.now();
    setSessionPackageProgress(0);

    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / 60000) * 100, 100);
      setSessionPackageProgress(pct);
      if (pct >= 100) {
        if (sessionPackageProgressTimerRef.current !== null) {
          window.clearInterval(sessionPackageProgressTimerRef.current);
          sessionPackageProgressTimerRef.current = null;
        } else {
          window.clearInterval(id);
        }
      }
    }, 500);

    sessionPackageProgressTimerRef.current = id;

    return () => {
      if (sessionPackageProgressTimerRef.current !== null) {
        window.clearInterval(sessionPackageProgressTimerRef.current);
        sessionPackageProgressTimerRef.current = null;
      } else {
        window.clearInterval(id);
      }
    };
  }, [sessionPackageLoading]);

  const handleSaveRegistration = useCallback(
    async () => {
      if (!isEditMode || !queryAgentId || !queryChainId) {
        return;
      }

      try {
        setRegistrationEditError(null);

        if (!registrationParsed || !registrationPreviewText) {
          setRegistrationEditError('Registration JSON is not loaded or is invalid.');
          return;
        }

        if (registrationImageError || registrationA2aError || registrationMcpError) {
          setRegistrationEditError('Please fix the validation errors above before saving.');
          return;
        }

        const raw = registrationPreviewText;
        if (!raw.trim()) {
          setRegistrationEditError('Registration JSON cannot be empty.');
          return;
        }

        // Validate JSON locally
        try {
          JSON.parse(raw);
        } catch (parseError: any) {
          setRegistrationEditError(
            parseError instanceof Error
              ? `Invalid JSON: ${parseError.message}`
              : 'Invalid JSON in registration preview.',
          );
          return;
        }

        if (!eip1193Provider || !headerAddress) {
          setRegistrationEditError(
            'Wallet not connected. Connect your wallet to update registration.',
          );
          return;
        }

        const parsedChainId = Number.parseInt(queryChainId, 10);
        if (!Number.isFinite(parsedChainId)) {
          setRegistrationEditError('Invalid chainId in URL.');
          return;
        }

        const chain = getChainById(parsedChainId) as Chain;
        const hints = getEnvVarHints(parsedChainId);
        const bundlerEnv = hints ? (process.env as any)?.[hints.bundlerClient] : undefined;
        if (!bundlerEnv) {
          setRegistrationEditError(
            'Missing bundler URL configuration for this chain. Set NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_* env vars.',
          );
          return;
        }

        setRegistrationEditSaving(true);

        const did8004 = buildDid8004(parsedChainId, queryAgentId);
        const agentNameForAA = searchParams?.get('agentName') ?? '';

        const accountClient = await getDeployedAccountClientByAgentName(
          bundlerEnv,
          agentNameForAA,
          headerAddress as `0x${string}`,
          {
            chain,
            ethereumProvider: eip1193Provider,
          },
        );

        await updateAgentRegistrationWithWallet({
          did8004,
          chain,
          accountClient,
          registration: raw,
          onStatusUpdate: (msg: string) => {
            console.log('[RegistrationUpdate][admin-tools]', msg);
          },
        });

        setSuccess('Registration updated successfully.');
      } catch (error: any) {
        console.error('Failed to update registration from admin-tools:', error);
        setRegistrationEditError(
          error?.message ?? 'Failed to update registration. Please try again.',
        );
      } finally {
        setRegistrationEditSaving(false);
      }
    },
    [
      isEditMode,
      queryAgentId,
      queryChainId,
      eip1193Provider,
      headerAddress,
      searchParams,
      registrationParsed,
      registrationPreviewText,
      registrationImageError,
      registrationA2aError,
      registrationMcpError,
    ],
  );

  // Update agent form state
  const [updateForm, setUpdateForm] = useState({
    agentId: '',
    chainId: DEFAULT_CHAIN_ID.toString(),
    tokenUri: '',
    metadataKey: '',
    metadataValue: '',
  });

  // Delete agent form state
  const [deleteForm, setDeleteForm] = useState({
    agentId: '',
    chainId: DEFAULT_CHAIN_ID.toString(),
  });

  // Transfer agent form state
  const [transferForm, setTransferForm] = useState({
    agentId: '',
    chainId: DEFAULT_CHAIN_ID.toString(),
    to: '',
  });

  // ENS Validation state
  const [validationSubmitting, setValidationSubmitting] = useState(false);
  const [validatorAddress, setValidatorAddress] = useState<string | null>(null);
  const [requestUri, setRequestUri] = useState<string | null>(null);
  const [requestHash, setRequestHash] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditMode || !queryAgentId || !queryChainId) {
      return;
    }
    const parsedChainId = Number(queryChainId);
    if (!Number.isFinite(parsedChainId)) {
      return;
    }
    setUpdateForm({
      agentId: queryAgentId,
      chainId: queryChainId,
      tokenUri: '',
      metadataKey: '',
      metadataValue: '',
    });
    setDeleteForm({
      agentId: queryAgentId,
      chainId: queryChainId,
    });
    setTransferForm({
      agentId: queryAgentId,
      chainId: queryChainId,
      to: '',
    });
    // Compute validation request info for the current agent
    if (queryAgentId) {
      const agentIdNum = Number.parseInt(queryAgentId, 10);
      if (Number.isFinite(agentIdNum)) {
        const computedRequestUri = `https://agentic-trust.org/validation/${agentIdNum}`;
        setRequestUri(computedRequestUri);
        // Compute request hash (will be computed server-side, but show what it will be)
        import('viem').then(({ keccak256, stringToHex }) => {
          const hash = keccak256(stringToHex(computedRequestUri));
          setRequestHash(hash);
        }).catch(() => {
          // If viem import fails, hash will be computed server-side
        });
      } else {
        setRequestUri(null);
        setRequestHash(null);
      }
    } else {
      setRequestUri(null);
      setRequestHash(null);
    }
    // Reset validator address when agent changes
    setValidatorAddress(null);
  }, [isEditMode, queryAgentId, queryChainId]);



  const handleUpdateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);

      const metadata =
        updateForm.metadataKey && updateForm.metadataValue
          ? [{ key: updateForm.metadataKey, value: updateForm.metadataValue }]
          : undefined;

      const parsedChainId = Number.parseInt(updateForm.chainId, 10);
      const chainId = Number.isFinite(parsedChainId)
        ? parsedChainId
        : DEFAULT_CHAIN_ID;

      const did8004 = buildDid8004(chainId, updateForm.agentId);

      const response = await fetch(`/api/agents/${did8004}/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenUri: updateForm.tokenUri || undefined,
          chainId,
          metadata,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to update agent');
      }

      const data = await response.json();
      setSuccess(`Agent updated successfully! TX: ${data.txHash}`);
      setUpdateForm({
        agentId: '',
        chainId: DEFAULT_CHAIN_ID.toString(),
        tokenUri: '',
        metadataKey: '',
        metadataValue: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update agent');
    }
  };



  const handleDeleteAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm(`Are you sure you want to delete agent ${deleteForm.agentId}? This action cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      const parsedChainId = Number.parseInt(deleteForm.chainId, 10);
      const chainId = Number.isFinite(parsedChainId)
        ? parsedChainId
        : DEFAULT_CHAIN_ID;
      const did8004 = buildDid8004(chainId, deleteForm.agentId);

      const response = await fetch(`/api/agents/${did8004}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to delete agent');
      }

      const data = await response.json();
      setSuccess(`Agent deleted successfully! TX: ${data.txHash}`);
      setDeleteForm({ agentId: '', chainId: DEFAULT_CHAIN_ID.toString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    }
  };

  const handleSubmitValidationRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditMode || !queryAgentId || !queryChainId || !queryAgentAddress) {
      setError('Agent information is required. Please navigate to an agent first.');
      return;
    }
    const agentName = searchParams?.get('agentName');
    if (!agentName) {
      setError('Agent name is required. Please ensure the agent has a name.');
      return;
    }
    if (!eip1193Provider || !eoaAddress) {
      setError('Wallet connection is required for validation requests');
      return;
    }

    try {
      setError(null);
      setValidationSubmitting(true);
      const chainId = Number.parseInt(queryChainId, 10);
      if (!Number.isFinite(chainId)) {
        throw new Error('Invalid chainId');
      }
      const chain = getChainById(chainId);
      const bundlerUrl = getChainBundlerUrl(chainId);

      if (!bundlerUrl) {
        throw new Error(`Bundler URL not configured for chain ${chainId}`);
      }

      // Get agent account client
      const agentAccountClient = await getDeployedAccountClientByAgentName(
        bundlerUrl,
        agentName,
        eoaAddress as `0x${string}`,
        {
          chain: chain as any,
          ethereumProvider: eip1193Provider as any,
        }
      );

      // Build did8004 for the validation request
      const did8004 = buildDid8004(chainId, queryAgentId);

      // Submit validation request using the new pattern
      const result = await requestValidationWithWallet({
        did8004,
        chain: chain as any,
        accountClient: agentAccountClient,
        onStatusUpdate: (msg) => console.log('[Validation Request]', msg),
      });

      setSuccess(
        `ENS validation request submitted successfully! TX: ${result.txHash}, Validator: ${result.validatorAddress}, Request Hash: ${result.requestHash}`
      );
      // Update displayed validator address and request hash
      setValidatorAddress(result.validatorAddress);
      setRequestHash(result.requestHash);
    } catch (err) {
      console.error('Error submitting validation request:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit validation request');
    } finally {
      setValidationSubmitting(false);
    }
  };

  const handleTransferAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);

      const parsedChainId = Number.parseInt(transferForm.chainId, 10);
      const chainId = Number.isFinite(parsedChainId)
        ? parsedChainId
        : DEFAULT_CHAIN_ID;
      const did8004 = buildDid8004(chainId, transferForm.agentId);

      const response = await fetch(`/api/agents/${did8004}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: transferForm.to,
          chainId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to transfer agent');
      }

      const data = await response.json();
      setSuccess(`Agent transferred successfully! TX: ${data.txHash}`);
      setTransferForm({ agentId: '', chainId: DEFAULT_CHAIN_ID.toString(), to: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer agent');
    }
  };

  return (
    <>
      <Header
        displayAddress={headerAddress ?? null}
        privateKeyMode={authPrivateKeyMode}
        isConnected={authConnected}
        onConnect={openLoginModal}
        onDisconnect={authHandleDisconnect}
        disableConnect={authLoading}
      />
      <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
        {!adminReady ? (
          adminGate
        ) : (
          <>
        {error && (
          <div style={{ 
            marginBottom: '1rem', 
            padding: '1rem', 
            backgroundColor: '#f5f5f5', 
            borderRadius: '4px', 
            border: '1px solid #3a3a3a',
            color: '#3a3a3a'
          }}>
            Error: {error}
          </div>
        )}

      {success && (
        <div style={{ 
          marginBottom: '1rem', 
          padding: '1rem', 
          backgroundColor: '#f2f2f2', 
          borderRadius: '4px', 
          border: '1px solid #3c3c3c',
          color: '#3c3c3c'
        }}>
          Success: {success}
        </div>
      )}

      {isEditMode && queryAgentId && queryChainId && (
        <div
          style={{
            marginBottom: '1.5rem',
            padding: '1rem 1.5rem',
            borderRadius: '14px',
            border: '1px solid #dadada',
            backgroundColor: '#f3f3f3',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: '#2f2f2f' }}>
              Manage Agent #{queryAgentId} (chain {queryChainId})
            </div>

            {queryAgentAddress && (
              <div
                style={{
                  marginTop: '0.25rem',
                  fontSize: '0.85rem',
                  color: '#4b4b4b',
                }}
              >
                Account:{' '}
                <span style={{ fontFamily: 'monospace' }}>{queryAgentAddress}</span>
              </div>
            )}
          </div>

        </div>
      )}



      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isEditMode ? '260px 1fr' : 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        {/* Left-side navigation for edit mode */}
        {isEditMode && (
          <nav
            style={{
              padding: '1rem',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #dcdcdc',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              position: 'sticky',
              top: '6rem',
              alignSelf: 'flex-start',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveManagementTab('agentInfo')}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: activeManagementTab === 'agentInfo' ? '#2f2f2f' : '#dcdcdc',
                backgroundColor: activeManagementTab === 'agentInfo' ? '#f3f3f3' : '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Agent Info
            </button>
            <button
              type="button"
              onClick={() => setActiveManagementTab('registration')}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: activeManagementTab === 'registration' ? '#2f2f2f' : '#dcdcdc',
                backgroundColor: activeManagementTab === 'registration' ? '#f3f3f3' : '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Registration
            </button>
            <button
              type="button"
              onClick={() => setActiveManagementTab('session')}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: activeManagementTab === 'session' ? '#2f2f2f' : '#dcdcdc',
                backgroundColor: activeManagementTab === 'session' ? '#f3f3f3' : '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Session Package
            </button>
            <button
              type="button"
              onClick={() => setActiveManagementTab('transfer')}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: activeManagementTab === 'transfer' ? '#2f2f2f' : '#dcdcdc',
                backgroundColor: activeManagementTab === 'transfer' ? '#f3f3f3' : '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Transfer Agent
            </button>
            <button
              type="button"
              onClick={() => setActiveManagementTab('delete')}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: activeManagementTab === 'delete' ? '#2f2f2f' : '#dcdcdc',
                backgroundColor: activeManagementTab === 'delete' ? '#f3f3f3' : '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Delete Agent
            </button>
            <button
              type="button"
              onClick={() => setActiveManagementTab('validation')}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: activeManagementTab === 'validation' ? '#2f2f2f' : '#dcdcdc',
                backgroundColor: activeManagementTab === 'validation' ? '#f3f3f3' : '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              ENS Validation
            </button>
          </nav>
        )}

        {(!isEditMode || activeManagementTab === 'agentInfo') && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>
            {isEditMode && queryAgentId
              ? `Agent #${queryAgentId} Information`
              : 'Agent Information'}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.95rem', color: '#333' }}>
            <div>
              <strong>Agent Name:</strong>{' '}
              {searchParams?.get('agentName') || '(not provided)'}
            </div>
            <div>
              <strong>Agent ID:</strong>{' '}
              {queryAgentId || '(not provided)'}
            </div>
            <div>
              <strong>Agent Account Address:</strong>{' '}
              {queryAgentAddress ? (
                <span style={{ fontFamily: 'monospace' }}>{queryAgentAddress}</span>
              ) : (
                '(not provided)'
              )}
            </div>
            <div>
              <strong>Chain:</strong>{' '}
              {(() => {
                if (!queryChainId) return '(not provided)';
                const parsed = Number.parseInt(queryChainId, 10);
                const meta = Number.isFinite(parsed) ? CHAIN_METADATA[parsed] : undefined;
                const label = meta?.displayName || meta?.chainName || queryChainId;
                return `${label} (chain ${queryChainId})`;
              })()}
            </div>
          </div>
        </div>
        )}
        {(!isEditMode || activeManagementTab === 'registration') && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Edit Registration</h2>
          <p style={{ marginTop: 0, fontSize: '0.95rem', color: '#4b4b4b' }}>
            Update the image and protocol endpoints for this agent. Other registration fields are
            preserved as-is. The JSON that will be saved is shown on the right.
          </p>
          <div
            style={{
              marginTop: '0.75rem',
              marginBottom: '0.75rem',
              padding: '0.75rem',
              borderRadius: '8px',
              backgroundColor: '#f7f7f7',
              border: '1px solid #dcdcdc',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.25rem' }}>
              Latest TokenUri (from contract):
            </div>
            {registrationTokenUriLoading ? (
              <div style={{ fontSize: '0.85rem', color: '#777' }}>
                Loading tokenUri from contract...
              </div>
            ) : registrationLatestTokenUri ? (
              <div
                style={{
                  fontSize: '0.85rem',
                  fontFamily: 'ui-monospace, monospace',
                  color: '#111',
                  wordBreak: 'break-all',
                }}
              >
                {registrationLatestTokenUri}
              </div>
            ) : (
              <div style={{ fontSize: '0.85rem', color: '#b91c1c' }}>
                No tokenUri found on contract
              </div>
            )}
          </div>
          {registrationPreviewError && (
            <p style={{ color: '#b91c1c', marginTop: '0.5rem' }}>{registrationPreviewError}</p>
          )}
          {registrationEditError && (
            <p style={{ color: '#b91c1c', marginTop: '0.5rem' }}>
              {registrationEditError}
            </p>
          )}

          <div
            style={{
              marginTop: '1rem',
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
              gap: '1.25rem',
              alignItems: 'flex-start',
            }}
          >
            {/* Left: field-by-field editor */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  Image URL
                </label>
                <input
                  type="url"
                  value={registrationImage}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRegistrationImage(val);
                    setRegistrationImageError(validateUrlLike(val));
                  }}
                  placeholder="https://example.com/agent-image.png or ipfs://..."
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #dcdcdc',
                    borderRadius: '4px',
                  }}
                  disabled={!registrationParsed}
                />
                {registrationImageError && (
                  <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: '#b91c1c' }}>
                    {registrationImageError}
                  </p>
                )}
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  A2A Endpoint
                </label>
                <input
                  type="url"
                  value={registrationA2aEndpoint}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRegistrationA2aEndpoint(val);
                    setRegistrationA2aError(validateUrlLike(val));
                  }}
                  placeholder="https://agent.example.com/.well-known/agent-card.json"
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #dcdcdc',
                    borderRadius: '4px',
                  }}
                  disabled={!registrationParsed}
                />
                <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: '#666' }}>
                  Single Agent Card (A2A) endpoint. This will be stored in the <code>endpoints</code>{' '}
                  array with name <code>A2A</code>.
                </p>
                {registrationA2aError && (
                  <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: '#b91c1c' }}>
                    {registrationA2aError}
                  </p>
                )}
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  MCP Endpoint
                </label>
                <input
                  type="url"
                  value={registrationMcpEndpoint}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRegistrationMcpEndpoint(val);
                    setRegistrationMcpError(validateUrlLike(val));
                  }}
                  placeholder="https://agent.example.com/mcp"
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #dcdcdc',
                    borderRadius: '4px',
                  }}
                  disabled={!registrationParsed}
                />
                <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: '#666' }}>
                  Single MCP endpoint. This will be stored in the <code>endpoints</code> array with
                  name <code>MCP</code>.
                </p>
                {registrationMcpError && (
                  <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: '#b91c1c' }}>
                    {registrationMcpError}
                  </p>
                )}
              </div>

              <div
                style={{
                  marginTop: '0.25rem',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.5rem',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!registrationEditSaving) {
                      setRegistrationEditError(null);
                      setRegistrationPreviewText(null);
                      setRegistrationParsed(null);
                    }
                  }}
                  style={{
                    padding: '0.4rem 0.9rem',
                    borderRadius: '8px',
                    border: '1px solid #dcdcdc',
                    backgroundColor: '#ffffff',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    cursor: registrationEditSaving ? 'not-allowed' : 'pointer',
                    opacity: registrationEditSaving ? 0.6 : 1,
                    color: '#555',
                  }}
                  disabled={registrationEditSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveRegistration}
                  style={{
                    padding: '0.4rem 0.9rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#2f2f2f',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor:
                      registrationEditSaving ||
                      registrationPreviewLoading ||
                      !registrationParsed
                        ? 'not-allowed'
                        : 'pointer',
                    opacity:
                      registrationEditSaving ||
                      registrationPreviewLoading ||
                      !registrationParsed
                        ? 0.5
                        : 1,
                    color: '#ffffff',
                  }}
                  disabled={
                    registrationEditSaving ||
                    registrationPreviewLoading ||
                    !registrationParsed ||
                    !!registrationImageError ||
                    !!registrationA2aError ||
                    !!registrationMcpError
                  }
                >
                  {registrationEditSaving ? 'Saving…' : 'Save registration'}
                </button>
              </div>
            </div>

            {/* Right: read-only JSON preview */}
            <div
              style={{
                border: '1px solid #dcdcdc',
                borderRadius: '10px',
                padding: '0.75rem',
                backgroundColor: '#f7f7f7',
                maxHeight: '500px',
                overflow: 'auto',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {registrationPreviewLoading ? (
                <span style={{ color: '#777' }}>Loading registration JSON…</span>
              ) : !registrationPreviewText ? (
                <span style={{ color: '#777' }}>No registration JSON available to edit.</span>
              ) : (
                <pre style={{ margin: 0 }}>{registrationPreviewText}</pre>
              )}
            </div>
          </div>
        </div>
        )}
        {(!isEditMode || activeManagementTab === 'delete') && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', color: '#3a3a3a' }}>Delete Agent</h2>
          <form onSubmit={handleDeleteAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent ID *
              </label>
              <input
                type="text"
                value={deleteForm.agentId}
                onChange={(e) => setDeleteForm({ ...deleteForm, agentId: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Chain ID *
              </label>
              <input
                type="number"
                value={deleteForm.chainId}
                onChange={(e) =>
                  setDeleteForm({ ...deleteForm, chainId: e.target.value })
                }
                required
                min={0}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#3a3a3a',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Delete Agent
            </button>
          </form>
        </div>
        )}

        {(!isEditMode || activeManagementTab === 'session') && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Session Package</h2>
          <p style={{ marginTop: 0, fontSize: '0.95rem', color: '#4b4b4b' }}>
            Generate a session package for this agent. 
          </p>
          <p>
          Session packages describe delegated AA
          access and can be used by tools to perform actions on behalf of this agent.
          </p>
          <br />
          <br />
          <button
            type="button"
            onClick={handleGenerateSessionPackage}
            disabled={sessionPackageLoading}
            style={{
              padding: '0.5rem 0.9rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: sessionPackageLoading ? '#b0b0b0' : '#2f2f2f',
              color: '#ffffff',
              fontWeight: 600,
              cursor: sessionPackageLoading ? 'not-allowed' : 'pointer',
              marginBottom: '0.75rem',
            }}
          >
            {sessionPackageLoading ? 'Generating…' : 'Generate Session Package'}
          </button>
          {sessionPackageLoading && (
            <div style={{ width: '100%', marginTop: '0.35rem', marginBottom: '0.75rem' }}>
              <div
                style={{
                  height: '6px',
                  borderRadius: '999px',
                  backgroundColor: '#e0e0e0',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${sessionPackageProgress}%`,
                    height: '100%',
                    backgroundColor: '#2f2f2f',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <p style={{ marginTop: '0.3rem', fontSize: '0.8rem', color: '#4f4f4f' }}>
                Generating session package… {Math.round(sessionPackageProgress)}% (up to 60 seconds)
              </p>
            </div>
          )}
          {sessionPackageError && (
            <p style={{ color: '#b91c1c', marginTop: '0.25rem' }}>{sessionPackageError}</p>
          )}
          {sessionPackageText && (
            <div
              style={{
                marginTop: '0.75rem',
                border: '1px solid #dcdcdc',
                borderRadius: '10px',
                padding: '0.75rem',
                backgroundColor: '#f7f7f7',
                maxHeight: '500px',
                overflow: 'auto',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && navigator.clipboard && sessionPackageText) {
                      void navigator.clipboard.writeText(sessionPackageText);
                    }
                  }}
                  style={{
                    padding: '0.3rem 0.6rem',
                    borderRadius: '999px',
                    border: '1px solid #dcdcdc',
                    backgroundColor: '#ffffff',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  Copy JSON
                </button>
              </div>
              <pre style={{ margin: 0 }}>{sessionPackageText}</pre>
            </div>
          )}
        </div>
        )}
        {(!isEditMode || activeManagementTab === 'transfer') && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Transfer Agent</h2>
          <form onSubmit={handleTransferAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent ID *
              </label>
              <input
                type="text"
                value={transferForm.agentId}
                onChange={(e) => setTransferForm({ ...transferForm, agentId: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Chain ID *
              </label>
              <input
                type="number"
                value={transferForm.chainId}
                onChange={(e) =>
                  setTransferForm({ ...transferForm, chainId: e.target.value })
                }
                required
                min={0}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Transfer To (0x...) *
              </label>
              <input
                type="text"
                value={transferForm.to}
                onChange={(e) => setTransferForm({ ...transferForm, to: e.target.value })}
                required
                pattern="^0x[a-fA-F0-9]{40}$"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px', fontFamily: 'monospace' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#d4d4d4',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Transfer Agent
            </button>
          </form>
        </div>
        )}
        {(!isEditMode || activeManagementTab === 'validation') && (
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>ENS Validation Request</h2>
          {isEditMode && queryAgentId && queryChainId ? (
            <>
              <p style={{ marginTop: 0, fontSize: '0.95rem', color: '#4b4b4b', marginBottom: '1.5rem' }}>
                Submit an ENS validation request for the current agent. The agent account abstraction will be used as the requester,
                and a validator account abstraction (name: 'validator-ens') will be used as the validator.
              </p>
              <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f7f7f7', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600 }}>Validation Request Information</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <div>
                    <strong>Agent ID:</strong>{' '}
                    <span style={{ fontFamily: 'monospace' }}>{queryAgentId}</span>
                  </div>
                  <div>
                    <strong>Agent Name:</strong>{' '}
                    {searchParams?.get('agentName') || '(not available)'}
                  </div>
                  <div>
                    <strong>Chain ID:</strong>{' '}
                    {queryChainId}
                  </div>
                  <div>
                    <strong>Agent Account Address:</strong>{' '}
                    {queryAgentAddress ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{queryAgentAddress}</span>
                    ) : (
                      '(not available)'
                    )}
                  </div>
                  <div>
                    <strong>Validator Address:</strong>{' '}
                    {validatorAddress ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{validatorAddress}</span>
                    ) : (
                      <span style={{ color: '#777', fontStyle: 'italic' }}>(will be computed server-side)</span>
                    )}
                  </div>
                  <div>
                    <strong>Request URI:</strong>{' '}
                    {requestUri ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>{requestUri}</span>
                    ) : (
                      <span style={{ color: '#777', fontStyle: 'italic' }}>Loading...</span>
                    )}
                  </div>
                  <div>
                    <strong>Request Hash:</strong>{' '}
                    {requestHash ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{requestHash}</span>
                    ) : (
                      <span style={{ color: '#777', fontStyle: 'italic' }}>Loading...</span>
                    )}
                  </div>
                </div>
              </div>
              <form onSubmit={handleSubmitValidationRequest}>
                <button
                  type="submit"
                  disabled={validationSubmitting || !eip1193Provider || !eoaAddress || !searchParams?.get('agentName')}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: validationSubmitting || !eip1193Provider || !eoaAddress || !searchParams?.get('agentName') ? '#787878' : '#2f2f2f',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: validationSubmitting || !eip1193Provider || !eoaAddress || !searchParams?.get('agentName') ? 'not-allowed' : 'pointer',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    opacity: validationSubmitting || !eip1193Provider || !eoaAddress || !searchParams?.get('agentName') ? 0.7 : 1,
                  }}
                >
                  {validationSubmitting ? 'Submitting...' : 'Submit Validation Request'}
                </button>
                {(!eip1193Provider || !eoaAddress) && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#d32f2f', textAlign: 'center' }}>
                    Wallet connection required to submit validation request
                  </p>
                )}
                {!searchParams?.get('agentName') && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#d32f2f', textAlign: 'center' }}>
                    Agent name is required to submit validation request
                  </p>
                )}
              </form>
            </>
          ) : (
            <p style={{ color: '#777', fontStyle: 'italic' }}>
              Please navigate to an agent to view validation request information.
            </p>
          )}
        </div>
        )}
      </div>
        </>
        )}
    </main>
    </>
  );
}

