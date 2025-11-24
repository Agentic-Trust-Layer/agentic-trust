'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { grayscalePalette as palette } from '@/styles/palette';
import { generateSessionPackage, buildDid8004 } from '@agentic-trust/core';
import {
  updateAgentRegistrationWithWalletForAA,
  getDeployedAccountClientByAgentName,
} from '@agentic-trust/core';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';

export type AgentsPageAgent = {
  agentId: string;
  chainId: number;
  agentName?: string | null;
  agentAccount?: string | null;
  tokenUri?: string | null;
  description?: string | null;
  image?: string | null;
  contractAddress?: string | null;
  a2aEndpoint?: string | null;
  did?: string | null;
};

type Agent = AgentsPageAgent;

type ChainOption = {
  id: number;
  label: string;
};

export type AgentsPageFilters = {
  chainId: string;
  address: string;
  name: string;
  agentId: string;
  mineOnly: boolean;
};

type AgentsPageProps = {
  agents: Agent[];
  filters: AgentsPageFilters;
  chainOptions: ChainOption[];
  loading: boolean;
  ownedMap?: Record<string, boolean>;
  isConnected?: boolean;
  provider?: any;
  walletAddress?: string | null;
  total?: number;
  currentPage?: number;
  totalPages?: number;
  onFilterChange: <K extends keyof AgentsPageFilters>(
    key: K,
    value: AgentsPageFilters[K],
  ) => void;
  onSearch: (filtersOverride?: AgentsPageFilters) => void;
  onClear: () => void;
  onEditAgent?: (agent: Agent) => void;
  onPageChange?: (page: number) => void;
};

function getChainForId(chainId: number) {
  if (chainId === 11155111) return sepolia;
  if (chainId === 84532) return baseSepolia;
  if (chainId === 11155420) return optimismSepolia;
  return sepolia;
}

function getBundlerUrlForId(chainId: number) {
  if (chainId === 11155111) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
  if (chainId === 84532) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA;
  if (chainId === 11155420) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA;
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
}


type AgentActionType =
  | 'info'
  | 'registration'
  | 'did-web'
  | 'did-agent'
  | 'a2a'
  | 'session'
  | 'feedback'
  | 'registration-edit';

const ACTION_LABELS: Record<AgentActionType, string> = {
  info: 'Info',
  registration: 'Reg',
  'registration-edit': 'Edit Reg',
  'did-web': 'DID:Web',
  'did-agent': 'DID:Agent',
  a2a: 'A2A',
  session: 'Session',
  feedback: 'Feedback',
};

export function AgentsPage({
  agents,
  filters,
  chainOptions,
  loading,
  ownedMap = {},
  isConnected = false,
  provider,
  walletAddress,
  total,
  currentPage = 1,
  totalPages,
  onFilterChange,
  onSearch,
  onClear,
  onEditAgent,
  onPageChange,
}: AgentsPageProps) {

  const [activeDialog, setActiveDialog] = useState<{ agent: Agent; action: AgentActionType } | null>(null);
  const [registrationPreview, setRegistrationPreview] = useState<{
    key: string | null;
    loading: boolean;
    error: string | null;
    text: string | null;
  }>({
    key: null,
    loading: false,
    error: null,
    text: null,
  });
  const [registrationEditError, setRegistrationEditError] = useState<string | null>(null);
  const [registrationEditSaving, setRegistrationEditSaving] = useState(false);
  const registrationEditRef = useRef<HTMLTextAreaElement | null>(null);
  const [latestTokenUri, setLatestTokenUri] = useState<string | null>(null);
  const [tokenUriLoading, setTokenUriLoading] = useState(false);
  const [a2aPreview, setA2APreview] = useState<{
    key: string | null;
    loading: boolean;
    error: string | null;
    text: string | null;
  }>({
    key: null,
    loading: false,
    error: null,
    text: null,
  });
  const [sessionPreview, setSessionPreview] = useState<{
    key: string | null;
    loading: boolean;
    error: string | null;
    text: string | null;
  }>({
    key: null,
    loading: false,
    error: null,
    text: null,
  });
  const [sessionProgress, setSessionProgress] = useState<Record<string, number>>({});
  const [feedbackPreview, setFeedbackPreview] = useState<{
    key: string | null;
    loading: boolean;
    error: string | null;
    items: unknown[] | null;
    summary: { count: string | number; averageScore: number } | null;
  }>({
    key: null,
    loading: false,
    error: null,
    items: null,
    summary: null,
  });

  const EXPLORER_BY_CHAIN: Record<number, string> = {
    1: 'https://etherscan.io',
    11155111: 'https://sepolia.etherscan.io',
    84532: 'https://sepolia.basescan.org',
    11155420: 'https://sepolia-optimism.etherscan.io',
  };

  const [gridColumns, setGridColumns] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [singleQuery, setSingleQuery] = useState('');

  useEffect(() => {
    const updateColumns = () => {
      if (typeof window === 'undefined') {
        return;
      }
      const width = window.innerWidth;
      const computed = Math.min(3, Math.max(1, Math.floor(width / 420)));
      setGridColumns(computed);
      setIsMobile(width <= 640);
    };

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  const ENS_APP_BY_CHAIN: Record<number, string> = {
    1: 'https://app.ens.domains',
    11155111: 'https://app.ens.domains',
    84532: 'https://app.ens.domains',
    11155420: 'https://app.ens.domains',
  };

  const getEnsNameLink = (agent: Agent): { name: string; href: string } | null => {
    const did = agent.did;
    if (!did || !did.startsWith('did:ens:')) {
      return null;
    }
    const name = did.slice('did:ens:'.length);
    const base = ENS_APP_BY_CHAIN[agent.chainId] ?? 'https://app.ens.domains';
    return { name, href: `${base}/${name}` };
  };

  // Client-side filtering for address and mineOnly (these filters are applied on the client)
  const filteredAgents = useMemo(() => {
    let result = agents;
    const addressQuery = filters.address.trim().toLowerCase();
    if (addressQuery) {
      result = result.filter(agent =>
        (agent.agentAccount ?? '').toLowerCase().includes(addressQuery),
      );
    }
    if (filters.mineOnly) {
      result = result.filter(agent => ownedMap[`${agent.chainId}:${agent.agentId}`]);
    }
    return result;
  }, [agents, filters.address, filters.mineOnly, ownedMap]);

  const openActionDialog = (agent: Agent, action: AgentActionType) => {
    setActiveDialog({ agent, action });
  };

  const closeDialog = () => {
    setActiveDialog(null);
    setLatestTokenUri(null);
    setTokenUriLoading(false);
  };

  useEffect(() => {
    if (
      !activeDialog ||
      (activeDialog.action !== 'registration' &&
        activeDialog.action !== 'registration-edit')
    ) {
      return;
    }
    const { agent } = activeDialog;
    const key = `${agent.chainId}:${agent.agentId}`;
    
    // For registration-edit, fetch latest tokenUri from contract
    if (activeDialog.action === 'registration-edit') {
      let cancelled = false;
      setTokenUriLoading(true);
      setLatestTokenUri(null);
      
      (async () => {
        try {
          const did8004 = buildDid8004(agent.chainId, agent.agentId);
          const response = await fetch(`/api/agents/${encodeURIComponent(did8004)}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch agent details: ${response.status}`);
          }
          const agentDetails = await response.json();
          const freshTokenUri = agentDetails.tokenUri;
          
          if (cancelled) return;
          setLatestTokenUri(freshTokenUri || null);
          setTokenUriLoading(false);
          
          // Use the fresh tokenUri to load registration
          if (!freshTokenUri) {
            setRegistrationPreview({
              key,
              loading: false,
              error: 'No registration URI available for this agent.',
              text: null,
            });
            return;
          }
          
          setRegistrationPreview({
            key,
            loading: true,
            error: null,
            text: null,
          });
          
          try {
            const text = await loadRegistrationContent(freshTokenUri);
            if (cancelled) return;
            setRegistrationPreview({
              key,
              loading: false,
              error: null,
              text,
            });
          } catch (error: any) {
            if (cancelled) return;
            setRegistrationPreview({
              key,
              loading: false,
              error: error?.message ?? 'Unable to load registration JSON.',
              text: null,
            });
          }
        } catch (error: any) {
          if (cancelled) return;
          setTokenUriLoading(false);
          setRegistrationPreview({
            key,
            loading: false,
            error: error?.message ?? 'Failed to fetch latest tokenUri from contract.',
            text: null,
          });
        }
      })();
      
      return () => {
        cancelled = true;
      };
    } else {
      // For regular registration view, use agent.tokenUri from props
      const tokenUri = agent.tokenUri;
      if (!tokenUri) {
        setRegistrationPreview({
          key,
          loading: false,
          error: 'No registration URI available for this agent.',
          text: null,
        });
        return;
      }
      let cancelled = false;
      setRegistrationPreview({
        key,
        loading: true,
        error: null,
        text: null,
      });
      (async () => {
        try {
          const text = await loadRegistrationContent(tokenUri);
          if (cancelled) return;
          setRegistrationPreview({
            key,
            loading: false,
            error: null,
            text,
          });
        } catch (error: any) {
          if (cancelled) return;
          setRegistrationPreview({
            key,
            loading: false,
            error: error?.message ?? 'Unable to load registration JSON.',
            text: null,
          });
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [activeDialog]);

  useEffect(() => {
    if (!activeDialog || activeDialog.action !== 'feedback') {
      return;
    }

    const { agent } = activeDialog;
    const key = `${agent.chainId}:${agent.agentId}`;
    let cancelled = false;

    setFeedbackPreview({
      key,
      loading: true,
      error: null,
      items: null,
      summary: null,
    });

    (async () => {
      try {
        const did8004 = buildDid8004(agent.chainId, agent.agentId);
        const response = await fetch(
          `/api/agents/${encodeURIComponent(did8004)}/feedback?includeRevoked=true`,
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || errorData.error || 'Failed to fetch feedback',
          );
        }

        const data = await response.json();
        if (cancelled) return;

        setFeedbackPreview({
          key,
          loading: false,
          error: null,
          items: Array.isArray(data.feedback) ? data.feedback : [],
          summary: data.summary ?? null,
        });
      } catch (error: any) {
        if (cancelled) return;
        setFeedbackPreview({
          key,
          loading: false,
          error: error?.message ?? 'Unable to load feedback.',
          items: null,
          summary: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDialog]);

  useEffect(() => {
    if (!activeDialog || activeDialog.action !== 'a2a') {
      return;
    }
    const { agent } = activeDialog;
    const key = `${agent.chainId}:${agent.agentId}`;
    const endpoint = agent.a2aEndpoint;
    if (!endpoint) {
      setA2APreview({
        key,
        loading: false,
        error: 'No Agent Card endpoint configured for this agent.',
        text: null,
      });
      return;
    }
    let cancelled = false;
    setA2APreview({
      key,
      loading: true,
      error: null,
      text: null,
    });
    (async () => {
      try {
        const text = await loadAgentCardContent(endpoint);
        if (cancelled) return;
        setA2APreview({
          key,
          loading: false,
          error: null,
          text,
        });
      } catch (error: any) {
        if (cancelled) return;
        setA2APreview({
          key,
          loading: false,
          error: error?.message ?? 'Unable to load agent card JSON.',
          text: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDialog]);

  // Manage session progress timers
  useEffect(() => {
    const progressKeys = Object.keys(sessionProgress);
    if (progressKeys.length === 0) return;

    const interval = setInterval(() => {
      setSessionProgress(prev => {
        const updated = { ...prev };
        let hasChanges = false;

        for (const key of Object.keys(prev)) {
          const current = prev[key];
          if (current !== undefined && current < 100) {
            // Increment by ~1.67% per second (100% / 60 seconds)
            const newProgress = Math.min(100, current + (100 / 60));
            updated[key] = newProgress;
            hasChanges = true;

            // Clean up when complete
            if (newProgress >= 100) {
              setTimeout(() => {
                setSessionProgress(prevState => {
                  const cleaned = { ...prevState };
                  delete cleaned[key];
                  return cleaned;
                });
              }, 100);
            }
          }
        }

        return hasChanges ? updated : prev;
      });
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, [sessionProgress]);

  const dialogContent = useMemo(() => {
    if (!activeDialog) {
      return null;
    }
    const { agent, action } = activeDialog;
    const baseInfo = (
      <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0', color: palette.textPrimary }}>
        <li><strong>Agent ID:</strong> {agent.agentId}</li>
        <li><strong>Chain:</strong> {agent.chainId}</li>
        {agent.agentAccount ? <li><strong>Account:</strong> {agent.agentAccount}</li> : null}
      </ul>
    );

    switch (action) {
      case 'info':
        return (
          <>
            <p style={{ marginTop: 0 }}>
              High-level details for <strong>{agent.agentName || 'Unnamed Agent'}</strong>.
            </p>
            {baseInfo}
            {agent.description && (
              <p style={{ color: palette.textSecondary }}>{agent.description}</p>
            )}
          </>
        );
      case 'registration': {
        const previewMatchesAgent = registrationPreview.key === `${agent.chainId}:${agent.agentId}`;
        return (
          <>
            <p style={{ marginTop: 0 }}>
              The registration (tokenUri) reference for this agent.
            </p>
            {agent.tokenUri ? (
              <a
                href={agent.tokenUri}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: palette.accent, wordBreak: 'break-all' }}
              >
                {agent.tokenUri.length > 100
                  ? `${agent.tokenUri.slice(0, 100)}...`
                  : agent.tokenUri}
              </a>
            ) : (
              <p style={{ color: palette.dangerText }}>No registration URI available.</p>
            )}
            <div
              style={{
                marginTop: '1rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                padding: '0.75rem',
                backgroundColor: palette.surfaceMuted,
                maxHeight: '500px',
                overflow: 'auto',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {!previewMatchesAgent || registrationPreview.loading ? (
                <span style={{ color: palette.textSecondary }}>Loading registration JSON…</span>
              ) : registrationPreview.error ? (
                <span style={{ color: palette.dangerText }}>{registrationPreview.error}</span>
              ) : registrationPreview.text ? (
                registrationPreview.text
              ) : (
                <span style={{ color: palette.textSecondary }}>No JSON preview available.</span>
              )}
            </div>
          </>
        );
      }
      case 'registration-edit': {
        const previewMatchesAgent =
          registrationPreview.key === `${agent.chainId}:${agent.agentId}`;
        const isLoading = !previewMatchesAgent || registrationPreview.loading || tokenUriLoading;
        const error =
          previewMatchesAgent && registrationPreview.error ? registrationPreview.error : null;

        return (
          <>
            <p style={{ marginTop: 0 }}>
              Edit the ERC-8004 registration JSON for this agent. Changes will be uploaded to IPFS
              and the agent&apos;s tokenUri will be updated.
            </p>
            <div
              style={{
                marginTop: '0.75rem',
                marginBottom: '0.75rem',
                padding: '0.75rem',
                borderRadius: '8px',
                backgroundColor: palette.surfaceMuted,
                border: `1px solid ${palette.border}`,
              }}
            >
              <div style={{ fontSize: '0.75rem', color: palette.textSecondary, marginBottom: '0.25rem' }}>
                Latest TokenUri (from contract):
              </div>
              {tokenUriLoading ? (
                <div style={{ fontSize: '0.85rem', color: palette.textSecondary }}>
                  Loading tokenUri from contract...
                </div>
              ) : latestTokenUri ? (
                <div
                  style={{
                    fontSize: '0.85rem',
                    fontFamily: 'ui-monospace, monospace',
                    color: palette.textPrimary,
                    wordBreak: 'break-all',
                  }}
                >
                  {latestTokenUri}
                </div>
              ) : (
                <div style={{ fontSize: '0.85rem', color: palette.dangerText }}>
                  No tokenUri found on contract
                </div>
              )}
            </div>
            {error && (
              <p style={{ color: palette.dangerText, marginTop: '0.5rem' }}>{error}</p>
            )}
            {registrationEditError && (
              <p style={{ color: palette.dangerText, marginTop: '0.5rem' }}>
                {registrationEditError}
              </p>
            )}
            <div
              style={{
                marginTop: '1rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                padding: '0.75rem',
                backgroundColor: palette.surfaceMuted,
                maxHeight: '500px',
                overflow: 'auto',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {isLoading && !error ? (
                <span style={{ color: palette.textSecondary }}>Loading registration JSON…</span>
              ) : !previewMatchesAgent || !registrationPreview.text ? (
                <span style={{ color: palette.textSecondary }}>
                  No registration JSON available to edit.
                </span>
              ) : (
                <textarea
                  ref={registrationEditRef}
                  defaultValue={registrationPreview.text ?? ''}
                  style={{
                    width: '100%',
                    minHeight: '320px',
                    borderRadius: '6px',
                    border: `1px solid ${palette.border}`,
                    padding: '0.5rem',
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: '0.8rem',
                    backgroundColor: palette.surface,
                    color: palette.textPrimary,
                    resize: 'vertical',
                  }}
                />
              )}
            </div>
            <div
              style={{
                marginTop: '0.75rem',
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
                    closeDialog();
                  }
                }}
                style={{
                  padding: '0.4rem 0.9rem',
                  borderRadius: '8px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surface,
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  cursor: registrationEditSaving ? 'not-allowed' : 'pointer',
                  opacity: registrationEditSaving ? 0.6 : 1,
                  color: palette.textSecondary,
                }}
                disabled={registrationEditSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (registrationEditSaving) return;
                  setRegistrationEditError(null);

                  try {
                    const editor = registrationEditRef.current;
                    if (!editor) {
                      setRegistrationEditError('Editor is not ready yet.');
                      return;
                    }
                    const raw = editor.value ?? '';
                    if (!raw.trim()) {
                      setRegistrationEditError('Registration JSON cannot be empty.');
                      return;
                    }

                    // Validate JSON locally before sending
                    try {
                      JSON.parse(raw);
                    } catch (parseError) {
                      setRegistrationEditError(
                        parseError instanceof Error
                          ? `Invalid JSON: ${parseError.message}`
                          : 'Invalid JSON in registration editor.',
                      );
                      return;
                    }

                    if (!provider || !walletAddress) {
                      setRegistrationEditError(
                        'Wallet not connected. Connect your wallet to update registration.',
                      );
                      return;
                    }

                    setRegistrationEditSaving(true);
                    const did8004 = buildDid8004(agent.chainId, agent.agentId);
                    const chain = getChainForId(agent.chainId);

                    // Rebuild AA account client for this agent using wallet + bundler
                    const bundlerEnv = getBundlerUrlForId(agent.chainId);
                    if (!bundlerEnv) {
                      setRegistrationEditError(
                        'Missing bundler URL configuration for this chain. Set NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_* env vars.',
                      );
                      return;
                    }

                    const agentNameForAA = agent.agentName;
                    console.info('agentNameForAA aa', agent);
                    const accountClient = await getDeployedAccountClientByAgentName(
                      bundlerEnv,
                      agentNameForAA || '',
                      walletAddress as `0x${string}`,
                      {
                        chain,
                        ethereumProvider: provider,
                      },
                    );

                    console.info('accountClient aaa:', accountClient.address);

                    await updateAgentRegistrationWithWalletForAA({
                      did8004,
                      chain,
                      accountClient,
                      registration: raw,
                      onStatusUpdate: (msg: string) => {
                        console.log('[RegistrationUpdate]', msg);
                      },
                    });

                    closeDialog();
                    onSearch?.();
                  } catch (error: any) {
                    console.error('Failed to update registration:', error);
                    setRegistrationEditError(
                      error?.message ?? 'Failed to update registration. Please try again.',
                    );
                  } finally {
                    setRegistrationEditSaving(false);
                  }
                }}
                style={{
                  padding: '0.4rem 0.9rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: palette.accent,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: registrationEditSaving ? 'not-allowed' : 'pointer',
                  opacity: registrationEditSaving ? 0.7 : 1,
                  color: '#0b1120',
                }}
                disabled={registrationEditSaving}
              >
                {registrationEditSaving ? 'Saving…' : 'Save registration'}
              </button>
            </div>
          </>
        );
      }
      case 'did-web':
        return (
          <>
            <p style={{ marginTop: 0 }}>
              DID:Web references allow browsers to resolve the agent&apos;s identity via HTTPS.
            </p>
            <p>
              Suggested identifier:{' '}
              <code>did:web:{agent.agentName?.replace(/\.eth$/i, '') || 'agent.example.com'}</code>
            </p>
            <p style={{ color: palette.textSecondary }}>
              Configure a <code>.well-known/did.json</code> file on the agent&apos;s domain to publish the record.
            </p>
          </>
        );
      case 'did-agent':
        return (
          <>
            <p style={{ marginTop: 0 }}>
              DID:Agent binds ERC-8004 identities directly to smart accounts.
            </p>
            <p>
              Suggested identifier:{' '}
              <code>did:agent:{agent.chainId}:{agent.agentId}</code>
            </p>
            <p style={{ color: palette.textSecondary }}>
              Use your preferred wallet to generate a signed DID document containing the ERC-8004 registry information.
            </p>
          </>
        );
      case 'a2a': {
        const a2aMatchesAgent = a2aPreview.key === `${agent.chainId}:${agent.agentId}`;
        return (
          <>
            <p style={{ marginTop: 0 }}>
              A2A endpoints surface JSON capabilities for client-to-agent discovery.
            </p>
            {agent.a2aEndpoint ? (
              <a
                href={agent.a2aEndpoint}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: palette.accent, wordBreak: 'break-all' }}
              >
                {agent.a2aEndpoint}
              </a>
            ) : (
              <p style={{ color: palette.dangerText }}>No A2A endpoint is available for this agent.</p>
            )}
            <div
              style={{
                marginTop: '1rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                padding: '0.75rem',
                backgroundColor: palette.surfaceMuted,
                maxHeight: '500px',
                overflow: 'auto',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {!agent.a2aEndpoint ? (
                <span style={{ color: palette.textSecondary }}>No endpoint to preview.</span>
              ) : !a2aMatchesAgent || a2aPreview.loading ? (
                <span style={{ color: palette.textSecondary }}>Loading agent card…</span>
              ) : a2aPreview.error ? (
                <span style={{ color: palette.dangerText }}>{a2aPreview.error}</span>
              ) : a2aPreview.text ? (
                a2aPreview.text
              ) : (
                <span style={{ color: palette.textSecondary }}>No JSON preview available.</span>
              )}
            </div>
          </>
        );
      }
      case 'feedback': {
        const previewMatchesAgent = feedbackPreview.key === `${agent.chainId}:${agent.agentId}`;
        const loading = !previewMatchesAgent || feedbackPreview.loading;
        const error = previewMatchesAgent ? feedbackPreview.error : null;
        const items = previewMatchesAgent ? feedbackPreview.items : null;
        const summary = previewMatchesAgent ? feedbackPreview.summary : null;

        return (
          <>
            <p style={{ marginTop: 0 }}>
              Feedback entries and aggregated reputation summary for this agent.
            </p>
            {summary && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  marginBottom: '0.75rem',
                  fontSize: '0.85rem',
                  color: palette.textSecondary,
                }}
              >
                <span>
                  <strong>Feedback count:</strong> {summary.count}
                </span>
                <span>
                  <strong>Average score:</strong> {summary.averageScore}
                </span>
              </div>
            )}
            <div
              style={{
                marginTop: '0.5rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                padding: '0.75rem',
                backgroundColor: palette.surfaceMuted,
                maxHeight: '500px',
                overflow: 'auto',
                fontSize: '0.85rem',
              }}
            >
              {loading ? (
                <span style={{ color: palette.textSecondary }}>Loading feedback…</span>
              ) : error ? (
                <span style={{ color: palette.dangerText }}>{error}</span>
              ) : !items || items.length === 0 ? (
                <span style={{ color: palette.textSecondary }}>
                  No feedback entries found for this agent.
                </span>
              ) : (
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  {items.map((item, index) => {
                    const record = item as any;
                    const clientAddress = record.clientAddress as string | undefined;
                    const score = record.score as number | undefined;
                    const isRevoked = record.isRevoked as boolean | undefined;
                    const feedbackUri = record.feedbackUri as string | undefined;

                    return (
                      <li
                        key={record.index ?? index}
                        style={{
                          padding: '0.6rem 0.75rem',
                          borderRadius: '8px',
                          border: `1px solid ${palette.border}`,
                          backgroundColor: palette.surface,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            marginBottom: '0.25rem',
                          }}
                        >
                          <span>
                            <strong>Score:</strong>{' '}
                            {typeof score === 'number' ? score : 'N/A'}
                          </span>
                          {typeof isRevoked === 'boolean' && isRevoked && (
                            <span
                              style={{
                                color: palette.dangerText,
                                fontWeight: 600,
                              }}
                            >
                              Revoked
                            </span>
                          )}
                        </div>
                        {clientAddress && (
                          <div
                            style={{
                              fontFamily: 'monospace',
                              fontSize: '0.8rem',
                              color: palette.textSecondary,
                              marginBottom: feedbackUri ? '0.25rem' : 0,
                              wordBreak: 'break-all',
                            }}
                          >
                            {clientAddress}
                          </div>
                        )}
                        {feedbackUri && (
                          <a
                            href={feedbackUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '0.8rem',
                              color: palette.accent,
                              textDecoration: 'none',
                              wordBreak: 'break-all',
                            }}
                          >
                            View feedback details
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        );
      }
      case 'session': {
        const { agent } = activeDialog;
        return (
          <>
            <p style={{ marginTop: 0 }}>
              Session packages describe delegated AA access and can be used by tools to perform actions on behalf of this agent.
            </p>
            <div
              style={{
                marginTop: '1rem',
                border: `1px solid ${palette.border}`,
                borderRadius: '10px',
                padding: '0.75rem',
                backgroundColor: palette.surfaceMuted,
                maxHeight: '500px',
                overflow: 'auto',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {sessionPreview.loading && <span style={{ color: palette.textSecondary }}>Loading session package…</span>}
              {sessionPreview.error && <span style={{ color: palette.dangerText }}>{sessionPreview.error}</span>}
              {!sessionPreview.loading && !sessionPreview.error && sessionPreview.text && (
                <pre style={{ margin: 0 }}>{sessionPreview.text}</pre>
              )}
              {!sessionPreview.loading && !sessionPreview.error && !sessionPreview.text && (
                <span style={{ color: palette.textSecondary }}>No session package loaded.</span>
              )}
            </div>
          </>
        );
      }
      default:
        return null;
    }
  }, [activeDialog, registrationPreview, a2aPreview, sessionPreview]);

  const handleOpenSession = useCallback(
    async (agent: Agent) => {
      const agentKey = `${agent.chainId}:${agent.agentId}`;
      
      try {
        if (!provider || !walletAddress) {
          throw new Error('Connect your wallet to generate a session package.');
        }
        if (!agent.agentAccount || !agent.agentAccount.startsWith('0x')) {
          throw new Error('Agent account is missing or invalid.');
        }
        const agentIdNumeric = Number(agent.agentId);
        if (!Number.isFinite(agentIdNumeric)) {
          throw new Error('Agent id is invalid.');
        }

        const did8004 = `did:8004:${agent.chainId}:${agent.agentId}`;
        
        // Start progress bar
        setSessionProgress(prev => ({ ...prev, [agentKey]: 0 }));
        
        setSessionPreview(prev => ({ ...prev, key: did8004, loading: true, error: null, text: null }));

        const pkg = await generateSessionPackage({
          agentId: agentIdNumeric,
          chainId: agent.chainId,
          agentAccount: agent.agentAccount as `0x${string}`,
          provider,
          ownerAddress: walletAddress as `0x${string}`,
        });

        // Complete progress
        setSessionProgress(prev => {
          const updated = { ...prev };
          delete updated[agentKey];
          return updated;
        });

        setSessionPreview(prev => ({
          ...prev,
          loading: false,
          text: JSON.stringify(pkg, null, 2),
        }));
        setActiveDialog({ agent, action: 'session' });
      } catch (error) {
        console.error('Error creating session package:', error);
        
        // Complete progress on error too
        setSessionProgress(prev => {
          const updated = { ...prev };
          delete updated[agentKey];
          return updated;
        });
        
        setSessionPreview(prev => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to create session package',
        }));
        setActiveDialog(prev => (prev ? prev : { agent, action: 'session' }));
      }
    },
    [provider, walletAddress],
  );

  return (
    <>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>


      <div
        style={{
          backgroundColor: palette.surface,
          padding: '1.5rem',
          borderRadius: '12px',
          border: `1px solid ${palette.border}`,
          boxShadow: '0 8px 20px rgba(15,23,42,0.05)',
        }}
      >
        {isMobile ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', width: '100%' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, 0.6fr) 1fr',
                gap: '0.75rem',
                alignItems: 'end',
                width: '100%',
              }}
            >
              <select
                value={filters.chainId}
                onChange={event => {
                  const nextValue = event.target.value;
                  onFilterChange('chainId', nextValue);
                  onSearch({ ...filters, chainId: nextValue });
                }}
                aria-label="Chain"
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  fontWeight: 600,
                  color: palette.textPrimary,
                  boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
                  height: '44px',
                }}
              >
              <option value="all">Chain (All)</option>
              {chainOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label
                    .replace(/Ethereum/i, 'ETH')
                    .replace(/Optimism/i, 'OP')
                    .replace(/Base/i, 'Base')
                    .replace(/Sepolia/i, 'Sep')}
                </option>
              ))}
              </select>
              <input
                value={singleQuery}
                onChange={e => setSingleQuery(e.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSearch({ ...filters, name: singleQuery });
                  }
                }}
                placeholder={isMobile ? 'Search by name' : 'Search by address, name, or ID'}
                aria-label="Search"
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
                  height: '44px',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onFilterChange('mineOnly', !filters.mineOnly)}
                style={{
                  padding: '0.75rem 1.2rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: filters.mineOnly ? palette.accent : palette.surfaceMuted,
                  color: filters.mineOnly ? palette.surface : palette.textPrimary,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                my Agents
              </button>
              <button
                onClick={() => onSearch({ ...filters, name: singleQuery })}
                disabled={loading}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: palette.accent,
                  color: palette.surface,
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
              <button
                onClick={() => {
                  setSingleQuery('');
                  onClear();
                }}
                disabled={loading}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: palette.surfaceMuted,
                  color: palette.textPrimary,
                  border: `1px solid ${palette.border}`,
                  borderRadius: '10px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              alignItems: 'flex-end',
            }}
          >
            <div
              style={{
                flex: '1 1 220px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '1rem',
              }}
            >
              <select
                value={filters.chainId}
                onChange={event => {
                  const nextValue = event.target.value;
                  onFilterChange('chainId', nextValue);
                  onSearch({ ...filters, chainId: nextValue });
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSearch();
                  }
                }}
                aria-label="Chain"
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  fontWeight: 600,
                  color: palette.textPrimary,
                  boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
                }}
              >
                <option value="all">Chain (All)</option>
                {chainOptions.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>

              <input
                value={filters.address}
                onChange={event => onFilterChange('address', event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSearch();
                  }
                }}
                placeholder="Agent address"
                aria-label="Agent address"
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
                }}
              />

              <input
                value={filters.name}
                onChange={event => onFilterChange('name', event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSearch();
                  }
                }}
                placeholder="Agent name"
                aria-label="Agent name"
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
                }}
              />

              <input
                value={filters.agentId}
                onChange={event => onFilterChange('agentId', event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSearch();
                  }
                }}
                placeholder="Agent ID"
                aria-label="Agent ID"
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                marginLeft: 'auto',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={() => onFilterChange('mineOnly', !filters.mineOnly)}
                style={{
                  padding: '0.75rem 1.2rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: filters.mineOnly ? palette.accent : palette.surfaceMuted,
                  color: filters.mineOnly ? palette.surface : palette.textPrimary,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                my Agents
              </button>
              <button
                onClick={() => onSearch()}
                disabled={loading}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: palette.accent,
                  color: palette.surface,
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
              <button
                onClick={onClear}
                disabled={loading}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: palette.surfaceMuted,
                  color: palette.textPrimary,
                  border: `1px solid ${palette.border}`,
                  borderRadius: '10px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>


        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
            gap: '1.5rem',
          }}
        >
          {filteredAgents.length === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '2rem',
                textAlign: 'center',
                borderRadius: '12px',
                border: `1px dashed ${palette.border}`,
                color: palette.textSecondary,
              }}
            >
              {loading ? 'Loading agents...' : 'No agents found for the selected filters.'}
            </div>
          )}

          {filteredAgents.map(agent => {
            const ownershipKey = `${agent.chainId}:${agent.agentId}`;
            const isOwned = Boolean(ownedMap[ownershipKey]);
            const imageUrl =
              typeof agent.image === 'string' && agent.image.trim()
                ? agent.image.trim()
                : null;
            const explorerBase = EXPLORER_BY_CHAIN[agent.chainId] ?? 'https://etherscan.io';
            const nftUrl =
              typeof agent.contractAddress === 'string' && agent.contractAddress
                ? `${explorerBase}/token/${agent.contractAddress}?a=${agent.agentId}`
                : null;
            return (
              <article
                key={`${agent.chainId}-${agent.agentId}`}
                style={{
                  borderRadius: '16px',
                  border: `1px solid ${palette.border}`,
                  padding: '1.5rem',
                  backgroundColor: palette.surface,
                  boxShadow: '0 6px 16px rgba(15,23,42,0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  position: 'relative',
                }}
              >
                {isOwned && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.75rem',
                      right: '0.75rem',
                      display: 'flex',
                      gap: '0.4rem',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onEditAgent?.(agent)}
                      aria-label={`Edit agent ${agent.agentId}`}
                      title="Edit agent"
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '999px',
                        border: `1px solid ${palette.border}`,
                        backgroundColor: palette.surface,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 2px 6px rgba(15,23,42,0.15)',
                      }}
                    >
                      ✏️
                    </button>
                    {agent.tokenUri && (
                      <button
                        type="button"
                        onClick={() => openActionDialog(agent, 'registration-edit')}
                        aria-label={`Edit registration for agent ${agent.agentId}`}
                        title="Edit registration"
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '999px',
                          border: `1px solid ${palette.border}`,
                          backgroundColor: palette.surface,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(15,23,42,0.15)',
                        }}
                      >
                        🧾
                      </button>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
                  {imageUrl && (
                    <img
                      src={imageUrl}
                      alt={agent.agentName || 'Agent'}
                      style={{
                        width: '64px',
                        borderRadius: '14px',
                        border: `1px solid ${palette.border}`,
                      }}
                    />
                  )}
                  <div>
                  {nftUrl ? (
                      <a
                        href={nftUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-block',
                          fontSize: '0.8rem',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          color: palette.accent,
                          marginBottom: '0.25rem',
                          textDecoration: 'none',
                          fontWeight: 600,
                        }}
                      >
                        Agent #{agent.agentId}
                      </a>
                    ) : (
                      <p
                        style={{
                          fontSize: '0.8rem',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          color: palette.textMuted,
                          marginBottom: '0.25rem',
                        }}
                      >
                        Agent #{agent.agentId}
                      </p>
                    )}
                  </div>
                  
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    
                    <h4 style={{ margin: 0, fontSize: '1.3rem' }}>
                      {agent.agentName || 'Unnamed Agent'}
                    </h4>
                    {(() => {
                      const ensLink = getEnsNameLink(agent);
                      if (!ensLink) return null;
                      return (
                        <a
                          href={ensLink.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-block',
                            marginTop: '0.25rem',
                            color: palette.textPrimary,
                            textDecoration: 'none',
                            borderBottom: '1px dashed rgba(15,23,42,0.3)',
                            fontSize: '0.95rem',
                            fontWeight: 600,
                            wordBreak: 'break-all',
                          }}
                        >
                          {ensLink.name}
                        </a>
                      );
                    })()}
                    
                  </div>
                <p
                  style={{
                    margin: 0,
                    color: palette.textSecondary,
                    minHeight: '3.5rem',
                  }}
                >
                  {(() => {
                    const desc = agent.description || 'No description provided.';
                    if (desc.length > 500) {
                      return `${desc.slice(0, 500)}...`;
                    }
                    return desc;
                  })()}
                </p>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    
                    {typeof agent.agentAccount === 'string' && agent.agentAccount && (
                      <a
                        href={`${explorerBase}/address/${agent.agentAccount}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '0.3rem 0.75rem',
                          backgroundColor: palette.dangerSurface,
                          color: palette.dangerText,
                          borderRadius: '999px',
                          fontSize: '0.8rem',
                          fontFamily: 'monospace',
                          textDecoration: 'none',
                        }}
                      >
                        {agent.agentAccount.slice(0, 6)}...{agent.agentAccount.slice(-4)}
                      </a>
                    )}
                    {!isMobile && isOwned && typeof agent.agentAccount === 'string' && agent.agentAccount && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            void handleOpenSession(agent);
                          }}
                          style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: '999px',
                            border: `1px solid ${palette.border}`,
                            backgroundColor: palette.surfaceMuted,
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            color: palette.textPrimary,
                          }}
                        >
                          Session package
                        </button>
                        {(() => {
                          const agentKey = `${agent.chainId}:${agent.agentId}`;
                          const progress = sessionProgress[agentKey];
                          if (progress === undefined) return null;
                          return (
                            <div
                              style={{
                                width: '100%',
                                height: '4px',
                                backgroundColor: palette.surfaceMuted,
                                borderRadius: '2px',
                                overflow: 'hidden',
                                minWidth: '120px',
                              }}
                            >
                              <div
                                style={{
                                  width: `${progress}%`,
                                  height: '100%',
                                  backgroundColor: palette.accent,
                                  transition: 'width 0.3s ease-out',
                                }}
                              />
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.4rem',
                      flexWrap: 'wrap',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        openActionDialog(agent, 'info');
                      }}
                      style={{
                        padding: '0.25rem 0.6rem',
                        borderRadius: '8px',
                        border: `1px solid ${palette.border}`,
                        backgroundColor: palette.surface,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        color: palette.textPrimary,
                      }}
                    >
                      {ACTION_LABELS.info}
                    </button>
                    {isOwned && (
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation();
                          openActionDialog(agent, 'feedback');
                        }}
                        style={{
                          padding: '0.25rem 0.6rem',
                          borderRadius: '8px',
                          border: `1px solid ${palette.border}`,
                          backgroundColor: palette.surface,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: palette.textPrimary,
                        }}
                      >
                        {ACTION_LABELS.feedback}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        openActionDialog(agent, 'registration');
                      }}
                      style={{
                        padding: '0.25rem 0.6rem',
                        borderRadius: '8px',
                        border: `1px solid ${palette.border}`,
                        backgroundColor: palette.surface,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        cursor: agent.tokenUri ? 'pointer' : 'not-allowed',
                        opacity: agent.tokenUri ? 1 : 0.5,
                        color: palette.textPrimary,
                      }}
                      disabled={!agent.tokenUri}
                    >
                      {ACTION_LABELS.registration}
                    </button>
                    {isOwned && (
                      <>
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            openActionDialog(agent, 'did-web');
                          }}
                          style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: '8px',
                            border: `1px solid ${palette.border}`,
                            backgroundColor: palette.surface,
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            color: palette.textPrimary,
                          }}
                        >
                          {ACTION_LABELS['did-web']}
                        </button>
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            openActionDialog(agent, 'did-agent');
                          }}
                          style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: '8px',
                            border: `1px solid ${palette.border}`,
                            backgroundColor: palette.surface,
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            color: palette.textPrimary,
                          }}
                        >
                          {ACTION_LABELS['did-agent']}
                        </button>
                      </>
                    )}
                    {agent.a2aEndpoint && (
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation();
                          openActionDialog(agent, 'a2a');
                        }}
                        style={{
                          padding: '0.25rem 0.6rem',
                          borderRadius: '8px',
                          border: `1px solid ${palette.border}`,
                          backgroundColor: palette.surface,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          color: palette.textPrimary,
                        }}
                      >
                        {ACTION_LABELS.a2a}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {totalPages !== undefined && totalPages > 0 && onPageChange && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '1rem',
              marginTop: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1 || loading}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                backgroundColor: currentPage <= 1 || loading ? palette.surfaceMuted : palette.surface,
                color: palette.textPrimary,
                cursor: currentPage <= 1 || loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              Previous
            </button>
            <span style={{ fontWeight: 600, color: palette.textSecondary }}>
              Page {currentPage} of {totalPages}
              {total !== undefined && ` (${total} total)`}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages || loading}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: '10px',
                border: `1px solid ${palette.border}`,
                backgroundColor: currentPage >= totalPages || loading ? palette.surfaceMuted : palette.surface,
                color: palette.textPrimary,
                cursor: currentPage >= totalPages || loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </section>
    {activeDialog && dialogContent && (() => {
      const { agent, action } = activeDialog;
      return (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15,23,42,0.48)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={closeDialog}
        >
          <div
            style={{
              backgroundColor: palette.surface,
              borderRadius: '16px',
              padding: '1.5rem',
              width: 'min(800px, 100%)',
              minHeight: '500px',
              boxShadow: '0 20px 45px rgba(15,23,42,0.25)',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={event => event.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
              <span>
                {ACTION_LABELS[action]} — {agent.agentName || `Agent #${agent.agentId}`}
              </span>
              {action === 'session' && sessionPreview.text && (
                <button
                  type="button"
                  aria-label="Copy session JSON"
                  title="Copy session JSON"
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && navigator.clipboard) {
                      void navigator.clipboard.writeText(sessionPreview.text as string);
                    }
                  }}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '999px',
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.surfaceMuted,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  📋
                </button>
              )}
            </h3>
            <div style={{ fontSize: '0.9rem', lineHeight: 1.5, flex: 1, overflowY: 'auto' }}>{dialogContent}</div>
            <button
              type="button"
              onClick={closeDialog}
              style={{
                marginTop: '1.5rem',
                padding: '0.6rem 1.2rem',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: palette.accent,
                color: palette.surface,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      );
    })()}
    </>
  );
}

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
        const decoded = typeof window !== 'undefined' && typeof window.atob === 'function'
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

async function loadAgentCardContent(uri: string): Promise<string> {
  return loadRegistrationContent(uri);
}


