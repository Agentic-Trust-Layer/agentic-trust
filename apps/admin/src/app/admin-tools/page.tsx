'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Tabs, Tab, Box, Grid, Paper, Typography, Button, TextField, Alert, CircularProgress, Divider } from '@mui/material';
import { useWallet } from '@/components/WalletProvider';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import type { Address, Chain } from 'viem';
import { keccak256, toHex } from "viem";
import { buildDid8004, parseDid8004, generateSessionPackage, getDeployedAccountClientByAgentName, updateAgentRegistrationWithWallet, requestENSValidationWithWallet } from '@agentic-trust/core';
import type { DiscoverParams as AgentSearchParams, DiscoverResponse, ValidationStatus } from '@agentic-trust/core/server';
import {
  getSupportedChainIds,
  getChainDisplayMetadata,
  getChainById,
  DEFAULT_CHAIN_ID,
  getChainBundlerUrl,
} from '@agentic-trust/core/server';
import { getClientBundlerUrl, getClientChainEnv } from '@/lib/clientChainEnv';
type Agent = DiscoverResponse['agents'][number];
type ValidationStatusWithHash = ValidationStatus & { requestHash?: string };
type ValidatorAgentDetailsState = {
  loading: boolean;
  error: string | null;
  agent: Record<string, any> | null;
};

const CHAIN_SUFFIX_MAP: Record<number, string> = {
  11155111: 'SEPOLIA',
  84532: 'BASE_SEPOLIA',
  11155420: 'OPTIMISM_SEPOLIA',
};

const shortenHex = (value: string | null | undefined, leading = 6, trailing = 4): string => {
  if (!value) return 'N/A';
  if (value.length <= leading + trailing) return value;
  return `${value.slice(0, leading)}…${value.slice(-trailing)}`;
};

const formatValidationTimestamp = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'Unknown';
  }
  const numeric =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'number'
        ? value
        : Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'Unknown';
  }
  const date = new Date(numeric * 1000);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString();
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
  const pathname = usePathname();
  
  // Extract DID from pathname if it matches /admin-tools/[encoded-did]
  const pathDidMatch = pathname?.match(/^\/admin-tools\/(.+)$/);
  const pathDid = pathDidMatch ? pathDidMatch[1] : null;
  
  // Support both old format (?agentId=X&chainId=Y) and new format (encoded DID in path)
  const queryAgentId = searchParams?.get('agentId') ?? null;
  const queryChainId = searchParams?.get('chainId') ?? null;
  const queryAgentAddress = searchParams?.get('agentAccount') ?? null;
  const queryAgent = searchParams?.get('agent') ?? null; // Legacy query param format
  const queryTab = searchParams?.get('tab') ?? 'agentInfo';
  
  // Prefer path DID over query params
  const didSource = pathDid ?? queryAgent;
  const isEditMode = (queryAgentId !== null && queryChainId !== null) || didSource !== null;
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

  const parsedQueryChainId = useMemo(() => {
    if (!queryChainId) return null;
    const parsed = Number.parseInt(queryChainId, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }, [queryChainId]);

  const selectedAgentDid8004 = useMemo(() => {
    if (!parsedQueryChainId || !queryAgentId) return null;
    try {
      return buildDid8004(parsedQueryChainId, queryAgentId);
    } catch {
      return null;
    }
  }, [parsedQueryChainId, queryAgentId]);
  const providerA2aEndpoint = process.env.NEXT_PUBLIC_PROVIDER_A2A_URL || '';

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
  // Parse DID from path or query if present
  let parsedDid: { chainId: number; agentId: string } | null = null;
  if (didSource) {
    try {
      let decoded = didSource;
      // Handle double-encoding
      while (decoded.includes('%')) {
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
        } catch {
          break;
        }
      }
      parsedDid = parseDid8004(decoded);
    } catch (error) {
      console.error('Failed to parse DID:', error);
    }
  }
  
  // Use parsed DID or fall back to query params
  const effectiveAgentId = parsedDid?.agentId?.toString() ?? queryAgentId;
  const effectiveChainId = parsedDid?.chainId?.toString() ?? queryChainId;
  
  // Update queryAgentId/queryChainId to use effective values for backward compatibility
  const finalAgentId = effectiveAgentId ?? queryAgentId;
  const finalChainId = effectiveChainId ?? queryChainId;
  
  // State for fetched agent info (name, address, etc) when navigating via DID
  const [fetchedAgentInfo, setFetchedAgentInfo] = useState<Record<string, any> | null>(null);

  // Fetch agent info if we have ID/Chain but missing details (e.g. via DID route)
  useEffect(() => {
    if (isEditMode && finalAgentId && finalChainId && (!queryAgentAddress || !searchParams?.get('agentName'))) {
      const fetchAgentInfo = async () => {
        try {
          const did8004 = buildDid8004(Number(finalChainId), finalAgentId);
          const response = await fetch(`/api/agents/${encodeURIComponent(did8004)}`);
          if (response.ok) {
            const data = await response.json();
            setFetchedAgentInfo(data);
          }
        } catch (err) {
          console.error('Failed to fetch agent info:', err);
        }
      };
      fetchAgentInfo();
    }
  }, [isEditMode, finalAgentId, finalChainId, queryAgentAddress, searchParams]);

  const displayAgentName = searchParams?.get('agentName') ?? fetchedAgentInfo?.agentName ?? '...';
  const displayAgentAddress = queryAgentAddress ?? fetchedAgentInfo?.agentAccount ?? null;

  const [activeManagementTab, setActiveManagementTab] = useState<
    | 'agentInfo'
    | 'registration'
    | 'session'
    | 'delete'
    | 'transfer'
    | 'validation'
    | 'agentValidation'
  >((queryTab as any) || 'agentInfo');
  
  // Update URL when tab changes
  const handleTabChange = useCallback((tab: typeof activeManagementTab) => {
    setActiveManagementTab(tab);
    if (isEditMode && effectiveAgentId && effectiveChainId) {
      const did8004 = buildDid8004(Number(effectiveChainId), effectiveAgentId);
      const newUrl = `/admin-tools/${encodeURIComponent(did8004)}?tab=${tab}`;
      router.push(newUrl);
    } else if (isEditMode && didSource) {
      const newUrl = `/admin-tools/${didSource}?tab=${tab}`;
      router.push(newUrl);
    }
  }, [isEditMode, effectiveAgentId, effectiveChainId, didSource, router]);
  
  // Sync tab from URL
  useEffect(() => {
    if (queryTab && queryTab !== activeManagementTab) {
      setActiveManagementTab(queryTab as any);
    }
  }, [queryTab, activeManagementTab]);
 
  const handleGenerateSessionPackage = useCallback(
    async () => {
      if (!isEditMode || !finalAgentId || !finalChainId || !displayAgentAddress) {
        return;
      }

      try {
        setSessionPackageError(null);
        setSessionPackageLoading(true);
        setSessionPackageText(null);

        if (!eip1193Provider || !headerAddress) {
          throw new Error('Wallet not connected. Connect your wallet to generate a session package.');
        }

        const parsedChainId = Number.parseInt(finalChainId, 10);
        if (!Number.isFinite(parsedChainId)) {
          throw new Error('Invalid chainId in URL');
        }

        const agentIdNumeric = Number.parseInt(finalAgentId, 10);
        if (!Number.isFinite(agentIdNumeric)) {
          throw new Error('Agent ID is invalid.');
        }

        const chainEnv = getClientChainEnv(parsedChainId);
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

        const pkg = await generateSessionPackage({
          agentId: agentIdNumeric,
          chainId: parsedChainId,
          agentAccount: displayAgentAddress as `0x${string}`,
          provider: eip1193Provider,
          ownerAddress: headerAddress as `0x${string}`,
          rpcUrl: chainEnv.rpcUrl,
          bundlerUrl: chainEnv.bundlerUrl,
          identityRegistry: chainEnv.identityRegistry,
          reputationRegistry: chainEnv.reputationRegistry,
          validationRegistry: chainEnv.validationRegistry,
        });

        setSessionPackageText(JSON.stringify(pkg, null, 2));

        try {
          await fetch(
            `/api/agents/${encodeURIComponent(buildDid8004(parsedChainId, agentIdNumeric))}/refresh`,
            { method: 'POST' },
          );
        } catch (refreshError) {
          console.warn('Agent refresh failed after registration update:', refreshError);
        }
      } catch (error: any) {
        console.error('Error creating session package (admin-tools):', error);
        setSessionPackageError(
          error?.message ?? 'Failed to create session package. Please try again.',
        );
      } finally {
        setSessionPackageLoading(false);
      }
    },
    [isEditMode, finalAgentId, finalChainId, displayAgentAddress, eip1193Provider, headerAddress],
  );

  const refreshAgentValidationRequests = useCallback(async () => {
    // Parse chain ID from finalChainId if available, otherwise fallback
    const effectiveParsedChainId = finalChainId ? Number.parseInt(finalChainId, 10) : null;
    const targetChainId = Number.isFinite(effectiveParsedChainId) ? effectiveParsedChainId : parsedQueryChainId;

    if (!isEditMode || !displayAgentAddress || !targetChainId) {
      setAgentValidationRequests({
        loading: false,
        error: isEditMode ? 'Select an agent with account address to view validation requests.' : null,
        requests: [],
      });
      return;
    }

    setAgentValidationRequests((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      const response = await fetch(
        `/api/validations/by-validator?chainId=${targetChainId}&validatorAddress=${encodeURIComponent(displayAgentAddress)}`
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load validation requests');
      }

      const data = await response.json();
      const requests = Array.isArray(data.validations) ? (data.validations as ValidationStatusWithHash[]) : [];
      
      // Fetch agent information for each validation request
      const requestsWithAgents = await Promise.all(
        requests.map(async (req) => {
          const agentId = req.agentId?.toString();
          if (!agentId) return { ...req, requestingAgent: null };

          const cacheKey = `${targetChainId}-${agentId}`;
          const cached = requestingAgentCacheRef.current.get(cacheKey);
          if (cached) {
            return { ...req, requestingAgent: cached };
          }

          try {
            const did8004 = buildDid8004(targetChainId as number, agentId);
            const agentResponse = await fetch(`/api/agents/${encodeURIComponent(did8004)}`);
            if (agentResponse.ok) {
              const agentData = await agentResponse.json();
              requestingAgentCacheRef.current.set(cacheKey, agentData);
              return { ...req, requestingAgent: agentData };
            }
          } catch (error) {
            console.warn(`Failed to fetch agent ${agentId}:`, error);
          }
          return { ...req, requestingAgent: null };
        })
      );

      setAgentValidationRequests({
        loading: false,
        error: null,
        requests: requestsWithAgents,
      });
    } catch (error: any) {
      setAgentValidationRequests({
        loading: false,
        error: error?.message ?? 'Failed to load validation requests',
        requests: [],
      });
    }
  }, [isEditMode, displayAgentAddress, finalChainId, parsedQueryChainId]);
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
        <Button
          variant="contained"
          onClick={openLoginModal}
          sx={{
            py: 1.5,
            px: 4,
            borderRadius: 999,
            bgcolor: 'grey.800',
            '&:hover': { bgcolor: 'grey.900' },
            fontWeight: 600,
          }}
        >
          Connect to Continue
        </Button>
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
    if (!isEditMode || activeManagementTab !== 'registration' || !finalAgentId || !finalChainId) {
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

        const parsedChainId = Number.parseInt(finalChainId, 10);
        if (!Number.isFinite(parsedChainId)) {
          throw new Error('Invalid chainId in URL');
        }

        const did8004 = buildDid8004(parsedChainId, finalAgentId);
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
    finalAgentId,
    finalChainId,
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
      if (!isEditMode || !finalAgentId || !finalChainId) {
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

        const parsedChainId = Number.parseInt(finalChainId, 10);
        if (!Number.isFinite(parsedChainId)) {
          setRegistrationEditError('Invalid chainId in URL.');
          return;
        }

        const chain = getChainById(parsedChainId) as Chain;
        // Read bundler URL from a shared client-side helper (NEXT_PUBLIC_* env vars)
        const bundlerEnv = getClientBundlerUrl(parsedChainId);
        if (!bundlerEnv) {
          setRegistrationEditError(
            'Missing bundler URL configuration for this chain. Set NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_* env vars.',
          );
          return;
        }

        setRegistrationEditSaving(true);

        const did8004 = buildDid8004(parsedChainId, finalAgentId);
        const agentNameForAA = displayAgentName === '...' ? '' : displayAgentName;

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
      finalAgentId,
      finalChainId,
      eip1193Provider,
      headerAddress,
      displayAgentName,
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
  const [agentValidationRequests, setAgentValidationRequests] = useState<{
    loading: boolean;
    error: string | null;
    requests: Array<ValidationStatusWithHash & { requestingAgent?: Record<string, any> }>;
  }>({
    loading: false,
    error: null,
    requests: [],
  });
  const requestingAgentCacheRef = useRef<Map<string, Record<string, any>>>(new Map());
  const [validationActionLoading, setValidationActionLoading] = useState<Record<string, boolean>>({});
  const [validationActionFeedback, setValidationActionFeedback] = useState<Record<string, {
    type: 'success' | 'error';
    message: string;
  }>>({});
  
  // A2A endpoint validation state
  const [a2aEndpointData, setA2aEndpointData] = useState<{
    loading: boolean;
    error: string | null;
    tokenUri: string | null;
    a2aEndpoint: string | null;
    validation: {
      verified: boolean;
      hasSkill: boolean;
      skillName?: string;
      error?: string;
    } | null;
  }>({
    loading: false,
    error: null,
    tokenUri: null,
    a2aEndpoint: null,
    validation: null,
  });

  // NFT Operator state
  const [nftOperator, setNftOperator] = useState<{
    loading: boolean;
    error: string | null;
    operatorAddress: string | null;
  }>({
    loading: false,
    error: null,
    operatorAddress: null,
  });

  useEffect(() => {
    if (!isEditMode || !finalAgentId || !finalChainId) {
      return;
    }
    const parsedChainId = Number(finalChainId);
    if (!Number.isFinite(parsedChainId)) {
      return;
    }
    setUpdateForm({
      agentId: finalAgentId,
      chainId: finalChainId,
      tokenUri: '',
      metadataKey: '',
      metadataValue: '',
    });
    setDeleteForm({
      agentId: finalAgentId,
      chainId: finalChainId,
    });
    setTransferForm({
      agentId: finalAgentId,
      chainId: finalChainId,
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

  useEffect(() => {
    if (!isEditMode || activeManagementTab !== 'agentValidation') {
      return;
    }
    refreshAgentValidationRequests();
  }, [isEditMode, activeManagementTab, refreshAgentValidationRequests]);

  // Fetch NFT operator when agentInfo tab is active
  useEffect(() => {
    if (!isEditMode || activeManagementTab !== 'agentInfo' || !finalAgentId || !finalChainId) {
      setNftOperator({
        loading: false,
        error: null,
        operatorAddress: null,
      });
      return;
    }

    let cancelled = false;
    setNftOperator((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const did8004 = buildDid8004(Number(finalChainId), finalAgentId);
        const response = await fetch(`/api/agents/${encodeURIComponent(did8004)}/operator`);
        
        if (cancelled) return;
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to fetch NFT operator');
        }

        const data = await response.json();
        if (cancelled) return;

        setNftOperator({
          loading: false,
          error: null,
          operatorAddress: data.operatorAddress || null,
        });
      } catch (error: any) {
        if (cancelled) return;
        setNftOperator({
          loading: false,
          error: error?.message || 'Failed to fetch NFT operator',
          operatorAddress: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEditMode, activeManagementTab, queryAgentId, queryChainId]);

  // Fetch A2A endpoint data when agentValidation tab is active
  useEffect(() => {
    if (!isEditMode || activeManagementTab !== 'agentValidation' || !finalAgentId || !finalChainId) {
      setA2aEndpointData({
        loading: false,
        error: null,
        tokenUri: null,
        a2aEndpoint: null,
        validation: null,
      });
      return;
    }

    let cancelled = false;
    setA2aEndpointData((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const did8004 = buildDid8004(Number(finalChainId), finalAgentId);
        const response = await fetch(`/api/agents/${encodeURIComponent(did8004)}/a2a-endpoint`);
        
        if (cancelled) return;
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to fetch A2A endpoint');
        }

        const data = await response.json();
        if (cancelled) return;

        setA2aEndpointData({
          loading: false,
          error: null,
          tokenUri: data.tokenUri || null,
          a2aEndpoint: data.a2aEndpoint || null,
          validation: data.validation || null,
        });
      } catch (error: any) {
        if (cancelled) return;
        setA2aEndpointData({
          loading: false,
          error: error?.message || 'Failed to fetch A2A endpoint',
          tokenUri: null,
          a2aEndpoint: null,
          validation: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEditMode, activeManagementTab, finalAgentId, finalChainId]);

  const handleSendValidationRequest = useCallback(async (validationRequest: ValidationStatusWithHash) => {
    if (!isEditMode || !finalAgentId || !finalChainId) {
      return;
    }
    
    const requestHash = validationRequest.requestHash;
    if (!requestHash) {
      setValidationActionFeedback((prev) => ({
        ...prev,
        [requestHash || 'unknown']: {
          type: 'error',
          message: 'Request hash is missing.',
        },
      }));
      return;
    }

    // Use the verified A2A endpoint from the verification process
    const agentA2aEndpoint = a2aEndpointData.a2aEndpoint;

    if (!agentA2aEndpoint) {
      setValidationActionFeedback((prev) => ({
        ...prev,
        [requestHash]: {
          type: 'error',
          message: a2aEndpointData.loading 
            ? 'A2A endpoint is still being verified. Please wait...'
            : a2aEndpointData.error
            ? `A2A endpoint verification failed: ${a2aEndpointData.error}`
            : 'Current agent A2A endpoint is not configured or verified.',
        },
      }));
      return;
    }

    setValidationActionLoading((prev) => ({ ...prev, [requestHash]: true }));
    setValidationActionFeedback((prev) => ({
      ...prev,
      [requestHash]: undefined as any,
    }));

    try {
      const requestingAgentId = validationRequest.agentId?.toString();
      // Use server-side proxy to avoid browser port restrictions (e.g., Chrome blocks port 6000)
      const response = await fetch('/api/a2a/send-validation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          a2aEndpoint: agentA2aEndpoint,
          skillId: 'agent.validation.respond',
          message: `Process validation request for agent ${requestingAgentId}`,
          payload: {
            agentId: requestingAgentId,
            chainId: Number(finalChainId),
            requestHash: requestHash,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || data?.response?.error || 'Validation request failed.');
      }
      setValidationActionFeedback((prev) => ({
        ...prev,
        [requestHash]: {
          type: 'success',
          message: 'Validation request sent successfully.',
        },
      }));
      // Refresh after a short delay
      setTimeout(() => {
        refreshAgentValidationRequests();
      }, 1000);
    } catch (error) {
      setValidationActionFeedback((prev) => ({
        ...prev,
        [requestHash]: {
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to send validation request.',
        },
      }));
    } finally {
      setValidationActionLoading((prev) => ({ ...prev, [requestHash]: false }));
    }
  }, [isEditMode, queryAgentId, parsedQueryChainId, refreshAgentValidationRequests, a2aEndpointData]);



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

  const handleSubmitENSValidationRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditMode || !finalAgentId || !finalChainId || !displayAgentAddress) {
      setError('Agent information is required. Please navigate to an agent first.');
      return;
    }
    const agentName = displayAgentName;
    if (!agentName || agentName === '...') {
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
      const chainId = Number.parseInt(finalChainId, 10);
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
      const did8004 = buildDid8004(chainId, finalAgentId);

      const requestJson = {
        agentId: finalAgentId,
        agentName: agentName,
        checks: ["Check Valid ENS Entry"]
      };
      const requestHash = keccak256(toHex(JSON.stringify(requestJson)));
      
      // Upload requestJson to IPFS
      console.log('[Alliance Registration] Uploading validation request to IPFS...');
      const jsonBlob = new Blob([JSON.stringify(requestJson, null, 2)], { type: 'application/json' });
      const formData = new FormData();
      formData.append('file', jsonBlob, 'validation-request.json');
      
      const ipfsResponse = await fetch('/api/ipfs/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!ipfsResponse.ok) {
        throw new Error('Failed to upload validation request to IPFS');
      }
      
      const ipfsResult = await ipfsResponse.json();
      const requestUri = ipfsResult.url || ipfsResult.tokenUri || `ipfs://${ipfsResult.cid}`;


      // Submit validation request using the new pattern
      const result = await requestENSValidationWithWallet({
        requesterDid: did8004,
        requestUri: requestUri,
        requestHash: requestHash,
        chain: chain as any,
        requesterAccountClient: agentAccountClient,
        onStatusUpdate: (msg: string) => console.log('[Validation Request]', msg),
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
      <Box component="main" sx={{ p: 4, maxWidth: '1400px', mx: 'auto' }}>
        {!adminReady ? (
          adminGate
        ) : (
          <>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {success}
              </Alert>
            )}

            {isEditMode && finalAgentId && finalChainId && (
              <Paper sx={{ mb: 3, p: 3, bgcolor: 'grey.50' }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} md={8}>
                    <Typography variant="h5" fontWeight="bold" color="text.primary">
                      Manage Agent #{finalAgentId} (chain {finalChainId})
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Name: <strong>{displayAgentName}</strong>
                    </Typography>
                    {displayAgentAddress && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Account: <Box component="span" fontFamily="monospace">{displayAgentAddress}</Box>
                      </Typography>
                    )}
                  </Grid>
                </Grid>
              </Paper>
            )}

            <Grid container spacing={3}>
              {/* Left-side vertical tabs for edit mode */}
              {isEditMode && (
                <Grid item xs={12} md={3}>
                  <Paper sx={{ height: '100%' }}>
                    <Tabs
                      orientation="vertical"
                      variant="scrollable"
                      value={activeManagementTab}
                      onChange={(_, newValue) => handleTabChange(newValue)}
                      sx={{
                        borderRight: 1,
                        borderColor: 'divider',
                        '& .MuiTab-root': {
                          alignItems: 'flex-start',
                          textAlign: 'left',
                          textTransform: 'none',
                          fontWeight: 600,
                          minHeight: 48,
                        },
                      }}
                    >
                      <Tab label="Agent Info" value="agentInfo" />
                      <Tab label="Registration" value="registration" />
                      <Tab label="Session Package" value="session" />
                      <Tab label="Transfer Agent" value="transfer" />
                      <Tab label="Delete Agent" value="delete" />
                      <Tab label="Request ENS Validation" value="validation" />
                      <Tab label="Validate Agent Request" value="agentValidation" />
                    </Tabs>
                  </Paper>
                </Grid>
              )}

              {/* Content Area */}
              <Grid item xs={12} md={isEditMode ? 9 : 12}>
                {(!isEditMode || activeManagementTab === 'agentInfo') && (
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h5" gutterBottom>
                      {isEditMode && finalAgentId
                        ? `Agent #${finalAgentId} Information`
                        : 'Agent Information'}
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Typography variant="body1">
                        <strong>Agent Name:</strong> {displayAgentName}
                      </Typography>
                      <Typography variant="body1">
                        <strong>Agent ID:</strong> {finalAgentId || '(not provided)'}
                      </Typography>
                      <Typography variant="body1">
                        <strong>Agent Account Address:</strong>{' '}
                        {displayAgentAddress ? (
                          <Box component="span" fontFamily="monospace">{displayAgentAddress}</Box>
                        ) : (
                          '(not provided)'
                        )}
                      </Typography>
                      <Typography variant="body1">
                        <strong>Chain:</strong>{' '}
                        {(() => {
                          if (!finalChainId) return '(not provided)';
                          const parsed = Number.parseInt(finalChainId, 10);
                          const meta = Number.isFinite(parsed) ? CHAIN_METADATA[parsed] : undefined;
                          const label = meta?.displayName || meta?.chainName || finalChainId;
                          return `${label} (chain ${finalChainId})`;
                        })()}
                      </Typography>
                      <Typography variant="body1">
                        <strong>NFT Operator:</strong>{' '}
                        {nftOperator.loading ? (
                          <Box component="span" color="text.secondary" fontStyle="italic">Loading...</Box>
                        ) : nftOperator.error ? (
                          <Box component="span" color="error.main">Error: {nftOperator.error}</Box>
                        ) : nftOperator.operatorAddress ? (
                          <Box component="span" fontFamily="monospace">{nftOperator.operatorAddress}</Box>
                        ) : (
                          <Box component="span" color="text.secondary" fontStyle="italic">(none)</Box>
                        )}
                      </Typography>
                    </Box>
                  </Paper>
                )}
                {(!isEditMode || activeManagementTab === 'registration') && (
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h5" gutterBottom>
                      Edit Registration
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                      Update the image and protocol endpoints for this agent. Other registration fields are
                      preserved as-is. The JSON that will be saved is shown on the right.
                    </Typography>

                    <Box sx={{ mt: 2, mb: 2, p: 2, borderRadius: 1, bgcolor: 'grey.100', border: 1, borderColor: 'grey.300' }}>
                      <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                        Latest TokenUri (from contract):
                      </Typography>
                      {registrationTokenUriLoading ? (
                        <Typography variant="body2" color="text.secondary">
                          Loading tokenUri from contract...
                        </Typography>
                      ) : registrationLatestTokenUri ? (
                        <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                          {registrationLatestTokenUri}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="error">
                          No tokenUri found on contract
                        </Typography>
                      )}
                    </Box>

                    {registrationPreviewError && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        {registrationPreviewError}
                      </Alert>
                    )}
                    {registrationEditError && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        {registrationEditError}
                      </Alert>
                    )}

                    <Grid container spacing={3} sx={{ mt: 2 }}>
                      {/* Left: field-by-field editor */}
                      <Grid item xs={12} md={7}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <TextField
                            label="Image URL"
                            fullWidth
                            value={registrationImage}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRegistrationImage(val);
                              setRegistrationImageError(validateUrlLike(val));
                            }}
                            placeholder="https://example.com/agent-image.png or ipfs://..."
                            disabled={!registrationParsed}
                            error={!!registrationImageError}
                            helperText={registrationImageError}
                            variant="outlined"
                            size="small"
                          />

                          <TextField
                            label="A2A Endpoint"
                            fullWidth
                            value={registrationA2aEndpoint}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRegistrationA2aEndpoint(val);
                              setRegistrationA2aError(validateUrlLike(val));
                            }}
                            placeholder="https://agent.example.com/.well-known/agent-card.json"
                            disabled={!registrationParsed}
                            error={!!registrationA2aError}
                            helperText={
                              registrationA2aError || 
                              'Single Agent Card (A2A) endpoint. This will be stored in the endpoints array with name A2A.'
                            }
                            variant="outlined"
                            size="small"
                          />

                          <TextField
                            label="MCP Endpoint"
                            fullWidth
                            value={registrationMcpEndpoint}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRegistrationMcpEndpoint(val);
                              setRegistrationMcpError(validateUrlLike(val));
                            }}
                            placeholder="https://agent.example.com/mcp"
                            disabled={!registrationParsed}
                            error={!!registrationMcpError}
                            helperText={
                              registrationMcpError || 
                              'Single MCP endpoint. This will be stored in the endpoints array with name MCP.'
                            }
                            variant="outlined"
                            size="small"
                          />

                          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
                            <Button
                              variant="outlined"
                              onClick={() => {
                                if (!registrationEditSaving) {
                                  setRegistrationEditError(null);
                                  setRegistrationPreviewText(null);
                                  setRegistrationParsed(null);
                                }
                              }}
                              disabled={registrationEditSaving}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="contained"
                              onClick={handleSaveRegistration}
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
                            </Button>
                          </Box>
                        </Box>
                      </Grid>

                      {/* Right: read-only JSON preview */}
                      <Grid item xs={12} md={5}>
                        <Paper
                          variant="outlined"
                          sx={{
                            p: 2,
                            bgcolor: 'grey.50',
                            maxHeight: 500,
                            overflow: 'auto',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {registrationPreviewLoading ? (
                            <Typography color="text.secondary">Loading registration JSON…</Typography>
                          ) : !registrationPreviewText ? (
                            <Typography color="text.secondary">No registration JSON available to edit.</Typography>
                          ) : (
                            <pre style={{ margin: 0 }}>{registrationPreviewText}</pre>
                          )}
                        </Paper>
                      </Grid>
                    </Grid>
                  </Paper>
                )}
                {(!isEditMode || activeManagementTab === 'delete') && (
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h5" gutterBottom color="text.primary">
                      Delete Agent
                    </Typography>
                    <Box component="form" onSubmit={handleDeleteAgent} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <TextField
                        label="Agent ID"
                        fullWidth
                        required
                        value={deleteForm.agentId}
                        onChange={(e) => setDeleteForm({ ...deleteForm, agentId: e.target.value })}
                        variant="outlined"
                        size="small"
                      />
                      <TextField
                        label="Chain ID"
                        fullWidth
                        required
                        type="number"
                        value={deleteForm.chainId}
                        onChange={(e) => setDeleteForm({ ...deleteForm, chainId: e.target.value })}
                        inputProps={{ min: 0 }}
                        variant="outlined"
                        size="small"
                      />
                      <Button
                        type="submit"
                        variant="contained"
                        sx={{
                          bgcolor: 'grey.800',
                          color: 'white',
                          '&:hover': { bgcolor: 'grey.900' },
                          py: 1.5,
                          fontWeight: 'bold'
                        }}
                      >
                        Delete Agent
                      </Button>
                    </Box>
                  </Paper>
                )}

                {(!isEditMode || activeManagementTab === 'session') && (
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h5" gutterBottom>
                      Session Package
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                      Generate a session package for this agent. Session packages describe delegated AA
                      access and can be used by tools to perform actions on behalf of this agent.
                    </Typography>

                    <Button
                      variant="contained"
                      onClick={handleGenerateSessionPackage}
                      disabled={sessionPackageLoading}
                      sx={{ mb: 2 }}
                    >
                      {sessionPackageLoading ? 'Generating…' : 'Generate Session Package'}
                    </Button>

                    {sessionPackageLoading && (
                      <Box sx={{ width: '100%', mb: 2 }}>
                        <Box
                          sx={{
                            height: 6,
                            borderRadius: 999,
                            bgcolor: 'grey.300',
                            overflow: 'hidden',
                          }}
                        >
                          <Box
                            sx={{
                              width: `${sessionPackageProgress}%`,
                              height: '100%',
                              bgcolor: 'primary.main',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                          Generating session package… {Math.round(sessionPackageProgress)}% (up to 60 seconds)
                        </Typography>
                      </Box>
                    )}

                    {sessionPackageError && (
                      <Alert severity="error" sx={{ mb: 2 }}>
                        {sessionPackageError}
                      </Alert>
                    )}

                    {sessionPackageText && (
                      <Paper
                        variant="outlined"
                        sx={{
                          mt: 2,
                          p: 2,
                          bgcolor: 'grey.50',
                          maxHeight: 500,
                          overflow: 'auto',
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => {
                              if (typeof navigator !== 'undefined' && navigator.clipboard && sessionPackageText) {
                                void navigator.clipboard.writeText(sessionPackageText);
                              }
                            }}
                          >
                            Copy JSON
                          </Button>
                        </Box>
                        <pre style={{ margin: 0 }}>{sessionPackageText}</pre>
                      </Paper>
                    )}
                  </Paper>
                )}
        {(!isEditMode || activeManagementTab === 'transfer') && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              Transfer Agent
            </Typography>
            <Box component="form" onSubmit={handleTransferAgent} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Agent ID"
                fullWidth
                required
                value={transferForm.agentId}
                onChange={(e) => setTransferForm({ ...transferForm, agentId: e.target.value })}
                variant="outlined"
                size="small"
              />
              <TextField
                label="Chain ID"
                fullWidth
                required
                type="number"
                value={transferForm.chainId}
                onChange={(e) => setTransferForm({ ...transferForm, chainId: e.target.value })}
                inputProps={{ min: 0 }}
                variant="outlined"
                size="small"
              />
              <TextField
                label="Transfer To (0x...)"
                fullWidth
                required
                value={transferForm.to}
                onChange={(e) => setTransferForm({ ...transferForm, to: e.target.value })}
                inputProps={{ pattern: '^0x[a-fA-F0-9]{40}$' }}
                placeholder="0x..."
                variant="outlined"
                size="small"
                sx={{ fontFamily: 'monospace' }}
              />
              <Button
                type="submit"
                variant="contained"
                sx={{
                  bgcolor: 'grey.400',
                  color: 'common.black',
                  '&:hover': { bgcolor: 'grey.500' },
                  py: 1.5,
                  fontWeight: 'bold'
                }}
              >
                Transfer Agent
              </Button>
            </Box>
          </Paper>
        )}
                {(!isEditMode || activeManagementTab === 'agentValidation') && (
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h5" gutterBottom>
                      Validate Agent Request
                    </Typography>
                    {isEditMode && displayAgentAddress && finalChainId ? (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, gap: 2 }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                              Validation requests where validator address equals agent account address: <strong>{shortenHex(displayAgentAddress)}</strong>
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                              {a2aEndpointData.loading
                                ? 'Determining agent A2A endpoint...'
                                : a2aEndpointData.error
                                  ? `A2A endpoint unavailable: ${a2aEndpointData.error}`
                                  : a2aEndpointData.a2aEndpoint
                                    ? `Validating against A2A endpoint: ${a2aEndpointData.a2aEndpoint}`
                                    : 'A2A endpoint not available for this agent.'}
                            </Typography>
                          </Box>
                          <Button
                            variant="outlined"
                            onClick={refreshAgentValidationRequests}
                            disabled={agentValidationRequests.loading}
                            size="small"
                          >
                            {agentValidationRequests.loading ? 'Refreshing…' : 'Refresh'}
                          </Button>
                        </Box>

                        {agentValidationRequests.error && (
                          <Alert severity="error" sx={{ mb: 2 }}>
                            {agentValidationRequests.error}
                          </Alert>
                        )}

                        {agentValidationRequests.loading ? (
                          <Typography color="text.secondary">Loading validation requests…</Typography>
                        ) : agentValidationRequests.requests.length === 0 ? (
                          <Typography color="text.secondary">No validation requests found for this validator address.</Typography>
                        ) : (
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {agentValidationRequests.requests.map((req) => {
                              const requestHash = req.requestHash || 'unknown';
                              const requestingAgent = req.requestingAgent;
                              const isLoading = validationActionLoading[requestHash] || false;
                              const feedback = validationActionFeedback[requestHash];
                              
                              return (
                                <Paper key={requestHash} variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
                                  <Box sx={{ mb: 1.5 }}>
                                    <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                                      Requesting Agent
                                    </Typography>
                                    {requestingAgent ? (
                                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                        <Typography variant="body2"><strong>Name:</strong> {requestingAgent.agentName || '(not available)'}</Typography>
                                        <Typography variant="body2"><strong>Agent ID:</strong> {req.agentId?.toString() || '(not available)'}</Typography>
                                        <Typography variant="body2"><strong>DID:</strong> {requestingAgent.didIdentity || requestingAgent.did || '(not available)'}</Typography>
                                        <Typography variant="body2"><strong>Account:</strong> <Box component="span" fontFamily="monospace">{requestingAgent.agentAccount || '(not available)'}</Box></Typography>
                                      </Box>
                                    ) : (
                                      <Typography variant="body2" color="text.secondary">
                                        Agent ID: {req.agentId?.toString() || 'Unknown'} (details not available)
                                      </Typography>
                                    )}
                                  </Box>

                                  <Box sx={{ mb: 1.5 }}>
                                    <Typography variant="body2" color="text.secondary">
                                      <strong>Request Hash:</strong> {shortenHex(requestHash)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                      <strong>Status:</strong> {req.response === 0 ? 'Pending' : `Completed (response: ${req.response})`}
                                    </Typography>
                                    {req.lastUpdate && (
                                      <Typography variant="body2" color="text.secondary">
                                        <strong>Last Update:</strong> {formatValidationTimestamp(req.lastUpdate)}
                                      </Typography>
                                    )}
                                  </Box>

                                  {req.response === 0 && (
                                    <>
                                      <Paper variant="outlined" sx={{ mb: 1.5, p: 1.5, bgcolor: 'primary.50', borderColor: 'primary.200' }}>
                                        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                                          Current Agent A2A Endpoint
                                        </Typography>
                                        {a2aEndpointData.loading ? (
                                          <Typography variant="body2" fontStyle="italic" color="text.secondary">Loading A2A endpoint data...</Typography>
                                        ) : a2aEndpointData.error ? (
                                          <Typography variant="body2" color="error">Error: {a2aEndpointData.error}</Typography>
                                        ) : (
                                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                            <Typography variant="body2">
                                              <strong>Token URI:</strong>{' '}
                                              {a2aEndpointData.tokenUri ? (
                                                <Box component="span" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>{a2aEndpointData.tokenUri}</Box>
                                              ) : (
                                                <Box component="span" color="text.secondary" fontStyle="italic">(not available)</Box>
                                              )}
                                            </Typography>
                                            <Typography variant="body2">
                                              <strong>A2A Endpoint:</strong>{' '}
                                              {a2aEndpointData.a2aEndpoint ? (
                                                <Box component="span" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>{a2aEndpointData.a2aEndpoint}</Box>
                                              ) : (
                                                <Box component="span" color="text.secondary" fontStyle="italic">(not available)</Box>
                                              )}
                                            </Typography>
                                            <Typography variant="body2">
                                              <strong>Verification:</strong>{' '}
                                              {a2aEndpointData.validation ? (
                                                <Box 
                                                  component="span" 
                                                  color={a2aEndpointData.validation.verified && a2aEndpointData.validation.hasSkill ? 'success.main' : 'error.main'}
                                                  fontWeight={600}
                                                >
                                                  {a2aEndpointData.validation.verified && a2aEndpointData.validation.hasSkill 
                                                    ? `✓ Verified - Skill "${a2aEndpointData.validation.skillName}" found`
                                                    : a2aEndpointData.validation.verified
                                                      ? '✗ Endpoint accessible but validation skill not found'
                                                      : `✗ Verification failed: ${a2aEndpointData.validation.error || 'Unknown error'}`}
                                                </Box>
                                              ) : (
                                                <Box component="span" color="text.secondary" fontStyle="italic">(not verified)</Box>
                                              )}
                                            </Typography>
                                          </Box>
                                        )}
                                      </Paper>

                                      <Button
                                        variant="contained"
                                        onClick={() => handleSendValidationRequest(req)}
                                        disabled={isLoading}
                                        fullWidth
                                        color="primary"
                                      >
                                        {isLoading ? 'Sending…' : 'Process Validation Request (A2A endpoint)'}
                                      </Button>
                                    </>
                                  )}

                                  {feedback && (
                                    <Typography 
                                      variant="body2" 
                                      sx={{ mt: 1 }} 
                                      color={feedback.type === 'success' ? 'success.main' : 'error.main'}
                                    >
                                      {feedback.message}
                                    </Typography>
                                  )}
                                </Paper>
                              );
                            })}
                          </Box>
                        )}
                      </>
                    ) : (
                      <Typography color="text.secondary" fontStyle="italic">
                        Please navigate to an agent with an account address to view validation requests.
                      </Typography>
                    )}
                  </Paper>
                )}

                {(!isEditMode || activeManagementTab === 'validation') && (
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h5" gutterBottom>
                      Request ENS Validation
                    </Typography>
                    {isEditMode && finalAgentId && finalChainId ? (
                      <>
                        <Typography variant="body2" color="text.secondary" paragraph>
                          Submit an ENS validation request for the current agent. The agent account abstraction will be used as the requester,
                          and a validator account abstraction (name: 'validator-ens') will be used as the validator.
                        </Typography>

                        <Paper variant="outlined" sx={{ mb: 3, p: 2, bgcolor: 'grey.50' }}>
                          <Typography variant="h6" gutterBottom fontSize="1.1rem">
                            Validation Request Information
                          </Typography>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <Typography variant="body2">
                              <strong>Agent ID:</strong> {finalAgentId}
                            </Typography>
                            <Typography variant="body2">
                              <strong>Agent Name:</strong> {displayAgentName}
                            </Typography>
                            <Typography variant="body2">
                              <strong>Chain ID:</strong> {finalChainId}
                            </Typography>
                            <Typography variant="body2">
                              <strong>Account:</strong>{' '}
                              {displayAgentAddress ? (
                                <Box component="span" fontFamily="monospace">{displayAgentAddress}</Box>
                              ) : (
                                '(not available)'
                              )}
                            </Typography>
                            <Typography variant="body2">
                              <strong>Validator:</strong>{' '}
                              {validatorAddress ? (
                                <Box component="span" fontFamily="monospace">{validatorAddress}</Box>
                              ) : (
                                <Box component="span" color="text.secondary" fontStyle="italic">(will be computed server-side)</Box>
                              )}
                            </Typography>
                            <Typography variant="body2">
                              <strong>Request URI:</strong>{' '}
                              {requestUri ? (
                                <Box component="span" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>{requestUri}</Box>
                              ) : (
                                <Box component="span" color="text.secondary" fontStyle="italic">Loading...</Box>
                              )}
                            </Typography>
                            <Typography variant="body2">
                              <strong>Request Hash:</strong>{' '}
                              {requestHash ? (
                                <Box component="span" fontFamily="monospace">{requestHash}</Box>
                              ) : (
                                <Box component="span" color="text.secondary" fontStyle="italic">Loading...</Box>
                              )}
                            </Typography>
                          </Box>
                        </Paper>

                        <Box component="form" onSubmit={handleSubmitENSValidationRequest}>
                          <Button
                            type="submit"
                            variant="contained"
                            fullWidth
                            disabled={validationSubmitting || !eip1193Provider || !eoaAddress || !displayAgentName}
                            sx={{ py: 1.5, fontWeight: 'bold' }}
                          >
                            {validationSubmitting ? 'Submitting...' : 'Submit ENS Validation Request'}
                          </Button>
                          {(!eip1193Provider || !eoaAddress) && (
                            <Typography variant="caption" color="error" align="center" display="block" sx={{ mt: 1 }}>
                              Wallet connection required to submit validation request
                            </Typography>
                          )}
                          {!displayAgentName && (
                            <Typography variant="caption" color="error" align="center" display="block" sx={{ mt: 1 }}>
                              Agent name is required to submit validation request
                            </Typography>
                          )}
                        </Box>
                      </>
                    ) : (
                      <Typography color="text.secondary" fontStyle="italic">
                        Please navigate to an agent to view validation request information.
                      </Typography>
                    )}
                  </Paper>
                )}
              </Grid>
            </Grid>
          </>
        )}
      </Box>
    </>
  );
}

