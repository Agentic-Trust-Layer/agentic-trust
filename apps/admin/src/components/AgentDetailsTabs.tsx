'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { AgentsPageAgent } from './AgentsPage';
import { grayscalePalette as palette } from '@/styles/palette';
import { ASSOC_TYPE_OPTIONS } from '@/lib/association-types';
import { decodeAssociationData } from '@/lib/association';

type FeedbackSummary = {
  count?: number | string;
  averageScore?: number;
} | null;

export type AgentDetailsFeedbackSummary = FeedbackSummary;

export type ValidationEntry = {
  agentId?: string | null;
  requestHash?: string | null;
  validatorAddress?: string | null;
  response?: number | null;
  responseHash?: string | null;
  lastUpdate?: number | null;
  tag?: string | null;
  // Augmented fields from GraphQL
  txHash?: string | null;
  blockNumber?: number | null;
  timestamp?: number | null;
  requestUri?: string | null;
  requestJson?: string | null;
  responseUri?: string | null;
  responseJson?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AgentDetailsValidationsSummary = {
  pending: ValidationEntry[];
  completed: ValidationEntry[];
};

type AgentDetailsTabsProps = {
  did8004: string;
  agent: AgentsPageAgent;
  feedbackItems?: unknown[];
  feedbackSummary?: AgentDetailsFeedbackSummary;
  validations?: AgentDetailsValidationsSummary | null;
  onChainMetadata?: Record<string, string>;
};

const TAB_DEFS = [
  { id: 'overview', label: 'Overview' },
  { id: 'registration', label: 'Registration' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'validation', label: 'Validation' },
  { id: 'associations', label: 'Associations' },
] as const;

type TabId = (typeof TAB_DEFS)[number]['id'];

const shorten = (value?: string | null) => {
  if (!value) return '—';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
};

function formatJsonIfPossible(text: string | null | undefined): string | null {
  if (!text) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const formatRelativeTime = (timestamp?: number | null) => {
  if (!timestamp) return 'Unknown';
  const secondsAgo = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(timestamp));
  const days = Math.floor(secondsAgo / 86400);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hours = Math.floor(secondsAgo / 3600);
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(secondsAgo / 60);
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return `${secondsAgo} second${secondsAgo === 1 ? '' : 's'} ago`;
};

const AgentDetailsTabs = ({
  did8004,
  agent,
  feedbackItems: initialFeedbackItems,
  feedbackSummary: initialFeedbackSummary,
  validations: initialValidations,
  onChainMetadata: initialOnChainMetadata = {},
}: AgentDetailsTabsProps) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [registrationData, setRegistrationData] = useState<string | null>(null);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  // Feedback + validations are lazy-loaded when their respective tabs are opened
  const [feedbackItems, setFeedbackItems] = useState<unknown[]>(
    Array.isArray(initialFeedbackItems) ? initialFeedbackItems : [],
  );
  const [feedbackSummary, setFeedbackSummary] = useState<AgentDetailsFeedbackSummary>(
    initialFeedbackSummary ?? null,
  );
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackLoaded, setFeedbackLoaded] = useState<boolean>(Array.isArray(initialFeedbackItems));
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const [validations, setValidations] = useState<AgentDetailsValidationsSummary | null>(
    initialValidations ?? null,
  );
  const [validationsLoading, setValidationsLoading] = useState(false);
  const [validationsLoaded, setValidationsLoaded] = useState<boolean>(
    initialValidations !== undefined && initialValidations !== null,
  );
  const [validationsError, setValidationsError] = useState<string | null>(null);

  // On-chain metadata is shown in Overview pane; load on demand when Overview is opened
  const [onChainMetadata, setOnChainMetadata] = useState<Record<string, string>>(initialOnChainMetadata ?? {});
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataLoaded, setMetadataLoaded] = useState<boolean>(
    initialOnChainMetadata && Object.keys(initialOnChainMetadata).length > 0,
  );
  const [metadataError, setMetadataError] = useState<string | null>(null);

  // Normalize DID to avoid double-encoding (e.g. did%253A8004...).
  const canonicalDid8004 = useMemo(() => {
    let v = String(did8004 || '');
    for (let i = 0; i < 3; i++) {
      if (!v.includes('%')) break;
      try {
        const dec = decodeURIComponent(v);
        if (dec === v) break;
        v = dec;
      } catch {
        break;
      }
    }
    return v;
  }, [did8004]);
  
  // Associations state
  const [associationsData, setAssociationsData] = useState<{
    ok: true;
    chainId: number;
    account: string;
    associations: Array<{
      associationId: string;
      initiator?: string;
      approver?: string;
      counterparty?: string;
      validAt?: number;
      validUntil?: number;
      revokedAt: number;
      initiatorKeyType?: string;
      approverKeyType?: string;
      initiatorSignature?: string;
      approverSignature?: string;
      initiatorAddress?: string;
      approverAddress?: string;
      counterpartyAddress?: string;
      record?: {
        initiator: string;
        approver: string;
        validAt: number;
        validUntil: number;
        interfaceId: string;
        data: string;
      };
      verification?: {
        digest: string;
        recordHashMatches: boolean;
        initiator: { ok: boolean; method: string; reason?: string };
        approver: { ok: boolean; method: string; reason?: string };
      };
    }>;
  } | { ok: false; error: string } | null>(null);
  const [associationsLoading, setAssociationsLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeTx, setRevokeTx] = useState<string | null>(null);
  const [revokeReceipt, setRevokeReceipt] = useState<any | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [agentInfoByAddress, setAgentInfoByAddress] = useState<Map<string, { agentId?: string; agentName?: string; agentAccount?: string }>>(new Map());

  const feedbackList = useMemo(() => (Array.isArray(feedbackItems) ? feedbackItems : []), [feedbackItems]);

  const pendingValidations = validations?.pending ?? [];
  const completedValidations = validations?.completed ?? [];

  // Normalize IPFS/Arweave URLs to HTTP
  const normalizeResourceUrl = useCallback((src?: string | null): string | null => {
    if (!src) {
      return null;
    }
    let value = src.trim();
    if (!value) {
      return null;
    }
    try {
      value = decodeURIComponent(value);
    } catch {
      // ignore
    }
    if (value.startsWith('ipfs://')) {
      const path = value.slice('ipfs://'.length).replace(/^ipfs\//i, '');
      return `https://ipfs.io/ipfs/${path}`;
    }
    if (value.startsWith('ar://')) {
      return `https://arweave.net/${value.slice('ar://'.length)}`;
    }
    return value;
  }, []);

  // Load associations when associations tab is selected
  const refreshAssociations = useCallback(async () => {
    if (!agent.agentAccount) return;
    setAssociationsLoading(true);
    setAssociationsData(null);
    try {
      // Include chainId in the request
      const chainId = agent.chainId || 11155111; // Default to Sepolia if not set
      const account =
        typeof agent.agentAccount === 'string' && agent.agentAccount.includes(':')
          ? agent.agentAccount.split(':').pop() || agent.agentAccount
          : agent.agentAccount;
      const res = await fetch(
        `/api/associations?account=${encodeURIComponent(account)}&chainId=${chainId}&source=chain`,
        {
          cache: 'no-store',
        }
      );
      const json = await res.json();
      setAssociationsData(json);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setAssociationsData({ ok: false, error: msg });
    } finally {
      setAssociationsLoading(false);
    }
  }, [agent.agentAccount, agent.chainId]);

  useEffect(() => {
    if (activeTab === 'associations' && agent.agentAccount && !associationsData && !associationsLoading) {
      void refreshAssociations();
    }
  }, [activeTab, agent.agentAccount, associationsData, associationsLoading, refreshAssociations]);

  // Lazy load feedback data when feedback tab is selected
  useEffect(() => {
    if (activeTab !== 'feedback') return;
    if (feedbackLoaded || feedbackLoading) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    (async () => {
      setFeedbackLoading(true);
      setFeedbackError(null);
      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(canonicalDid8004)}/feedback?includeRevoked=true&limit=200`,
          { signal: controller.signal },
        );
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setFeedbackError((json as any)?.message || (json as any)?.error || `Failed to load feedback (${res.status})`);
          setFeedbackLoaded(true);
          return;
        }

        const feedbackPayload = json?.feedback;
        const summaryPayload = json?.summary;
        const items =
          Array.isArray(feedbackPayload?.feedbacks)
            ? feedbackPayload.feedbacks
            : Array.isArray(feedbackPayload)
              ? feedbackPayload
              : Array.isArray(json?.feedbacks)
                ? json.feedbacks
                : [];

        setFeedbackItems(items);

        // Prefer server summary if present, otherwise derive.
        if (summaryPayload && typeof summaryPayload === 'object') {
          setFeedbackSummary({
            count: (summaryPayload as any).count ?? items.length,
            averageScore: (summaryPayload as any).averageScore ?? undefined,
          });
        } else {
          const scores: number[] = items
            .map((f: any) => Number(f?.score))
            .filter((n: number) => Number.isFinite(n));
          const avg = scores.length ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : undefined;
          setFeedbackSummary({ count: items.length, averageScore: avg });
        }
      } catch (e: any) {
        if (!cancelled) {
          setFeedbackError(e?.message || 'Failed to load feedback');
        }
      } finally {
        if (!cancelled) {
          setFeedbackLoaded(true); // mark loaded even on failure to avoid infinite retries
          setFeedbackLoading(false);
        }
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [activeTab, canonicalDid8004]);

  // Lazy load validations data when validation tab is selected
  useEffect(() => {
    if (activeTab !== 'validation') return;
    if (validationsLoaded || validationsLoading) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    (async () => {
      setValidationsLoading(true);
      setValidationsError(null);
      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(canonicalDid8004)}/validations`,
          { signal: controller.signal },
        );
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setValidationsError((json as any)?.message || (json as any)?.error || `Failed to load validations (${res.status})`);
          setValidationsLoaded(true);
          return;
        }
        const pendingRaw = Array.isArray(json?.pending) ? json.pending : [];
        const completedRaw = Array.isArray(json?.completed) ? json.completed : [];
        setValidations({
          pending: pendingRaw.map((v: any) => ({
            agentId: v?.agentId ?? null,
            requestHash: v?.requestHash ?? null,
            validatorAddress: v?.validatorAddress ?? null,
            response: v?.response ?? null,
            responseHash: v?.responseHash ?? null,
            lastUpdate: v?.lastUpdate ?? null,
            tag: v?.tag ?? null,
          })),
          completed: completedRaw.map((v: any) => ({
            agentId: v?.agentId ?? null,
            requestHash: v?.requestHash ?? null,
            validatorAddress: v?.validatorAddress ?? null,
            response: v?.response ?? null,
            responseHash: v?.responseHash ?? null,
            lastUpdate: v?.lastUpdate ?? null,
            tag: v?.tag ?? null,
          })),
        });
      } catch (e: any) {
        if (!cancelled) {
          setValidationsError(e?.message || 'Failed to load validations');
        }
      } finally {
        if (!cancelled) {
          setValidationsLoaded(true);
          setValidationsLoading(false);
        }
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [activeTab, canonicalDid8004]);

  // Lazy load on-chain metadata when Overview tab is selected (shown in Metadata pane)
  useEffect(() => {
    if (activeTab !== 'overview') return;
    if (metadataLoaded || metadataLoading) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    (async () => {
      setMetadataLoading(true);
      setMetadataError(null);
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(canonicalDid8004)}`, {
          method: 'GET',
          signal: controller.signal,
        });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setMetadataError((json as any)?.message || (json as any)?.error || `Failed to load agent metadata (${res.status})`);
          setMetadataLoaded(true);
          return;
        }
        const meta =
          json &&
          typeof json === 'object' &&
          (json as any).identityMetadata &&
          typeof (json as any).identityMetadata === 'object' &&
          (json as any).identityMetadata.metadata &&
          typeof (json as any).identityMetadata.metadata === 'object'
            ? ((json as any).identityMetadata.metadata as Record<string, string>)
            : null;
        if (meta) {
          setOnChainMetadata(meta);
        }
      } catch (e: any) {
        if (!cancelled) {
          setMetadataError(e?.message || 'Failed to load on-chain metadata');
        }
      } finally {
        if (!cancelled) {
          setMetadataLoaded(true);
          setMetadataLoading(false);
        }
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [activeTab, canonicalDid8004]);

  // Fetch agent info for association addresses
  useEffect(() => {
    if (!associationsData || !associationsData.ok || associationsData.associations.length === 0) return;
    
    // Collect all unique addresses from associations
    const addressesToLookup = new Set<string>();
    const centerAddr = agent.agentAccount?.toLowerCase();
    
    for (const a of associationsData.associations) {
      const initiator = (a.initiator ?? a.initiatorAddress)?.toLowerCase?.();
      const approver = (a.approver ?? a.approverAddress)?.toLowerCase?.();
      const counterparty = (a.counterparty ?? a.counterpartyAddress)?.toLowerCase?.();
      
      if (initiator && initiator !== centerAddr) addressesToLookup.add(initiator);
      if (approver && approver !== centerAddr) addressesToLookup.add(approver);
      if (counterparty && counterparty !== centerAddr) addressesToLookup.add(counterparty);
    }
    
    if (addressesToLookup.size === 0) return;
    
    let cancelled = false;
    
    // Fetch agent info for each address
    (async () => {
      const results = await Promise.allSettled(
        Array.from(addressesToLookup).map(async (addr) => {
          try {
            // Search for agents with this account address
            const searchParams = new URLSearchParams({
              query: addr,
              pageSize: '10',
            });
            const res = await fetch(`/api/agents/search?${searchParams.toString()}`, {
              cache: 'no-store',
            });
            if (!res.ok) return [addr, null] as const;
            const data = await res.json();
            const agents = data?.agents || [];
            // Find exact match by agentAccount
            const matchingAgent = agents.find((a: any) => {
              const agentAccount = a.agentAccount || (a.data && a.data.agentAccount);
              return agentAccount?.toLowerCase() === addr;
            });
            
            if (matchingAgent) {
              const agentData = matchingAgent.data || matchingAgent;
              return [addr, {
                agentId: (agentData.agentId || matchingAgent.agentId)?.toString(),
                agentName: agentData.agentName || matchingAgent.agentName || undefined,
                agentAccount: agentData.agentAccount || matchingAgent.agentAccount || addr,
              }] as const;
            }
            return [addr, null] as const;
          } catch (e) {
            console.warn(`[AgentDetailsTabs] Failed to lookup agent for address ${addr}:`, e);
            return [addr, null] as const;
          }
        })
      );
      
      if (cancelled) return;
      
      setAgentInfoByAddress((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const [addr, info] = r.value;
            if (info) {
              next.set(addr.toLowerCase(), info);
            }
          }
        }
        return next;
      });
    })();
    
    return () => {
      cancelled = true;
    };
  }, [associationsData, agent.agentAccount]);

  // Helper to get agent info for an address
  const getAgentInfoForAddress = useCallback((addr: string) => {
    if (!addr) return null;
    const addrLower = addr.toLowerCase();
    // Check if it's the center agent
    if (agent.agentAccount?.toLowerCase() === addrLower) {
      return {
        agentId: agent.agentId,
        agentName: agent.agentName || undefined,
        agentAccount: agent.agentAccount,
      };
    }
    // Check cached agent info
    return agentInfoByAddress.get(addrLower) || null;
  }, [agent, agentInfoByAddress]);

  // Load registration data when registration tab is selected
  useEffect(() => {
    // If we already failed once, don't spin in a retry loop.
    // Users can refresh the page if they want to retry, or we can add an explicit retry button later.
    if (activeTab === 'registration' && agent.agentUri && !registrationData && !registrationLoading && !registrationError) {
      setRegistrationLoading(true);
      setRegistrationError(null);
      const normalizedUri = normalizeResourceUrl(agent.agentUri);
      if (!normalizedUri) {
        setRegistrationError('Invalid token URI');
        setRegistrationLoading(false);
        return;
      }
      // Handle data URIs directly without fetch
      if (normalizedUri.startsWith('data:')) {
        try {
          const commaIndex = normalizedUri.indexOf(',');
          if (commaIndex === -1) throw new Error('Invalid data URI');
          
          const isBase64 = normalizedUri.includes(';base64');
          const data = normalizedUri.slice(commaIndex + 1);
          
          let decoded: string;
          if (isBase64) {
            // Check if it looks like plain JSON despite saying base64
            const trimmedData = data.trim();
            if (trimmedData.startsWith('{') || trimmedData.startsWith('[')) {
              decoded = data; // Treat as plain text
            } else {
              try {
                decoded = atob(data);
              } catch (e) {
                // If base64 decode fails, try as plain text or URL decoded
                try {
                  decoded = decodeURIComponent(data);
                } catch {
                  decoded = data;
                }
              }
            }
          } else {
            decoded = decodeURIComponent(data);
          }

          // Verify it's valid JSON if possible (for pretty printing)
          try {
            const json = JSON.parse(decoded);
            setRegistrationData(JSON.stringify(json, null, 2));
          } catch {
            setRegistrationData(decoded);
          }
          setRegistrationLoading(false);
          return;
        } catch (error) {
          console.warn('Failed to parse data URI:', error);
          // Fall through to fetch if manual parse fails (unlikely for data URIs)
        }
      }

      // Add a short timeout so a bad gateway can't hang the UI.
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 10_000);
      fetch(normalizedUri, { signal: ctrl.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error('Failed to fetch registration data');
          }
          return response.text();
        })
        .then((text) => {
          setRegistrationData(text);
          setRegistrationLoading(false);
        })
        .catch((error) => {
          console.error('Failed to load registration:', error);
          setRegistrationError(error instanceof Error ? error.message : 'Failed to load registration data');
          setRegistrationLoading(false);
        })
        .finally(() => clearTimeout(timeout));
    }
  }, [activeTab, agent.agentUri, registrationData, registrationLoading, registrationError, normalizeResourceUrl]);

  return (
    <section
      style={{
        backgroundColor: palette.surface,
        borderRadius: '16px',
        border: `1px solid ${palette.border}`,
        boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
        overflow: 'hidden',
      }}
    >
      {/* Tab Navigation */}
      <div
        style={{
          display: 'flex',
          borderBottom: `2px solid ${palette.border}`,
          backgroundColor: palette.surfaceMuted,
          overflowX: 'auto',
        }}
      >
        {TAB_DEFS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '1rem 1.5rem',
                border: 'none',
                borderBottom: `3px solid ${isActive ? palette.accent : 'transparent'}`,
                backgroundColor: 'transparent',
                color: isActive ? palette.accent : palette.textSecondary,
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                fontSize: '0.95rem',
                whiteSpace: 'nowrap',
                position: 'relative',
                minWidth: '120px',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = palette.textPrimary;
                  e.currentTarget.style.backgroundColor = palette.surface;
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = palette.textSecondary;
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div style={{ padding: '1.5rem' }}>
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '1.5rem' }}>
            {/* Left Column: Identity Info and Endpoints stacked */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Identity Info Pane */}
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: '12px',
                  padding: '1.25rem',
                  backgroundColor: palette.surfaceMuted,
                }}
              >
              <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: palette.textPrimary }}>Identity Info</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '1rem',
                  fontSize: '0.9rem',
                }}
              >
                <div>
                  <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Agent ID</strong>
                  <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>{agent.agentId}</div>
                </div>
                <div>
                  <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Chain</strong>
                  <div style={{ color: palette.textPrimary }}>{agent.chainId}</div>
                </div>
                <div>
                  <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Owner</strong>
                  <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>
                    {shorten(agent.agentAccount)}
                  </div>
                </div>
                <div>
                  <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Created</strong>
                  <div style={{ color: palette.textPrimary }}>{formatRelativeTime(agent.createdAtTime)}</div>
                </div>
              </div>
            </div>

              {/* Endpoints Pane */}
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: '12px',
                  padding: '1.25rem',
                  backgroundColor: palette.surfaceMuted,
                }}
              >
                <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: palette.textPrimary }}>Endpoints</h3>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    fontSize: '0.9rem',
                }}
              >
                <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>A2A</strong>
                    {agent.a2aEndpoint ? (
                      <a
                        href={agent.a2aEndpoint}
                        target="_blank"
                        rel="noopener noreferrer"
                    style={{
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                          color: palette.accent,
                          textDecoration: 'none',
                          userSelect: 'text',
                          display: 'block',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.textDecoration = 'underline';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.textDecoration = 'none';
                        }}
                      >
                        {agent.a2aEndpoint}
                      </a>
                    ) : (
                      <div style={{ fontFamily: 'monospace', color: palette.textSecondary }}>—</div>
                    )}
                </div>
                <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>MCP</strong>
                    {agent.mcpEndpoint ? (
                      <a
                        href={agent.mcpEndpoint}
                        target="_blank"
                        rel="noopener noreferrer"
                    style={{
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                          color: palette.accent,
                          textDecoration: 'none',
                          userSelect: 'text',
                          display: 'block',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.textDecoration = 'underline';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.textDecoration = 'none';
                        }}
                      >
                        {agent.mcpEndpoint}
                      </a>
                    ) : (
                      <div style={{ fontFamily: 'monospace', color: palette.textSecondary }}>—</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Metadata Pane */}
            <div
              style={{
                border: `1px solid ${palette.border}`,
                borderRadius: '12px',
                padding: '1.25rem',
                backgroundColor: palette.surfaceMuted,
              }}
            >
              <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: palette.textPrimary }}>Metadata</h3>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  fontSize: '0.9rem',
                }}
              >
                {(onChainMetadata.agentCategory || agent.agentCategory) && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Category</strong>
                    <div style={{ color: palette.textPrimary, fontWeight: 500 }}>
                      {onChainMetadata.agentCategory || agent.agentCategory}
                    </div>
                  </div>
                )}
            {agent.description && (
              <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Description</strong>
                <p style={{ margin: 0, lineHeight: 1.6, color: palette.textPrimary }}>
                  {agent.description}
                </p>
              </div>
            )}
                {agent.image && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Image</strong>
                    <a
                      href={agent.image}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: palette.accent,
                        textDecoration: 'none',
                        wordBreak: 'break-all',
                        display: 'block',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.textDecoration = 'underline';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.textDecoration = 'none';
                      }}
                    >
                      {agent.image}
                    </a>
                  </div>
                )}
                {agent.agentUri && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Token URI</strong>
                    <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: palette.textPrimary, fontSize: '0.85rem' }}>
                      {agent.agentUri}
                    </div>
                  </div>
                )}
                {agent.contractAddress && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Contract Address</strong>
                    <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>
                      {shorten(agent.contractAddress)}
                    </div>
                  </div>
                )}
                {agent.did && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>DID</strong>
                    <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: palette.textPrimary, fontSize: '0.85rem' }}>
                      {agent.did}
                    </div>
                  </div>
                )}
                {agent.supportedTrust && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Supported Trust</strong>
                    <div style={{ color: palette.textPrimary }}>
                      {typeof agent.supportedTrust === 'string' ? agent.supportedTrust : JSON.stringify(agent.supportedTrust)}
                    </div>
                  </div>
                )}
                {/* On-Chain Metadata from AIAgentIdentityClient */}
                {Object.keys(onChainMetadata).length > 0 && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.5rem', marginTop: '0.5rem' }}>On-Chain Metadata</strong>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                        fontSize: '0.85rem',
                      }}
                    >
                      {Object.entries(onChainMetadata).map(([key, value]) => (
                        <div key={key}>
                          <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                            {key}
                          </strong>
                          <div style={{ color: palette.textPrimary, wordBreak: 'break-word', fontFamily: key === 'agentAccount' ? 'monospace' : 'inherit' }}>
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {metadataLoading && Object.keys(onChainMetadata).length === 0 && (
                  <div style={{ color: palette.textSecondary, fontSize: '0.85rem' }}>
                    Loading on-chain metadata...
                  </div>
                )}
                {metadataError && (
                  <div style={{ color: palette.dangerText, fontSize: '0.85rem' }}>
                    {metadataError}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'registration' && (
          <div>
            {!agent.agentUri ? (
              <p style={{ color: palette.textSecondary, margin: 0 }}>
                No registration data available for this agent.
              </p>
            ) : registrationLoading ? (
              <p style={{ color: palette.textSecondary, margin: 0 }}>
                Loading registration data...
              </p>
            ) : registrationError ? (
              <p style={{ color: palette.dangerText, margin: 0 }}>
                {registrationError}
              </p>
            ) : registrationData ? (
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: '12px',
                  padding: '1rem',
                  backgroundColor: palette.surfaceMuted,
                  maxHeight: '600px',
                  overflow: 'auto',
                }}
              >
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: '0.85rem',
                    margin: 0,
                    color: palette.textPrimary,
                  }}
                >
                  {registrationData}
                </pre>
              </div>
            ) : (
              <p style={{ color: palette.textSecondary, margin: 0 }}>
                No registration data available.
              </p>
            )}
          </div>
        )}

        {activeTab === 'feedback' && (
          <div>
            <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
              Feedback entries and aggregated reputation summary for this agent.
            </p>
            {feedbackLoading && (
              <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
                Loading feedback...
              </p>
            )}
            {feedbackError && (
              <p style={{ color: palette.dangerText, marginTop: 0, marginBottom: '1rem' }}>
                {feedbackError}
              </p>
            )}
            {feedbackSummary && (
              <div
                style={{
                  display: 'flex',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  fontSize: '0.9rem',
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  backgroundColor: palette.surfaceMuted,
                  borderRadius: '8px',
                }}
              >
                <span>
                  <strong>Feedback count:</strong>{' '}
                  {feedbackSummary?.count ?? '0'}
                </span>
                <span>
                  <strong>Average score:</strong>{' '}
                  {typeof feedbackSummary?.averageScore === 'number'
                    ? feedbackSummary.averageScore.toFixed(2)
                    : 'N/A'}
                </span>
              </div>
            )}
            <div
              style={{
                border: `1px solid ${palette.border}`,
                borderRadius: '12px',
                padding: '1rem',
                maxHeight: 500,
                overflow: 'auto',
                backgroundColor: palette.surfaceMuted,
              }}
            >
              {feedbackList.length === 0 ? (
                <p style={{ color: palette.textSecondary, margin: 0 }}>
                  No feedback entries found for this agent.
                </p>
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
                  {feedbackList.map((item, idx) => {
                    const record = item as any;
                    return (
                      <li
                        key={record.id ?? record.index ?? idx}
                        style={{
                          border: `1px solid ${palette.border}`,
                          borderRadius: '10px',
                          padding: '0.75rem',
                          backgroundColor: palette.surface,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                          }}
                        >
                          <span>Score: {record.score ?? 'N/A'}</span>
                          {record.isRevoked && (
                            <span style={{ color: palette.dangerText }}>Revoked</span>
                          )}
                        </div>
                        {record.clientAddress && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Client:</strong>{' '}
                              <code style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{shorten(record.clientAddress)}</code>
                            </div>
                          )}
                          {record.comment && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Comment:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{record.comment}</span>
                            </div>
                          )}
                          {typeof record.ratingPct === 'number' && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Rating:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{record.ratingPct}%</span>
                            </div>
                          )}
                          {record.txHash && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>TX Hash:</strong>{' '}
                              <code style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{shorten(record.txHash)}</code>
                            </div>
                          )}
                          {record.blockNumber && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Block:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{record.blockNumber}</span>
                            </div>
                          )}
                          {(record.timestamp || record.createdAt) && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Time:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{formatRelativeTime(record.timestamp ?? (record.createdAt ? new Date(record.createdAt).getTime() / 1000 : null))}</span>
                            </div>
                          )}
                          {typeof record.responseCount === 'number' && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Responses:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{record.responseCount}</span>
                          </div>
                        )}
                        {record.feedbackUri && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Feedback URI:</strong>{' '}
                          <a
                            href={record.feedbackUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                  fontSize: '0.85rem',
                              color: palette.accent,
                              textDecoration: 'none',
                              wordBreak: 'break-all',
                            }}
                          >
                                {record.feedbackUri}
                              </a>
                            </div>
                          )}
                          {record.feedbackJson && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Feedback JSON:</strong>
                              <pre
                                style={{
                                  margin: '0.5rem 0 0',
                                  padding: '0.5rem',
                                  backgroundColor: palette.background,
                                  borderRadius: '4px',
                                  fontSize: '0.75em',
                                  overflow: 'auto',
                                  maxHeight: '200px',
                                  fontFamily: 'ui-monospace, monospace',
                                }}
                              >
                                {(() => {
                                  try {
                                    return JSON.stringify(JSON.parse(record.feedbackJson), null, 2);
                                  } catch {
                                    return record.feedbackJson;
                                  }
                                })()}
                              </pre>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeTab === 'validation' && (
          <div>
            <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
              Pending and completed validations for this agent from the on-chain
              validation registry.
            </p>
            {validationsLoading && (
              <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
                Loading validations...
              </p>
            )}
            {validationsError && (
              <p style={{ color: palette.dangerText, marginTop: 0, marginBottom: '1rem' }}>
                {validationsError}
              </p>
            )}
            {!validations ? (
              <p style={{ color: palette.textSecondary }}>
                Unable to load validation data.
              </p>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                }}
              >
                <div>
                  <h4
                    style={{
                      margin: '0 0 0.5rem',
                      fontSize: '0.9rem',
                    }}
                  >
                    Completed validations ({completedValidations.length})
                  </h4>
                  {completedValidations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {completedValidations.map((item: any, index) => (
                        <div
                          key={index}
                  style={{
                    border: `1px solid ${palette.border}`,
                            borderRadius: '8px',
                            padding: '0.75rem',
                    backgroundColor: palette.surfaceMuted,
                  }}
                >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {item.requestHash && (
                              <div>
                                <strong>Request Hash:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.requestHash.length > 20 ? `${item.requestHash.slice(0, 10)}…${item.requestHash.slice(-8)}` : item.requestHash}
                                </code>
                              </div>
                            )}
                            {item.response !== undefined && (
                              <div>
                                <strong>Response:</strong> {item.response}
                              </div>
                            )}
                            {item.tag && (
                              <div>
                                <strong>Tag:</strong> {item.tag}
                              </div>
                            )}
                            {item.txHash && (
                              <div>
                                <strong>TX Hash:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.txHash.length > 20 ? `${item.txHash.slice(0, 10)}…${item.txHash.slice(-8)}` : item.txHash}
                                </code>
                              </div>
                            )}
                            {item.blockNumber && (
                              <div>
                                <strong>Block:</strong> {item.blockNumber}
                              </div>
                            )}
                            {item.timestamp && (
                              <div>
                                <strong>Timestamp:</strong> {new Date(Number(item.timestamp) * 1000).toLocaleString()}
                              </div>
                            )}
                            {item.validatorAddress && (
                              <div>
                                <strong>Validator:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.validatorAddress.length > 20 ? `${item.validatorAddress.slice(0, 10)}…${item.validatorAddress.slice(-8)}` : item.validatorAddress}
                                </code>
                              </div>
                            )}
                            {item.requestUri && (
                              <div>
                                <strong>Request URI:</strong>{' '}
                                <a href={item.requestUri} target="_blank" rel="noopener noreferrer" style={{ color: palette.accent, wordBreak: 'break-all', fontSize: '0.85em' }}>
                                  {item.requestUri}
                                </a>
                              </div>
                            )}
                            {item.requestJson && (
                              <div>
                                <strong>Request JSON:</strong>
                                <pre
                                  style={{
                                    margin: '0.5rem 0 0',
                                    padding: '0.5rem',
                                    backgroundColor: palette.background,
                                    borderRadius: '4px',
                                    fontSize: '0.75em',
                                    overflow: 'auto',
                                    maxHeight: '200px',
                                    fontFamily: 'ui-monospace, monospace',
                                  }}
                                >
                                  {formatJsonIfPossible(item.requestJson)}
                                </pre>
                              </div>
                            )}
                            {item.responseUri && (
                              <div>
                                <strong>Response URI:</strong>{' '}
                                <a href={item.responseUri} target="_blank" rel="noopener noreferrer" style={{ color: palette.accent, wordBreak: 'break-all', fontSize: '0.85em' }}>
                                  {item.responseUri}
                                </a>
                              </div>
                            )}
                            {item.responseJson && (
                              <div>
                                <strong>Response JSON:</strong>
                                <pre
                                  style={{
                                    margin: '0.5rem 0 0',
                                    padding: '0.5rem',
                                    backgroundColor: palette.background,
                                    borderRadius: '4px',
                                    fontSize: '0.75em',
                                    overflow: 'auto',
                                    maxHeight: '200px',
                                    fontFamily: 'ui-monospace, monospace',
                                  }}
                                >
                                  {formatJsonIfPossible(item.responseJson)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: palette.textSecondary, margin: 0 }}>
                      No completed validations.
                    </p>
                  )}
                </div>
                <div>
                  <h4
                    style={{
                      margin: '0 0 0.5rem',
                      fontSize: '0.9rem',
                    }}
                  >
                    Pending validations ({pendingValidations.length})
                  </h4>
                  {pendingValidations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {pendingValidations.map((item: any, index) => (
                        <div
                          key={index}
                  style={{
                    border: `1px solid ${palette.border}`,
                            borderRadius: '8px',
                            padding: '0.75rem',
                    backgroundColor: palette.surfaceMuted,
                  }}
                >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {item.requestHash && (
                              <div>
                                <strong>Request Hash:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.requestHash.length > 20 ? `${item.requestHash.slice(0, 10)}…${item.requestHash.slice(-8)}` : item.requestHash}
                                </code>
                              </div>
                            )}
                            <div style={{ color: palette.textSecondary }}>
                              <strong>Status:</strong> Awaiting response
                            </div>
                            {item.tag && (
                              <div>
                                <strong>Tag:</strong> {item.tag}
                              </div>
                            )}
                            {item.validatorAddress && (
                              <div>
                                <strong>Validator:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.validatorAddress.length > 20 ? `${item.validatorAddress.slice(0, 10)}…${item.validatorAddress.slice(-8)}` : item.validatorAddress}
                                </code>
                              </div>
                            )}
                            {item.lastUpdate && (
                              <div>
                                <strong>Last Update:</strong> {new Date(Number(item.lastUpdate) * 1000).toLocaleString()}
                              </div>
                            )}
                            {item.requestUri && (
                              <div>
                                <strong>Request URI:</strong>{' '}
                                <a href={item.requestUri} target="_blank" rel="noopener noreferrer" style={{ color: palette.accent, wordBreak: 'break-all', fontSize: '0.85em' }}>
                                  {item.requestUri}
                                </a>
                              </div>
                            )}
                            {item.requestJson && (
                              <div>
                                <strong>Request JSON:</strong>
                                <pre
                                  style={{
                                    margin: '0.5rem 0 0',
                                    padding: '0.5rem',
                                    backgroundColor: palette.background,
                                    borderRadius: '4px',
                                    fontSize: '0.75em',
                                    overflow: 'auto',
                                    maxHeight: '200px',
                                    fontFamily: 'ui-monospace, monospace',
                                  }}
                                >
                                  {formatJsonIfPossible(item.requestJson)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: palette.textSecondary, margin: 0 }}>
                      No pending validations.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'associations' && (
          <div>
            <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
              Associated accounts for this agent's smart account ({agent.agentAccount ? shorten(agent.agentAccount) : '—'})
            </p>
            {!agent.agentAccount ? (
              <p style={{ color: palette.textSecondary, margin: 0 }}>
                No agent account address available.
              </p>
            ) : associationsLoading ? (
              <p style={{ color: palette.textSecondary, margin: 0 }}>
                Loading associations...
              </p>
            ) : associationsData?.ok === false ? (
              <div
                style={{
                  borderRadius: '8px',
                  border: `1px solid ${palette.dangerText}`,
                  backgroundColor: `${palette.dangerText}20`,
                  padding: '0.75rem',
                  color: palette.dangerText,
                  fontSize: '0.9rem',
                }}
              >
                {associationsData.error}
              </div>
            ) : associationsData?.ok === true && associationsData.associations.length === 0 ? (
              <p style={{ color: palette.textSecondary, margin: 0 }}>
                No associations found for this account.
              </p>
            ) : associationsData?.ok === true ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {associationsData.associations.map((assoc, index) => {
                  const active = assoc.revokedAt === 0;
                  const initiatorAddr = assoc.initiator ?? assoc.initiatorAddress ?? '—';
                  const approverAddr = assoc.approver ?? assoc.approverAddress ?? '—';
                  const counterpartyAddr = assoc.counterparty ?? assoc.counterpartyAddress ?? '—';
                  const validAtValue =
                    (typeof assoc.validAt === 'number' ? assoc.validAt : assoc.record?.validAt) ?? 0;
                  const validUntilValue =
                    (typeof assoc.validUntil === 'number' ? assoc.validUntil : assoc.record?.validUntil) ?? 0;
                  const decoded =
                    assoc.record?.data && assoc.record.data.startsWith('0x')
                      ? decodeAssociationData(assoc.record.data as `0x${string}`)
                      : null;
                  const assocTypeLabel =
                    decoded
                      ? ASSOC_TYPE_OPTIONS.find((o) => o.value === decoded.assocType)?.label ??
                        `Type ${decoded.assocType}`
                      : null;
                  const verification = assoc.verification;

                  return (
                    <div
                      key={`${assoc.associationId}-${index}`}
                      style={{
                        border: `1px solid ${palette.border}`,
                        borderRadius: '8px',
                        padding: '1rem',
                        backgroundColor: palette.surfaceMuted,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '1rem',
                          marginBottom: '0.75rem',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '0.85rem',
                            color: palette.textSecondary,
                            fontWeight: 600,
                          }}
                        >
                          #{index + 1}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span
                            style={{
                              borderRadius: '6px',
                              padding: '0.25rem 0.75rem',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor: active
                                ? `${palette.accent}20`
                                : `${palette.dangerText}20`,
                              color: active ? palette.accent : palette.dangerText,
                            }}
                          >
                            {active ? 'Active' : 'Revoked'}
                          </span>
                          {verification && (
                            <>
                              <span
                                style={{
                                  borderRadius: '6px',
                                  padding: '0.25rem 0.75rem',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  backgroundColor: verification.recordHashMatches
                                    ? `${palette.accent}20`
                                    : `${palette.dangerText}20`,
                                  color: verification.recordHashMatches ? palette.accent : palette.dangerText,
                                }}
                                title={
                                  verification.recordHashMatches
                                    ? 'associationId matches EIP-712 digest(record)'
                                    : 'associationId does not match digest(record)'
                                }
                              >
                                {verification.recordHashMatches ? 'Digest OK' : 'Digest Mismatch'}
                              </span>
                              <span
                                style={{
                                  borderRadius: '6px',
                                  padding: '0.25rem 0.75rem',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  backgroundColor: verification.initiator.ok
                                    ? `${palette.accent}20`
                                    : `${palette.dangerText}20`,
                                  color: verification.initiator.ok ? palette.accent : palette.dangerText,
                                }}
                                title={verification.initiator.reason || verification.initiator.method}
                              >
                                {verification.initiator.ok ? 'Initiator Sig OK' : 'Initiator Sig ❌'}
                              </span>
                              <span
                                style={{
                                  borderRadius: '6px',
                                  padding: '0.25rem 0.75rem',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  backgroundColor: verification.approver.ok
                                    ? `${palette.accent}20`
                                    : `${palette.dangerText}20`,
                                  color: verification.approver.ok ? palette.accent : palette.dangerText,
                                }}
                                title={verification.approver.reason || verification.approver.method}
                              >
                                {verification.approver.ok ? 'Approver Sig OK' : 'Approver Sig ❌'}
                              </span>
                            </>
                          )}
                          {active && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!agent.agentAccount) return;
                                setRevokingId(assoc.associationId);
                                setRevokeTx(null);
                                setRevokeReceipt(null);
                                setRevokeError(null);
                                try {
                                  const res = await fetch('/api/associations/revoke', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      associationId: assoc.associationId,
                                      fromAccount: agent.agentAccount,
                                      revokedAt: 0,
                                    }),
                                  });
                                  const json = await res.json();
                                  if (!json.ok) throw new Error(json.error ?? 'Failed to revoke');
                                  setRevokeTx(json.txHash ?? json.userOpHash);

                                  if (json.txHash) {
                                    for (let k = 0; k < 30; k++) {
                                      const r = await fetch(`/api/tx/receipt?hash=${json.txHash}`, {
                                        cache: 'no-store',
                                      }).then((x) => x.json());
                                      setRevokeReceipt(r);
                                      if (r.ok && r.found) break;
                                      await new Promise((resolve) => setTimeout(resolve, 2000));
                                    }
                                  }
                                  
                                  // Refresh associations
                                  await refreshAssociations();
                                } catch (err: any) {
                                  setRevokeError(err?.message ?? 'Failed to revoke');
                                } finally {
                                  setRevokingId(null);
                                }
                              }}
                              disabled={revokingId === assoc.associationId}
                              style={{
                                borderRadius: '6px',
                                border: `1px solid ${palette.border}`,
                                padding: '0.25rem 0.75rem',
                                fontSize: '0.75rem',
                                backgroundColor: palette.surface,
                                color: palette.textPrimary,
                                cursor: revokingId === assoc.associationId ? 'not-allowed' : 'pointer',
                                opacity: revokingId === assoc.associationId ? 0.6 : 1,
                              }}
                            >
                              {revokingId === assoc.associationId ? 'Revoking...' : 'Revoke'}
                            </button>
                          )}
                        </div>
                      </div>
                      {(() => {
                        // Determine which address is the counterparty (the associated agent)
                        const counterparty = counterpartyAddr;
                        const counterpartyInfo = getAgentInfoForAddress(counterparty);
                        
                        return (
                          <>
                            {counterpartyInfo && (
                              <div
                                style={{
                                  marginBottom: '0.75rem',
                                  padding: '0.75rem',
                                  borderRadius: '6px',
                                  backgroundColor: palette.surface,
                                  border: `1px solid ${palette.border}`,
                                }}
                              >
                                <div style={{ fontSize: '0.75rem', color: palette.textSecondary, marginBottom: '0.25rem' }}>
                                  Associated Agent
                                </div>
                                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: palette.textPrimary }}>
                                  {counterpartyInfo.agentName || `Agent #${counterpartyInfo.agentId}`}
                                </div>
                                {counterpartyInfo.agentId && (
                                  <div style={{ fontSize: '0.8rem', color: palette.textSecondary, marginTop: '0.25rem' }}>
                                    ID: {counterpartyInfo.agentId}
                                  </div>
                                )}
                                <div style={{ fontSize: '0.8rem', color: palette.textSecondary, fontFamily: 'monospace', marginTop: '0.25rem' }}>
                                  {shorten(counterparty)}
                                </div>
                              </div>
                            )}
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                gap: '0.75rem',
                                fontSize: '0.85rem',
                              }}
                            >
                        <div>
                          <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                            Initiator
                          </div>
                          <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all' }}>
                            {initiatorAddr}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                            Approver
                          </div>
                          <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all' }}>
                            {approverAddr}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                            Counterparty
                          </div>
                          <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all' }}>
                            {counterpartyAddr}
                          </div>
                        </div>
                        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                          <div>
                            <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                              Valid At
                            </div>
                            <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>
                              {validAtValue}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                              Valid Until
                            </div>
                            <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>
                              {validUntilValue || 'Never'}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                              Revoked At
                            </div>
                            <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>
                              {assoc.revokedAt || '0'}
                            </div>
                          </div>
                        </div>
                        {(decoded || assoc.record || assoc.initiatorKeyType || assoc.approverKeyType) && (
                          <div
                            style={{
                              gridColumn: '1 / -1',
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                              gap: '0.75rem',
                            }}
                          >
                            <div>
                              <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                                Assoc Type
                              </div>
                              <div style={{ color: palette.textPrimary }}>
                                {assocTypeLabel ?? '—'}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                                Description
                              </div>
                              <div style={{ color: palette.textPrimary, wordBreak: 'break-word' }}>
                                {decoded?.description ?? '—'}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                                interfaceId
                              </div>
                              <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>
                                {assoc.record?.interfaceId ?? '—'}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                                initiatorKeyType
                              </div>
                              <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>
                                {assoc.initiatorKeyType ?? '—'}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                                approverKeyType
                              </div>
                              <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>
                                {assoc.approverKeyType ?? '—'}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                                initiatorSignature
                              </div>
                              <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all' }}>
                                {assoc.initiatorSignature ? shorten(assoc.initiatorSignature) : '—'}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                                approverSignature
                              </div>
                              <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all' }}>
                                {assoc.approverSignature ? shorten(assoc.approverSignature) : '—'}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                                record.data
                              </div>
                              <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all' }}>
                                {assoc.record?.data ? shorten(assoc.record.data) : '—'}
                              </div>
                            </div>
                          </div>
                        )}
                        <div style={{ gridColumn: '1 / -1' }}>
                          <div style={{ color: palette.textSecondary, marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                            Association ID
                          </div>
                          <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all', fontSize: '0.8rem' }}>
                            {assoc.associationId}
                          </div>
                        </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            ) : null}
            
            {revokeTx && (
              <div
                style={{
                  marginTop: '1rem',
                  borderRadius: '8px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  padding: '0.75rem',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ color: palette.textSecondary, marginBottom: '0.25rem' }}>Revoke Transaction:</div>
                <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all' }}>
                  {revokeTx}
                </div>
                {revokeReceipt?.ok && revokeReceipt.found ? (
                  <div style={{ color: palette.textSecondary, marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    Status: {String(revokeReceipt.receipt.status)}, Block:{' '}
                    {String(revokeReceipt.receipt.blockNumber)}
                  </div>
                ) : null}
              </div>
            )}
            {revokeError && (
              <div
                style={{
                  marginTop: '1rem',
                  borderRadius: '8px',
                  border: `1px solid ${palette.dangerText}`,
                  backgroundColor: `${palette.dangerText}20`,
                  padding: '0.75rem',
                  color: palette.dangerText,
                  fontSize: '0.85rem',
                }}
              >
                {revokeError}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default AgentDetailsTabs;
