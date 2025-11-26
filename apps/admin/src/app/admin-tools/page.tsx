'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallet } from '@/components/WalletProvider';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import type { Address } from 'viem';
import { createAgentWithWallet, getCounterfactualAAAddressByAgentName, createAgentDirect } from '@agentic-trust/core/client';
import type { Chain } from 'viem';
import {
  getEnsOrgName,
  getSupportedChainIds,
  getChainDisplayMetadata,
  getChainById,
  getChainIdHex as getChainIdHexUtil,
  DEFAULT_CHAIN_ID,
} from '@agentic-trust/core/server';
import { ensureWeb3AuthChain } from '@/lib/web3auth';
import { buildDid8004, generateSessionPackage, getDeployedAccountClientByAgentName, updateAgentRegistrationWithWallet } from '@agentic-trust/core';
import { buildDidEnsFromAgentAndOrg } from '@/app/api/names/_lib/didEns';
import type { DiscoverParams as AgentSearchParams, DiscoverResponse } from '@agentic-trust/core/server';
type Agent = DiscoverResponse['agents'][number];

const CREATE_STEPS = ['Name', 'Information', 'Protocols', 'Review & Register'] as const;
const REGISTRATION_PROGRESS_DURATION_MS = 60_000;
const REGISTRATION_UPDATE_INTERVAL_MS = 200;

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
  const modeParam = searchParams?.get('mode') ?? null;
  const queryAgentId = searchParams?.get('agentId') ?? null;
  const queryChainId = searchParams?.get('chainId') ?? null;
  const queryAgentAddress = searchParams?.get('agentAccount') ?? null;
  const isEditMode = modeParam === 'edit';
  const createOnlyMode = modeParam === 'create';
  // Always allow the Agent Registration panel to be shown (as "Register Agent" in edit mode)
  const showCreatePane = true;
  const showManagementPanes = !createOnlyMode;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create agent form state
  const getDefaultImageUrl = () => (typeof window !== 'undefined' ? `${window.location.origin}/8004Agent.png` : '/8004Agent.png');
  const [createForm, setCreateForm] = useState({
    agentName: '',
    agentAccount: '',
    description: '',
    image: getDefaultImageUrl(),
    agentUrl: '',
  });
  const [imagePreviewError, setImagePreviewError] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const handleImagePreviewLoad = useCallback(() => setImagePreviewError(false), []);
  const handleImagePreviewError = useCallback(() => setImagePreviewError(true), []);
  const [ensExisting, setEnsExisting] = useState<{ image: string | null; url: string | null; description: string | null } | null>(null);
  const [createStep, setCreateStep] = useState(0);
  const [protocolSettings, setProtocolSettings] = useState({
    publishA2A: true,
    publishMcp: true,
    a2aEndpoint: '',
    mcpEndpoint: '',
  });
  const [registering, setRegistering] = useState(false);
  const [registerProgress, setRegisterProgress] = useState(0);
  const registerTimerRef = useRef<number | null>(null);
  const totalCreateSteps = CREATE_STEPS.length;
  const isReviewStep = createStep === totalCreateSteps - 1;
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
  const getStepLabel = useCallback(
    (label: (typeof CREATE_STEPS)[number]) => {
      if (!isMobile) return label;
      if (label === 'Information') return 'Info';
      if (label === 'Protocols') return "Prot's";
      if (label === 'Review & Register') return 'Review';
      return label;
    },
    [isMobile],
  );

  const resetRegistrationProgress = useCallback(() => {
    if (registerTimerRef.current) {
      clearInterval(registerTimerRef.current);
      registerTimerRef.current = null;
    }
    setRegistering(false);
    setRegisterProgress(0);
  }, []);

  const startRegistrationProgress = useCallback(() => {
    if (registerTimerRef.current) {
      clearInterval(registerTimerRef.current);
      registerTimerRef.current = null;
    }
    setRegistering(true);
    setRegisterProgress(0);
    if (typeof window === 'undefined') {
      return;
    }
    const startTime = Date.now();
    registerTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, (elapsed / REGISTRATION_PROGRESS_DURATION_MS) * 100);
      setRegisterProgress(pct);
      if (pct >= 100 && registerTimerRef.current) {
        clearInterval(registerTimerRef.current);
        registerTimerRef.current = null;
      }
    }, REGISTRATION_UPDATE_INTERVAL_MS);
  }, []);

  useEffect(() => {
    return () => resetRegistrationProgress();
  }, [resetRegistrationProgress]);

  // Ensure absolute default image URL on the client
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (createForm.image === '/8004Agent.png') {
      setCreateForm(prev => ({ ...prev, image: `${window.location.origin}/8004Agent.png` }));
    }
  }, [createForm.image]);

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

  // Chain selection for Create Agent
  const [selectedChainId, setSelectedChainId] = useState<number>(DEFAULT_CHAIN_ID);

  const supportedChainIds = React.useMemo(() => getSupportedChainIds(), []);
  const registerChainIds = React.useMemo(
    () => supportedChainIds.filter(id => id !== 11155420),
    [supportedChainIds],
  );

  useEffect(() => {
    if (registerChainIds.length === 0) {
      return;
    }
    if (!registerChainIds.includes(selectedChainId)) {
      setSelectedChainId(registerChainIds[0]);
    }
  }, [registerChainIds, selectedChainId]);

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

  const CHAIN_OBJECTS: Record<number, Chain> = React.useMemo(() => {
    const map: Record<number, Chain> = {};
    supportedChainIds.forEach(chainId => {
      try {
        map[chainId] = getChainById(chainId) as Chain;
      } catch (error) {
        console.warn('[chain] Unable to load chain object', chainId, error);
      }
    });
    return map;
  }, [supportedChainIds]);

  const getChainIdHex = React.useCallback(
    (chainId: number): string => CHAIN_METADATA[chainId]?.chainIdHex ?? getChainIdHexUtil(chainId),
    [CHAIN_METADATA],
  );
  const getBundlerUrlForChain = React.useCallback(
    (chainId: number): string | undefined => {
      const hints = getEnvVarHints(chainId);
      if (!hints) return undefined;
      // Read the client-side bundler env var (NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_*)
      return (process.env as any)?.[hints.bundlerClient];
    },
    [],
  );

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
    'agentInfo' | 'registration' | 'session' | 'delete' | 'transfer' | 'create'
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

  const ensureProviderOnChain = React.useCallback(
    async (provider: any, chainId: number, label: string): Promise<boolean> => {
      if (!provider?.request) return false;
      const metadata = CHAIN_METADATA[chainId];
      if (!metadata) {
        console.warn(`[chain] ensureProviderOnChain(${label}) → missing metadata for chain ${chainId}`);
        return false;
      }

      const chainLabel = metadata.displayName || metadata.chainName || `chain ${chainId}`;
      console.info(`[chain] ensureProviderOnChain(${label}) → requesting ${chainLabel}`);

      try {
        const currentChain = await provider.request({ method: 'eth_chainId' }).catch(() => null);
        if (typeof currentChain === 'string' && currentChain.toLowerCase() === metadata.chainIdHex.toLowerCase()) {
          console.info(`[chain] ${label} already on ${chainLabel}`);
          return true;
        }

        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: metadata.chainIdHex }],
        });
        console.info(`[chain] ${label} switched to ${chainLabel}`);
      } catch (switchErr: any) {
        const errorCode = switchErr?.code ?? switchErr?.data?.originalError?.code;
        if (errorCode !== 4902) {
          console.warn(`Unable to switch provider chain (${chainLabel})`, switchErr);
          return false;
        }

        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: metadata.chainIdHex,
              chainName: chainLabel,
              nativeCurrency: metadata.nativeCurrency,
              rpcUrls: metadata.rpcUrls,
              blockExplorerUrls: metadata.blockExplorerUrls,
            }],
          });
          console.info(`[chain] ${label} added ${chainLabel}`);
        } catch (addErr) {
          console.warn(`Unable to add provider chain (${chainLabel})`, addErr);
          return false;
        }
      }

      const finalChain = await provider.request({ method: 'eth_chainId' }).catch(() => null);
      if (typeof finalChain === 'string' && finalChain.toLowerCase() === metadata.chainIdHex.toLowerCase()) {
        console.info(`[chain] ${label} final chain ${chainLabel}`);
        return true;
      }
      console.warn(
        `[chain] ${label} chain mismatch after switch. Expected ${metadata.chainIdHex}, got ${finalChain ?? 'unknown'}`,
      );
      return false;
    },
    [CHAIN_METADATA],
  );

  const synchronizeProvidersWithChain = React.useCallback(
    async (chainId: number): Promise<boolean> => {
      const chainLabel = CHAIN_METADATA[chainId]?.displayName || CHAIN_METADATA[chainId]?.chainName || `chain ${chainId}`;
      console.info('[chain] synchronizeProvidersWithChain', chainId, chainLabel);
      const results: boolean[] = [];

      // Use the consolidated eip1193Provider from useWallet
      if (eip1193Provider && eoaConnected) {
        const isMetaMask = Boolean((eip1193Provider as any)?.isMetaMask);
        const isWeb3Auth = !isMetaMask && Boolean((eip1193Provider as any)?.isWeb3Auth);
        
        if (isWeb3Auth) {
          // Try Web3Auth-specific chain switching first
          const switched = await ensureWeb3AuthChain(chainId);
          if (!switched) {
            console.info('[chain] ensureWeb3AuthChain returned false; falling back to provider request');
            results.push(await ensureProviderOnChain(eip1193Provider, chainId, 'web3auth'));
          } else {
            results.push(true);
          }
        } else if (isMetaMask) {
          results.push(await ensureProviderOnChain(eip1193Provider, chainId, 'metamask'));
        } else {
          // Generic provider
          results.push(await ensureProviderOnChain(eip1193Provider, chainId, 'provider'));
        }
      } else {
        if (eip1193Provider) {
          const isMetaMask = Boolean((eip1193Provider as any)?.isMetaMask);
          console.info(`[chain] skipping ${isMetaMask ? 'MetaMask' : 'provider'} auto-switch (not connected)`);
        }
      }

      return results.length === 0 || results.every(Boolean);
    },
    [eip1193Provider, eoaConnected, ensureProviderOnChain, CHAIN_METADATA],
  );

  // Toggle states for Create Agent
  const useAA = true;
  const [ensOrgName, setEnsOrgName] = useState(getEnsOrgName(DEFAULT_CHAIN_ID)); // Default org name
  const [ensChecking, setEnsChecking] = useState(false);
  const [ensAvailable, setEnsAvailable] = useState<boolean | null>(null);
  const [aaAddress, setAaAddress] = useState<string | null>(null);
  const [aaComputing, setAaComputing] = useState(false);
  const [existingAgentInfo, setExistingAgentInfo] = useState<{ account: string; method?: string } | null>(null);

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
        const bundlerEnv = getBundlerUrlForChain(parsedChainId);
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
      getBundlerUrlForChain,
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
  }, [isEditMode, queryAgentId, queryChainId]);

  useEffect(() => {
    if (!eip1193Provider && !eoaConnected) {
      console.info('[chain] skip auto-sync (no connected provider)');
      return;
    }
    (async () => {
      const ready = await synchronizeProvidersWithChain(selectedChainId);
      if (!ready) {
        setError('Unable to switch wallet provider to the selected chain. Please switch manually in your wallet.');
        const chainMeta = CHAIN_METADATA[selectedChainId];
        const chainLabel = chainMeta?.displayName || chainMeta?.chainName || `chain ${selectedChainId}`;
        try {
          const envNames = getEnvVarHints(selectedChainId);
          if (envNames) {
            console.error(
              `[chain] Auto-switch failed for ${chainLabel}. Ensure RPC env vars ` +
                `${envNames.rpcClient} (client) and ${envNames.rpcServer} (server) are configured. ` +
                `If you use AA, also set ${envNames.bundlerClient} and ${envNames.bundlerServer}.`,
            );
          }
        } catch (envErr) {
          console.error('[chain] Unable to provide env hint for chain', selectedChainId, envErr);
        }
      }
    })();
  }, [selectedChainId, synchronizeProvidersWithChain, eip1193Provider, eoaConnected]);

  // Set agent account in EOA mode (when AA is not enabled)
  useEffect(() => {
    if (!useAA) {
      // Priority: use wallet address if available, otherwise fetch admin EOA address in private key mode
      if (eoaAddress) {
        // Use connected wallet address
        setCreateForm(prev => ({
          ...prev,
          agentAccount: eoaAddress,
        }));
      } else if (privateKeyMode) {
        // Fetch admin EOA address from API
        (async () => {
          try {
            const response = await fetch('/api/admin/address');
            if (response.ok) {
              const data = await response.json();
              setCreateForm(prev => ({
                ...prev,
                agentAccount: data.address,
              }));
            } else {
              console.error('Failed to fetch admin address:', response.status);
            }
          } catch (error) {
            console.error('Error fetching admin address:', error);
          }
        })();
      }
    }
  }, [eoaAddress, useAA, privateKeyMode]);

  // Auto-compute AA address as the agent name changes
  // Use server-side endpoint for private key mode, client-side function for wallet mode
  useEffect(() => {
    if (!useAA) {
      setAaAddress(null);
      return;
    }
    
    const name = (createForm.agentName || '').trim();
    if (!name) {
      setAaAddress(null);
      setCreateForm(prev => ({ ...prev, agentAccount: '' }));
      return;
    }

    // Private key mode: use server-side endpoint
    if (privateKeyMode) {
      let cancelled = false;
      setAaComputing(true);

      (async () => {
        try {
          // Use server-side endpoint for private key mode
          const resp = await fetch('/api/accounts/counterfactual-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentName: name,
              chainId: selectedChainId || undefined,
            }),
          });
          
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            console.warn('Server-side AA address computation failed:', err);
            if (!cancelled) {
              setAaAddress(null);
              setCreateForm(prev => ({ ...prev, agentAccount: '' }));
            }
            return;
          }
          
          const data = await resp.json();
          const computed = (data?.address as string) || '';
          if (!cancelled && computed && computed.startsWith('0x')) {
            setAaAddress(computed);
            setCreateForm(prev => ({ ...prev, agentAccount: computed }));
          }
        } catch (error) {
          console.error('Error computing AA address (server-side):', error);
          if (!cancelled) {
            setAaAddress(null);
            setCreateForm(prev => ({ ...prev, agentAccount: '' }));
          }
        } finally {
          if (!cancelled) {
            setAaComputing(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }
    
    // Wallet mode: use client-side function
    if (!eip1193Provider || !eoaAddress) {
      setAaAddress(null);
      setCreateForm(prev => ({ ...prev, agentAccount: '' }));
      return;
    }

    let cancelled = false;
    setAaComputing(true);

    (async () => {
      try {
        // Use client-side function to compute AA address with wallet provider
        const computed = await getCounterfactualAAAddressByAgentName(
          name,
          eoaAddress as `0x${string}`,
          {
            ethereumProvider: eip1193Provider as any,
            chain: CHAIN_OBJECTS[selectedChainId] ?? CHAIN_OBJECTS[DEFAULT_CHAIN_ID],
          },
        );
        if (!cancelled && computed && computed.startsWith('0x')) {
          setAaAddress(computed);
          setCreateForm(prev => ({ ...prev, agentAccount: computed }));
        }
      } catch (error) {
        console.error('Error computing AA address (client-side):', error);
        if (!cancelled) {
          setAaAddress(null);
          setCreateForm(prev => ({ ...prev, agentAccount: '' }));
        }
      } finally {
        if (!cancelled) {
          setAaComputing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [useAA, privateKeyMode, eip1193Provider, eoaAddress, createForm.agentName, selectedChainId, CHAIN_OBJECTS]);

  // Check ENS availability when agent name changes
  useEffect(() => {
    if (!createForm.agentName || !ensOrgName) {
      setEnsAvailable(null);
      setEnsChecking(false);
      setEnsExisting(null);
      return;
    }

    let cancelled = false;
    setEnsChecking(true);

    (async () => {
      try {
        const encodedEnsDid = buildDidEnsFromAgentAndOrg(
          selectedChainId,
          createForm.agentName,
          ensOrgName
        );

        const response = await fetch(`/api/names/${encodedEnsDid}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        const info = data?.nameInfo;
        const isAvailable = info?.available === true;
        
        if (!cancelled) {
          setEnsAvailable(isAvailable);
          if (isAvailable === false) {
            setEnsExisting({
              image: info?.image ?? null,
              url: info?.url ?? null,
              description: info?.description ?? null,
            });
          } else {
            setEnsExisting(null);
          }
        }
      } catch (error) {
        console.error('Error checking ENS availability:', error);
        if (!cancelled) {
          setEnsAvailable(null);
          setEnsExisting(null);
        }
      } finally {
        if (!cancelled) {
          setEnsChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [createForm.agentName, ensOrgName, selectedChainId]);

  useEffect(() => {
    setImagePreviewError(false);
  }, [createForm.image]);

  // Keep ENS org name in sync with selected chain
  useEffect(() => {
    try {
      const name = getEnsOrgName(selectedChainId);
      setEnsOrgName(name);
    } catch (e) {
      // If missing, surface error, but don't crash UI
      console.warn('Missing chain-specific ENS org name for chain', selectedChainId, e);
      setEnsOrgName('');
    }
  }, [selectedChainId]);


  const ensFullNamePreview =
    createForm.agentName && ensOrgName
      ? `${createForm.agentName.toLowerCase()}.${ensOrgName.toLowerCase()}.eth`
      : '';

  // DID previews (update as inputs change)
  const didEnsPreview = useMemo(() => {
    if (!ensFullNamePreview) return null;
    return `did:ens:${selectedChainId}:${ensFullNamePreview}`;
  }, [ensFullNamePreview, selectedChainId]);

  const didEthrPreview = useMemo(() => {
    const acct = (aaAddress || createForm.agentAccount || '').trim();
    if (!acct || !acct.startsWith('0x') || acct.length !== 42) return null;
    return `did:ethr:${selectedChainId}:${acct.toLowerCase()}`;
  }, [aaAddress, createForm.agentAccount, selectedChainId]);

  const didAgentPreview = useMemo(() => {
    // AgentId is not known until after registration; show a placeholder
    return `did:agent:${selectedChainId}:<agentId>`;
  }, [selectedChainId]);

  const computeStepValidation = useCallback((): { valid: boolean; message?: string } => {
    switch (createStep) {
      case 0: {
        if (!createForm.agentName.trim()) {
          return { valid: false, message: 'Agent name is required.' };
        }
        if (!ensFullNamePreview) {
          return { valid: false, message: 'ENS name is required.' };
        }
        if (ensAvailable !== true) {
          return { valid: false, message: 'ENS name must be available.' };
        }
        return { valid: true };
      }
      case 1: {
        if (!createForm.description.trim()) {
          return { valid: false, message: 'Please provide a description for your agent.' };
        }
        return { valid: true };
      }
      case 2: {
        if (!createForm.agentUrl.trim()) {
          return { valid: false, message: 'Agent URL is required.' };
        }
        if (!protocolSettings.publishA2A && !protocolSettings.publishMcp) {
          return { valid: false, message: 'Enable at least one protocol (A2A or MCP).' };
        }
        if (protocolSettings.publishA2A && !protocolSettings.a2aEndpoint.trim()) {
          return { valid: false, message: 'Provide an A2A protocol endpoint URL.' };
        }
        if (protocolSettings.publishMcp && !protocolSettings.mcpEndpoint.trim()) {
          return { valid: false, message: 'Provide an MCP protocol endpoint URL.' };
        }
        if (!ensOrgName.trim()) {
          return { valid: false, message: 'ENS parent name is required when ENS publishing is enabled.' };
        }
        return { valid: true };
      }
      case 3:
      default:
        return { valid: true };
    }
  }, [
    createStep,
    createForm.agentName,
    createForm.agentAccount,
    createForm.description,
    createForm.agentUrl,
    protocolSettings.publishA2A,
    protocolSettings.publishMcp,
    protocolSettings.a2aEndpoint,
    protocolSettings.mcpEndpoint,
    ensOrgName,
    ensAvailable,
    ensFullNamePreview,
  ]);

  const validateCurrentStep = useCallback((): boolean => {
    const result = computeStepValidation();
    if (!result.valid) {
      setError(result.message ?? 'Please complete all required fields.');
      return false;
    }
    setError(null);
    return true;
  }, [computeStepValidation]);

  const isCurrentStepValid = useMemo(
    () => computeStepValidation().valid,
    [computeStepValidation],
  );

  const handleNextStep = useCallback(() => {
    if (!validateCurrentStep()) {
      return;
    }
    setCreateStep(prev => Math.min(prev + 1, totalCreateSteps - 1));
  }, [validateCurrentStep, totalCreateSteps]);

  const handlePrevStep = useCallback(() => {
    setError(null);
    setCreateStep(prev => Math.max(prev - 1, 0));
  }, []);

  const handleJumpToStep = useCallback(
    (index: number) => {
      if (index > createStep) {
        return;
      }
      setError(null);
      setCreateStep(index);
    },
    [createStep],
  );

  const handleRegisterAgent = async () => {
    if (registering) {
      return;
    }
    if (!isReviewStep) {
      setCreateStep(totalCreateSteps - 1);
      return;
    }
    if (!validateCurrentStep()) {
      return;
    }
    try {
      setError(null);
      setSuccess(null);
      startRegistrationProgress();

      if (!privateKeyMode) {
        const ready = await synchronizeProvidersWithChain(selectedChainId);
        if (!ready) {
          resetRegistrationProgress();
          setError('Unable to switch wallet provider to the selected chain. Please switch manually in your wallet and retry.');
          return;
        }
        // Ensure provider is authorized before any core calls
        try {
          if (eip1193Provider && typeof eip1193Provider.request === 'function') {
            // Switch to selected chain (if wallet supports it)
            const chainIdHex = getChainIdHex(selectedChainId);
            try {
              const current = await eip1193Provider.request({ method: 'eth_chainId' }).catch(() => null);
              if (!current || current.toLowerCase() !== chainIdHex.toLowerCase()) {
                await eip1193Provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
              }
            } catch {
              // ignore; core will also attempt chain selection
            }
            const accs = await eip1193Provider.request({ method: 'eth_accounts' }).catch(() => []);
            if (!Array.isArray(accs) || accs.length === 0) {
              await eip1193Provider.request({ method: 'eth_requestAccounts' });
            }
          }
        } catch {
          // ignore; core will also attempt authorization
        }
      }

      // Use the agent account from the form by default
      let agentAccountToUse = createForm.agentAccount as `0x${string}`;

      // If using AA, compute or confirm the AA address
      if (useAA) {
        if (privateKeyMode) {
          // Private key mode: prefer already-computed AA address from state,
          // otherwise call the server-side endpoint to compute it.
          let computedAa = aaAddress;

          if (!computedAa) {
            const resp = await fetch('/api/accounts/counterfactual-account', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agentName: createForm.agentName,
                chainId: selectedChainId || undefined,
              }),
            });

            if (!resp.ok) {
              const err = await resp.json().catch(() => ({}));
              throw new Error(
                err?.message ||
                  err?.error ||
                  'Server-side AA address computation failed. Ensure private key mode is configured.',
              );
            }

            const data = await resp.json();
            computedAa = (data?.address as string) || '';
          }

          if (!computedAa || !computedAa.startsWith('0x')) {
            throw new Error('Failed to compute AA address. Please retry.');
          }

          setAaAddress(computedAa);
          agentAccountToUse = computedAa as `0x${string}`;
          setSuccess('Using Account Abstraction address (server-side)…');
        } else {
          // Wallet mode: compute AA address using wallet provider (client-side)
          if (!eip1193Provider) {
            throw new Error('Wallet provider is required to compute AA address. Please connect your wallet.');
          }
          if (!eoaAddress) {
            throw new Error('EOA address is required to compute AA address.');
          }

          const computedAa = await getCounterfactualAAAddressByAgentName(
            createForm.agentName,
            eoaAddress as `0x${string}`,
            {
              ethereumProvider: eip1193Provider as any,
              chain: CHAIN_OBJECTS[selectedChainId] ?? CHAIN_OBJECTS[DEFAULT_CHAIN_ID],
            },
          );
          if (!computedAa || !computedAa.startsWith('0x')) {
            throw new Error('Failed to compute AA address. Please retry.');
          }
          setAaAddress(computedAa);
          agentAccountToUse = computedAa as `0x${string}`;
          setSuccess('Using Account Abstraction address...');
        }
      }

      // Validate agentAccountToUse before proceeding
      if (!agentAccountToUse || agentAccountToUse.trim() === '' || !agentAccountToUse.startsWith('0x')) {
        throw new Error('Agent account address is required. Please provide an agent account address or enable Account Abstraction.');
      }


      // Use Account Abstraction (AA) creation path
        if (privateKeyMode) {
          // Server-only path (admin private key signs on server)
          const directPlan = await createAgentDirect({
            mode: 'aa',
            agentName: createForm.agentName,
            agentAccount: agentAccountToUse,
            description: createForm.description || undefined,
            image: createForm.image || undefined,
            agentUrl: createForm.agentUrl || undefined,
            chainId: selectedChainId,
            ensOptions: {
              enabled: true,
              orgName: ensOrgName,
            },
          });

          if (directPlan.agentId) {
            setSuccess(`Agent created successfully! Agent ID: ${directPlan.agentId}, TX: ${directPlan.txHash}`);
          } else if (directPlan.txHash) {
            setSuccess(`Agent creation transaction confirmed! TX: ${directPlan.txHash} (Agent ID will be available after indexing)`);
          } else {
            setSuccess('Agent AA creation requested. Check server logs for details.');
          }
        } else {
          // Client path (requires connected wallet/provider)
        const result = await createAgentWithWallet({
          agentData: {
              agentName: createForm.agentName,
            agentAccount: agentAccountToUse,
            description: createForm.description || undefined,
            image: createForm.image || undefined,
            agentUrl: createForm.agentUrl || undefined,
          },
          account: eoaAddress as Address,
          ethereumProvider: eip1193Provider as any,
          onStatusUpdate: setSuccess,
          useAA: true,
              ensOptions: {
                enabled: true,
                orgName: ensOrgName,
              },
          chainId: selectedChainId,
        });

        if (result.agentId) {
          setSuccess(`Agent created successfully! Agent ID: ${result.agentId}, TX: ${result.txHash}`);
        } else {
          setSuccess(`Agent creation transaction confirmed! TX: ${result.txHash} (Agent ID will be available after indexing)`);
          }
        }
      

      
      
      setCreateForm({ agentName: '', agentAccount: '', description: '', image: getDefaultImageUrl(), agentUrl: '' });
      setAaAddress(null);
      setCreateStep(0);
      setProtocolSettings({ publishA2A: true, publishMcp: true, a2aEndpoint: '', mcpEndpoint: '' });

      setRegisterProgress(100);
      if (registerTimerRef.current) {
        clearInterval(registerTimerRef.current);
        registerTimerRef.current = null;
      }
      setTimeout(() => {
        resetRegistrationProgress();
        router.push('/agents');
      }, 800);
    } catch (err) {
      console.error('Error creating agent:', err);
      resetRegistrationProgress();
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    }
  };

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

  const normalizedAgentBaseUrl = (createForm.agentUrl || '').trim().replace(/\/$/, '');
  const ipfsGateway = (process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs/').replace(/\/+$/, '');

  const imagePreviewUrl = useMemo(() => {
    const trimmed = (createForm.image || '').trim();
    if (!trimmed) {
      return '';
    }
    if (trimmed.startsWith('ipfs://')) {
      const cid = trimmed.replace('ipfs://', '').replace(/^\/+/, '');
      const base = ipfsGateway.replace(/\/+$/, '');
      return `${base}/${cid}`;
    }
    return trimmed;
  }, [createForm.image, ipfsGateway]);
  const handleImageUploadClick = () => {
    setImageUploadError(null);
    imageFileInputRef.current?.click();
  };

  const handleImageFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploadingImage(true);
    setImageUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch('/api/ipfs/upload', {
        method: 'POST',
        body: formData,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || body?.message || 'Upload failed');
      }
      setCreateForm(prev => ({
        ...prev,
        image: body?.tokenUri || body?.url || prev.image,
      }));
    } catch (uploadError) {
      console.error('Image upload failed', uploadError);
      setImageUploadError(
        uploadError instanceof Error ? uploadError.message : 'Image upload failed. Please try again.',
      );
    } finally {
      setUploadingImage(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };
  const defaultA2AEndpoint = normalizedAgentBaseUrl ? `${normalizedAgentBaseUrl}/.well-known/agent-card.json` : '';
  const defaultMcpEndpoint = normalizedAgentBaseUrl ? `${normalizedAgentBaseUrl}/mcp` : '';
  const previousDefaultsRef = useRef({ a2a: '', mcp: '' });

  useEffect(() => {
    const prevDefaults = previousDefaultsRef.current;
    setProtocolSettings(prev => {
      const next: typeof prev = { ...prev };
      let changed = false;
      if (prev.publishA2A && defaultA2AEndpoint) {
        const shouldUpdate = !prev.a2aEndpoint || prev.a2aEndpoint === prevDefaults.a2a;
        if (shouldUpdate) {
          next.a2aEndpoint = defaultA2AEndpoint;
          changed = true;
        }
      }
      if (prev.publishMcp && defaultMcpEndpoint) {
        const shouldUpdate = !prev.mcpEndpoint || prev.mcpEndpoint === prevDefaults.mcp;
        if (shouldUpdate) {
          next.mcpEndpoint = defaultMcpEndpoint;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    previousDefaultsRef.current = { a2a: defaultA2AEndpoint, mcp: defaultMcpEndpoint };
  }, [defaultA2AEndpoint, defaultMcpEndpoint]);

  const renderStepContent = () => {
    switch (createStep) {
      case 0:
        return (
          <>
            <div style={{ marginBottom: '1rem', display: 'inline-block' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Chain
              </label>
              <select
                value={selectedChainId}
                onChange={(e) => {
                  const nextChainId = Number(e.target.value);
                  const nextMetadata = CHAIN_METADATA[nextChainId];
                  console.info(
                    '[chain] UI selected chain',
                    nextChainId,
                    nextMetadata?.displayName || nextMetadata?.chainName || '',
                  );
                  setSelectedChainId(nextChainId);
                  setEnsAvailable(null);
                  setAaAddress(null);
                  synchronizeProvidersWithChain(nextChainId);
                }}
                style={{
                  padding: '0.5rem 1.75rem 0.5rem 0.75rem',
                  border: '1px solid #dcdcdc',
                  borderRadius: '8px',
                  minWidth: '220px',
                  width: 'auto',
                }}
              >
                {(registerChainIds.length ? registerChainIds : supportedChainIds).map(chainId => {
                  const metadata = CHAIN_METADATA[chainId];
                  const label = metadata?.displayName || metadata?.chainName || `Chain ${chainId}`;
                  return (
                    <option key={chainId} value={chainId}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Name *
              </label>
              <input
                type="text"
                value={createForm.agentName}
                onChange={(e) => setCreateForm({ ...createForm, agentName: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.9rem', color: 'green', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace' }}>
                  {ensFullNamePreview || 'Enter an agent name to check ENS availability'}
                </span>
                <span style={{ fontSize: '0.85rem', color: ensChecking ? '#4f4f4f' : (ensAvailable === true ? '#2a2a2a' : (ensAvailable === false ? '#5a5a5a' : '#4f4f4f')) }}>
                  {ensChecking
                    ? 'Checking...'
                    : ensAvailable === true
                      ? 'Available'
                      : ensAvailable === false
                        ? 'Not available'
                        : 'Awaiting input'}
                </span>
              </div>
              <div style={{ marginTop: '0.25rem' }}>
                {didEnsPreview && (
                  <div style={{ fontSize: '0.8rem', color: '#6a6a6a', marginBottom: '0.1rem' }}>
                    <span style={{ fontFamily: 'monospace' }}>{didEnsPreview}</span>
                  </div>
                )}
                {didEthrPreview && (
                  <div style={{ fontSize: '0.8rem', color: '#6a6a6a', marginBottom: '0' }}>
                    <span style={{ fontFamily: 'monospace' }}>{didEthrPreview}</span>
                  </div>
                )}
              </div>
              {ensAvailable === false && ensExisting && (
                <div style={{ marginTop: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '6px', padding: '0.5rem', backgroundColor: '#f7f7f7' }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {ensExisting.image && (
                      <img src={ensExisting.image} alt="ENS avatar" style={{ height: '40px', width: 'auto', borderRadius: '6px' }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontFamily: 'monospace', color: '#2a2a2a' }}>{ensFullNamePreview}</span>
                      {ensExisting.url && (
                        <a href={ensExisting.url} target="_blank" rel="noreferrer" style={{ color: '#2a2a2a', textDecoration: 'underline', fontSize: '0.85rem' }}>
                          {ensExisting.url}
                        </a>
                      )}
                      {ensExisting.description && (
                        <span style={{ fontSize: '0.85rem', color: '#4f4f4f' }}>{ensExisting.description}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 'bold' }}>
                Agent Account (auto-assigned)
              </label>
              <div
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  border: '1px solid #dcdcdc',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  backgroundColor: '#f6f6f6',
                  color: '#1f1f1f',
                  minHeight: '44px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {useAA
                  ? aaAddress || (createForm.agentName ? 'Generating smart account...' : 'Enter an agent name to generate address')
                  : createForm.agentAccount || eoaAddress || 'Connect a wallet to populate owner address'}
              </div>
              {aaComputing && (
                <p style={{ marginTop: '0.3rem', fontSize: '0.85rem', color: '#2f2f2f' }}>
                  Computing smart account address from agent name...
                </p>
              )}
              {existingAgentInfo && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#505050' }}>
                  Existing agent detected at <span style={{ fontFamily: 'monospace' }}>{existingAgentInfo?.account}</span>
                  {existingAgentInfo?.method ? ` (resolved via ${existingAgentInfo.method})` : ''}. Creating a new agent will overwrite on-chain metadata for this name.
                </p>
              )}
            </div>
          </>
        );
      case 1:
        return (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Description *
              </label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                rows={3}
                placeholder="A natural language description of the agent..."
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Image *
              </label>
              <input
                type="url"
                value={createForm.image}
                onChange={(e) => setCreateForm({ ...createForm, image: e.target.value })}
                placeholder="https://example.com/agent-image.png"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="file"
                  accept="image/*"
                  ref={imageFileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleImageFileSelected}
                />
                <button
                  type="button"
                  onClick={handleImageUploadClick}
                  disabled={uploadingImage}
                  style={{
                    padding: '0.45rem 0.9rem',
                    borderRadius: '6px',
                    border: '1px solid #dcdcdc',
                    backgroundColor: uploadingImage ? '#e0e0e0' : '#f9f9f9',
                    color: '#2a2a2a',
                    fontWeight: 600,
                    cursor: uploadingImage ? 'not-allowed' : 'pointer',
                  }}
                >
                  {uploadingImage ? 'Uploading…' : 'Upload & pin image'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImageUploadError(null);
                    setImagePreviewError(false);
                    setCreateForm(prev => ({ ...prev, image: getDefaultImageUrl() }));
                  }}
                  style={{
                    padding: '0.45rem 0.9rem',
                    borderRadius: '6px',
                    border: '1px solid #dcdcdc',
                    backgroundColor: '#f9f9f9',
                    color: '#2a2a2a',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Use default image
                </button>
                {imageUploadError && (
                  <span style={{ color: '#a33c3c', fontSize: '0.85rem' }}>{imageUploadError}</span>
                )}
              </div>
              {imagePreviewUrl && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    border: '1px solid #dcdcdc',
                    borderRadius: '8px',
                    padding: '0.5rem',
                    backgroundColor: '#f6f6f6',
                    display: 'inline-block',
                  }}
                >
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4f4f4f' }}>Preview</p>
                  {!imagePreviewError ? (
                    <img
                      src={imagePreviewUrl}
                      alt="Agent preview"
                      style={{ height: '100px', width: 'auto', borderRadius: '6px' }}
                      onLoad={handleImagePreviewLoad}
                      onError={handleImagePreviewError}
                    />
                  ) : (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#3a3a3a' }}>
                      Unable to load preview. Please check the image URL.
                    </p>
                  )}
                </div>
              )}
            </div>
            <p style={{ marginTop: '0.5rem', marginBottom: '0', fontSize: '0.85rem', color: '#666666' }}>
              Registration JSON will be automatically created and uploaded to IPFS per ERC-8004 specification.
            </p>
          </>
        );
      case 2:
        return (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent URL (Base URL for A2A and MCP endpoints) *
              </label>
              <input
                type="url"
                value={createForm.agentUrl}
                onChange={(e) => setCreateForm({ ...createForm, agentUrl: e.target.value })}
                placeholder="https://agent.example.com"
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #dcdcdc', borderRadius: '4px' }}
              />
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#666666' }}>
                This base URL seeds the default A2A (`/.well-known/agent-card.json`) and MCP (`/mcp`) endpoints below.
              </p>
            </div>
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f6f6f6', borderRadius: '8px', border: '1px solid #dcdcdc' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={protocolSettings.publishA2A}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setProtocolSettings(prev => ({
                      ...prev,
                      publishA2A: checked,
                      a2aEndpoint: checked
                        ? prev.a2aEndpoint || defaultA2AEndpoint || prev.a2aEndpoint
                        : prev.a2aEndpoint,
                    }));
                  }}
                />
                <span style={{ fontWeight: 600 }}>A2A Protocol Endpoint</span>
              </label>
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#4f4f4f' }}>
                {defaultA2AEndpoint
                  ? `Default: ${defaultA2AEndpoint}`
                  : 'Set an Agent URL above to preview the agent card endpoint.'}
              </p>
              {protocolSettings.publishA2A && (
                <div style={{ marginTop: '0.75rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                    Endpoint URL
                  </label>
                  <input
                    type="url"
                    value={protocolSettings.a2aEndpoint}
                    onChange={(e) =>
                      setProtocolSettings(prev => ({ ...prev, a2aEndpoint: e.target.value }))
                    }
                    placeholder={defaultA2AEndpoint || 'https://agent.example.com/.well-known/agent-card.json'}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d7d7d7', borderRadius: '6px' }}
                  />
                </div>
              )}
            </div>
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f6f6f6', borderRadius: '8px', border: '1px solid #f6f6f6' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={protocolSettings.publishMcp}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setProtocolSettings(prev => ({
                      ...prev,
                      publishMcp: checked,
                      mcpEndpoint: checked
                        ? prev.mcpEndpoint || defaultMcpEndpoint || prev.mcpEndpoint
                        : prev.mcpEndpoint,
                    }));
                  }}
                />
                <span style={{ fontWeight: 600 }}>MCP Protocol Endpoint</span>
              </label>
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#4c4c4c' }}>
                {defaultMcpEndpoint
                  ? `Default: ${defaultMcpEndpoint}`
                  : 'Set an Agent URL above to preview the MCP endpoint.'}
              </p>
              {protocolSettings.publishMcp && (
                <div style={{ marginTop: '0.75rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                    Endpoint URL
                  </label>
                  <input
                    type="url"
                    value={protocolSettings.mcpEndpoint}
                    onChange={(e) =>
                      setProtocolSettings(prev => ({ ...prev, mcpEndpoint: e.target.value }))
                    }
                    placeholder={defaultMcpEndpoint || 'https://agent.example.com/mcp'}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d7d7d7', borderRadius: '6px' }}
                  />
                </div>
              )}
            </div>
          </>
        );
      case 3: {
        return (
          <>
            <div style={{ border: '1px solid #dcdcdc', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', backgroundColor: '#f6f6f6' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#1f1f1f' }}>Agent Overview</h3>
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}><strong>Chain:</strong> {CHAIN_METADATA[selectedChainId]?.displayName || selectedChainId}</p>
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}><strong>Name:</strong> {createForm.agentName || '—'}</p>

              {didEnsPreview && (
                <p style={{ margin: '0.15rem 0', color: '#4f4f4f' }}>
                  
                  <span style={{ fontFamily: 'monospace' }}>{didEnsPreview}</span>
                </p>
              )}
              {didEthrPreview && (
                <p style={{ margin: '0.15rem 0', color: '#4f4f4f' }}>
                  
                  <span style={{ fontFamily: 'monospace' }}>{didEthrPreview}</span>
                </p>
              )}
              {imagePreviewUrl && (
                <div
                  style={{
                    margin: '0.75rem 0',
                    borderRadius: '10px',
                    border: '1px solid #dcdcdc',
                    overflow: 'hidden',
                    backgroundColor: '#fff',
                  }}
                >
                  {!imagePreviewError ? (
                    <img
                      src={imagePreviewUrl}
                      alt="Agent preview"
                      style={{ height: '80px', width: 'auto', display: 'block' }}
                      onLoad={handleImagePreviewLoad}
                      onError={handleImagePreviewError}
                    />
                  ) : (
                    <p style={{ margin: '0.75rem', color: '#3a3a3a', fontSize: '0.9rem' }}>
                      Unable to load agent image preview.
                    </p>
                  )}
                </div>
              )}
              <p style={{ margin: '0.25rem 0', color: '#4f4f4f' }}><strong>Description:</strong> {createForm.description || '—'}</p>
            </div>
            <div style={{ border: '1px solid #dcdcdc', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', backgroundColor: '#f6f6f6' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#2f2f2f' }}>Protocols</h3>
              <p style={{ margin: '0.25rem 0', color: '#2f2f2f' }}>
                <strong>Agent Card:</strong> {protocolSettings.publishA2A ? protocolSettings.a2aEndpoint || defaultA2AEndpoint || 'Pending Agent URL' : 'Disabled'}
              </p>
              <p style={{ margin: '0.25rem 0', color: '#2f2f2f' }}>
                <strong>MCP:</strong> {protocolSettings.publishMcp ? protocolSettings.mcpEndpoint || defaultMcpEndpoint || 'Pending Agent URL' : 'Disabled'}
              </p>
            </div>
            <p style={{ marginTop: '1rem', fontSize: '0.95rem', color: '#4f4f4f' }}>
              Review the details above. When ready, click <strong>Register Agent</strong> to publish this agent to the selected chain.
            </p>
          </>
        );
      }
      default:
        return null;
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
        {isEditMode && showManagementPanes && (
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
            <div
              style={{
                margin: '0.75rem 0',
                borderTop: '1px solid #e2e2e2',
              }}
            />
            <button
              type="button"
              onClick={() => setActiveManagementTab('create')}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: activeManagementTab === 'create' ? '#2f2f2f' : '#dcdcdc',
                backgroundColor: activeManagementTab === 'create' ? '#f3f3f3' : '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Register Agent
            </button>
          </nav>
        )}

        {/* Right-hand content (or full grid when not in edit mode) */}
        {showCreatePane && (!isEditMode || activeManagementTab === 'create') && (
        <div
          style={{
            gridColumn: showManagementPanes ? '1 / -1' : 'auto',
            padding: isMobile ? '0' : '1.5rem',
            backgroundColor: isMobile ? 'transparent' : '#fff',
            borderRadius: isMobile ? '0' : '8px',
            border: isMobile ? 'none' : '1px solid #dcdcdc',
          }}
        >
          {!isMobile && <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Agent Registration</h2>}
          <form onSubmit={(event) => event.preventDefault()}>
            <div style={{ display: 'flex', gap: isMobile ? '0.35rem' : '0.5rem', flexWrap: isMobile ? 'nowrap' : 'wrap', marginBottom: isMobile ? '0.75rem' : '1.0rem', overflowX: isMobile ? 'auto' : undefined }}>
              {CREATE_STEPS.map((label, index) => {
                const isActive = index === createStep;
                const isComplete = index < createStep;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => handleJumpToStep(index)}
                    disabled={index > createStep}
                    style={{
                      flex: isMobile ? '1 1 0' : '1 1 140px',
                      minWidth: isMobile ? '0' : '140px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      padding: isMobile ? '0.4rem 0.6rem' : '0.5rem 0.75rem',
                      borderRadius: '999px',
                      border: '1px solid',
                      borderColor: isActive ? '#2f2f2f' : isComplete ? '#3c3c3c' : '#dcdcdc',
                      backgroundColor: isActive ? '#f3f3f3' : isComplete ? '#f4f4f4' : '#fff',
                      color: isActive ? '#2f2f2f' : isComplete ? '#3c3c3c' : '#4f4f4f',
                      fontWeight: 600,
                      fontSize: isMobile ? '0.85rem' : '1rem',
                      whiteSpace: 'nowrap',
                      cursor: index > createStep ? 'not-allowed' : 'pointer',
                      opacity: index > createStep ? 0.6 : 1,
                    }}
                  >
                    {!isMobile && (
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>{index + 1}.</span>
                    )}
                    <span style={{ fontSize: isMobile ? '0.85rem' : '1rem' }}>{getStepLabel(label)}</span>
                  </button>
                );
              })}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: isMobile ? '0.5rem' : '1rem',
                padding: isMobile ? '0.5rem' : '1.25rem',
                border: isMobile ? 'none' : '1px solid #dcdcdc',
                borderRadius: isMobile ? '0' : '12px',
                backgroundColor: isMobile ? 'transparent' : '#f8f8f8',
              }}
            >
              {renderStepContent()}
            </div>
            <div
              style={{
                marginTop: isMobile ? '0.75rem' : '1.5rem',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap',
              }}
            >
              {createStep > 0 && (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  style={{
                    flex: '1 1 160px',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #dcdcdc',
                    backgroundColor: '#fff',
                    color: '#2a2a2a',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Back
                </button>
              )}
              {!isReviewStep ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={!isCurrentStepValid}
                  style={{
                    flex: '1 1 200px',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: isCurrentStepValid ? '#2f2f2f' : '#929292',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: isCurrentStepValid ? 'pointer' : 'not-allowed',
                    opacity: isCurrentStepValid ? 1 : 0.6,
                  }}
                >
                  Next: {getStepLabel(CREATE_STEPS[createStep + 1])}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRegisterAgent}
                  disabled={registering}
                  style={{
                    flex: '1 1 240px',
                    padding: '0.85rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: registering ? '#787878' : '#2f2f2f',
                    color: '#fff',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    cursor: registering ? 'not-allowed' : 'pointer',
                    opacity: registering ? 0.7 : 1,
                  }}
                >
                  {isMobile ? 'Register' : 'Agent Registration'}
                </button>
              )}
            </div>
            {registering && (
              <div style={{ width: '100%', marginTop: '1rem' }}>
                <div
                  style={{
                    height: '8px',
                    borderRadius: '999px',
                    backgroundColor: '#dedede',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${registerProgress}%`,
                      height: '100%',
                      backgroundColor: '#2a2a2a',
                      transition: 'width 0.2s ease',
                    }}
                  />
                </div>
                <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#4f4f4f' }}>
                  Registering agent… {Math.round(registerProgress)}%
                </p>
              </div>
            )}
          </form>
        </div>
        )}

        {showManagementPanes && (!isEditMode || activeManagementTab === 'agentInfo') && (
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
        {showManagementPanes && (!isEditMode || activeManagementTab === 'registration') && (
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
        {showManagementPanes && (!isEditMode || activeManagementTab === 'delete') && (
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

        {showManagementPanes && (!isEditMode || activeManagementTab === 'session') && (
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
        {showManagementPanes && (!isEditMode || activeManagementTab === 'transfer') && (
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
      </div>


          </>
        )}

    </main>
    </>
  );
}

