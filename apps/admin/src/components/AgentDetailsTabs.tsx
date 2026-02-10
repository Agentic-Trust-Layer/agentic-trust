'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
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
  uaid: string;
  agent: AgentsPageAgent;
  feedbackItems?: unknown[];
  feedbackSummary?: AgentDetailsFeedbackSummary;
  validations?: AgentDetailsValidationsSummary | null;
  onChainMetadata?: Record<string, string>;
  /**
   * When set, renders only this panel (no tab bar).
   * Useful for embedding inside dialogs.
   */
  renderOnlyTab?: 'feedback' | 'validation' | 'associations';
  /** Render without the outer framed container (for dialogs). */
  embedded?: boolean;
};

// Tab definitions - labels will be computed with counts from agent prop where applicable
const ALL_TAB_DEFS = [
  // Main identity tabs (ENS/HOL are conditionally shown)
  { id: 'id8004', label: '8004' },
  { id: 'ens', label: 'ENS' },
  { id: 'hol', label: 'HOL' },
  // Opened via dialogs (not shown in the main tab bar)
  { id: 'feedback', label: 'Reviews' },
  { id: 'validation', label: 'Validations' },
  { id: 'associations', label: 'Relationships' },
] as const;

const MODAL_TAB_DEFS = ALL_TAB_DEFS.filter(
  (t) => t.id === 'feedback' || t.id === 'validation' || t.id === 'associations',
);

type TabId = (typeof ALL_TAB_DEFS)[number]['id'];
type ModalTabId = 'feedback' | 'validation' | 'associations';

const MODAL_TAB_IDS: ModalTabId[] = ['feedback', 'validation', 'associations'];
const isModalTab = (tabId: TabId): tabId is ModalTabId =>
  (MODAL_TAB_IDS as unknown as string[]).includes(tabId);

const shorten = (value?: string | null) => {
  if (!value) return '—';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
};

function getChainLabel(chainId: number | null | undefined): string {
  if (!chainId || !Number.isFinite(chainId)) return 'Unknown chain';
  if (chainId === 1) return 'Mainnet';
  if (chainId === 11155111) return 'Sepolia';
  if (chainId === 84532) return 'Base Sepolia';
  if (chainId === 11155420) return 'OP Sepolia';
  if (chainId === 295) return 'Hashgraph Online';
  return `Chain ${chainId}`;
}

function parseRegistryFromDid(did: unknown): { registryId: '8004' | '8122'; chainId: number } | null {
  if (typeof did !== 'string') return null;
  const raw = did.trim();
  const m = /^did:(8004|8122):(\d+):/.exec(raw);
  if (!m) return null;
  const chainId = Number(m[2]);
  if (!Number.isFinite(chainId)) return null;
  return { registryId: m[1] as '8004' | '8122', chainId };
}

function parseRegistryFromUaid(
  uaid: unknown,
): { registryId: '8004' | '8122'; chainId: number; source: 'targetDid' | 'nativeId' } | null {
  if (typeof uaid !== 'string') return null;
  const raw = uaid.trim();
  if (!raw.startsWith('uaid:did:')) return null;

  const afterPrefix = raw.slice('uaid:did:'.length);
  const idPart = (afterPrefix.split(';')[0] ?? '').trim();
  if (!idPart) return null;

  const targetDid = `did:${idPart}`;
  const targetParsed = parseRegistryFromDid(targetDid);
  if (targetParsed) return { ...targetParsed, source: 'targetDid' };

  const marker = ';nativeId=';
  const idx = raw.indexOf(marker);
  if (idx !== -1) {
    const start = idx + marker.length;
    const tail = raw.slice(start);
    const end = tail.indexOf(';');
    const encoded = (end === -1 ? tail : tail.slice(0, end)).trim();
    if (encoded) {
      // UAID param encoding uses %3B/%3D/%25 (see core/server/lib/uaid.ts).
      const decoded = encoded
        .replace(/%3D/gi, '=')
        .replace(/%3B/gi, ';')
        .replace(/%25/gi, '%');
      const nativeParsed = parseRegistryFromDid(decoded);
      if (nativeParsed) return { ...nativeParsed, source: 'nativeId' };
    }
  }

  return null;
}

function parseChainIdFromUaid(uaid: unknown): number | null {
  if (typeof uaid !== 'string') return null;
  const raw = uaid.trim();
  if (!raw.startsWith('uaid:did:')) return null;
  const afterPrefix = raw.slice('uaid:did:'.length);
  const idPart = (afterPrefix.split(';')[0] ?? '').trim();
  if (!idPart) return null;
  // idPart is "<method>:<...>" (e.g. "ethr:11155111:0xabc...")
  const parts = idPart.split(':').filter(Boolean);
  if (parts.length < 2) return null;
  const maybeChain = parts[1];
  if (!/^\d+$/.test(maybeChain)) return null;
  const n = Number(maybeChain);
  return Number.isFinite(n) ? n : null;
}

function formatJsonIfPossible(text: string | null | undefined): string | null {
  if (!text) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function parseJsonObject(text: string | null | undefined): any | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
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

type StructuredOnchainMetadataEntry = {
  id?: string;
  key?: string;
  value?: string;
  setBy?: string;
  txHash?: string;
  blockNumber?: string | number;
  timestamp?: string | number;
  setAt?: string | number;
  indexedKey?: string;
  valueHex?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toEpochSeconds(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  // Heuristic: treat > 1e12 as ms.
  const seconds = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  return seconds > 0 ? seconds : null;
}

function formatIsoTime(value: unknown): string | null {
  const s = toEpochSeconds(value);
  if (!s) return null;
  try {
    return new Date(s * 1000).toISOString();
  } catch {
    return null;
  }
}

const AgentDetailsTabs = ({
  uaid,
  agent,
  feedbackItems: initialFeedbackItems,
  feedbackSummary: initialFeedbackSummary,
  validations: initialValidations,
  onChainMetadata: _initialOnChainMetadata = {},
  renderOnlyTab,
  embedded = false,
}: AgentDetailsTabsProps) => {
  const [activeTab, setActiveTab] = useState<TabId>(renderOnlyTab ?? 'id8004');
  const [modalTab, setModalTab] = useState<ModalTabId | null>(null);

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

  // NOTE: Identity tabs use KB-provided descriptor JSON and onchainMetadataJson (no on-chain fetch).

  // Normalize UAID to avoid double-encoding (e.g. uaid%253Adid...).
  const canonicalUaid = useMemo(() => {
    let v = String(uaid || '');
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
  }, [uaid]);
  
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

  // Get counts from discovery agent query (not from detail queries)
  const validationPendingCount = typeof agent.validationPendingCount === 'number' && agent.validationPendingCount >= 0
    ? agent.validationPendingCount
    : null;
  const validationCompletedCount = typeof agent.validationCompletedCount === 'number' && agent.validationCompletedCount >= 0
    ? agent.validationCompletedCount
    : null;
  const totalValidationCount = (validationPendingCount ?? 0) + (validationCompletedCount ?? 0);

  const feedbackCount = typeof agent.feedbackCount === 'number' && agent.feedbackCount >= 0
    ? agent.feedbackCount
    : null;

  const initiatedAssociationCount = typeof agent.initiatedAssociationCount === 'number' && Number.isFinite(agent.initiatedAssociationCount) && agent.initiatedAssociationCount >= 0
    ? agent.initiatedAssociationCount
    : null;
  const approvedAssociationCount = typeof agent.approvedAssociationCount === 'number' && Number.isFinite(agent.approvedAssociationCount) && agent.approvedAssociationCount >= 0
    ? agent.approvedAssociationCount
    : null;
  const totalAssociationCount = (initiatedAssociationCount ?? 0) + (approvedAssociationCount ?? 0);

  // Compute tab labels with counts
  const getTabLabel = useCallback((tabId: TabId): string => {
    switch (tabId) {
      case 'feedback':
        return feedbackCount !== null ? `Reviews (${feedbackCount})` : 'Reviews';
      case 'validation':
        return totalValidationCount > 0 ? `Validations (${totalValidationCount})` : 'Validations';
      case 'associations':
        return totalAssociationCount > 0 ? `Relationships (${totalAssociationCount})` : 'Relationships';
      default:
        return ALL_TAB_DEFS.find((t) => t.id === tabId)?.label ?? tabId;
    }
  }, [feedbackCount, totalValidationCount, totalAssociationCount]);

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
    if (
      (activeTab === 'associations' || modalTab === 'associations') &&
      agent.agentAccount &&
      !associationsData &&
      !associationsLoading
    ) {
      void refreshAssociations();
    }
  }, [activeTab, modalTab, agent.agentAccount, associationsData, associationsLoading, refreshAssociations]);

  // Lazy load feedback data when feedback tab is selected
  useEffect(() => {
    if (activeTab !== 'feedback' && modalTab !== 'feedback') return;
    if (feedbackLoaded || feedbackLoading) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    (async () => {
      setFeedbackLoading(true);
      setFeedbackError(null);
      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(canonicalUaid)}/feedback?includeRevoked=true&limit=200`,
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
  }, [activeTab, modalTab, canonicalUaid]);

  // Lazy load validations data when validation tab is selected
  useEffect(() => {
    if (activeTab !== 'validation' && modalTab !== 'validation') return;
    if (validationsLoaded || validationsLoading) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    (async () => {
      setValidationsLoading(true);
      setValidationsError(null);
      try {
        const [validationsRes, validationResponsesRes] = await Promise.all([
          fetch(`/api/agents/${encodeURIComponent(canonicalUaid)}/validations`, { signal: controller.signal }),
          fetch(
            `/api/agents/${encodeURIComponent(canonicalUaid)}/validation-responses?limit=200&offset=0&orderBy=timestamp&orderDirection=DESC`,
            { signal: controller.signal },
          ).catch(() => null),
        ]);

        const json = await validationsRes.json().catch(() => null);
        const graphQLJson =
          validationResponsesRes?.ok ? await validationResponsesRes.json().catch(() => null) : null;
        if (cancelled) return;
        if (!validationsRes.ok) {
          setValidationsError(
            (json as any)?.message ||
              (json as any)?.error ||
              `Failed to load validations (${validationsRes.status})`,
          );
          setValidationsLoaded(true);
          return;
        }

        const pendingArray = Array.isArray(json?.pending) ? json.pending : [];
        const completedArray = Array.isArray(json?.completed) ? json.completed : [];

        const normalizeRequestHash = (hash: unknown): string | null => {
          if (!hash) return null;
          let hashStr: string;
          if (typeof hash === 'string') {
            hashStr = hash;
          } else if (typeof hash === 'bigint' || typeof hash === 'number') {
            hashStr = hash.toString(16);
            if (!hashStr.startsWith('0x')) {
              hashStr = '0x' + hashStr.padStart(64, '0');
            }
          } else {
            hashStr = String(hash);
          }
          if (!hashStr.startsWith('0x')) {
            hashStr = '0x' + hashStr;
          }
          return hashStr.toLowerCase();
        };

        const graphQLRequests = Array.isArray(graphQLJson?.validationRequests)
          ? graphQLJson.validationRequests
          : [];

        const graphQLByRequestHash = new Map<string, any>();
        for (const requestEntry of graphQLRequests) {
          const normalized = normalizeRequestHash(requestEntry?.requestHash);
          if (normalized) {
            graphQLByRequestHash.set(normalized, requestEntry);
          }
        }

        const augmentValidation = (entry: any): any => {
          const normalizedRequestHash = normalizeRequestHash(entry?.requestHash);
          if (!normalizedRequestHash) return entry;
          const graphQLEntry = graphQLByRequestHash.get(normalizedRequestHash);
          if (!graphQLEntry) return entry;
          return {
            ...entry,
            txHash: typeof graphQLEntry.txHash === 'string' ? graphQLEntry.txHash : entry.txHash ?? null,
            blockNumber: typeof graphQLEntry.blockNumber === 'number' ? graphQLEntry.blockNumber : entry.blockNumber ?? null,
            timestamp: graphQLEntry.timestamp ?? entry.lastUpdate ?? null,
            requestUri: typeof graphQLEntry.requestUri === 'string' ? graphQLEntry.requestUri : null,
            requestJson: typeof graphQLEntry.requestJson === 'string' ? graphQLEntry.requestJson : null,
            responseUri: typeof graphQLEntry.responseUri === 'string' ? graphQLEntry.responseUri : null,
            responseJson: typeof graphQLEntry.responseJson === 'string' ? graphQLEntry.responseJson : null,
            createdAt: typeof graphQLEntry.createdAt === 'string' ? graphQLEntry.createdAt : null,
            updatedAt: typeof graphQLEntry.updatedAt === 'string' ? graphQLEntry.updatedAt : null,
          };
        };

        setValidations({
          pending: pendingArray.map(augmentValidation),
          completed: completedArray.map(augmentValidation),
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
  }, [activeTab, modalTab, canonicalUaid]);

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

  // Keep activeTab in sync when used as an embedded single-panel renderer
  useEffect(() => {
    if (!renderOnlyTab) return;
    if (activeTab !== renderOnlyTab) {
      setActiveTab(renderOnlyTab);
    }
  }, [renderOnlyTab, activeTab]);

  const ContainerTag: any = embedded ? 'div' : 'section';
  const containerStyle: React.CSSProperties = embedded
    ? {}
    : {
        backgroundColor: palette.surface,
        borderRadius: '16px',
        border: `1px solid ${palette.border}`,
        boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
        overflow: 'hidden',
      };

  const hasEnsIdentity = Boolean((agent as any).identityEnsDid || (agent as any).identityEnsDescriptorJson);
  const hasHolIdentity = Boolean(
    (agent as any).identityHolDid || (agent as any).identityHolUaid || (agent as any).identityHolDescriptorJson,
  );
  const didForRegistry = String((agent as any).identity8004Did ?? (agent as any).did ?? '').trim();
  const parsedRegistryFromUaid = parseRegistryFromUaid(uaid);
  const has8004Registry = parsedRegistryFromUaid?.registryId === '8004' || didForRegistry.startsWith('did:8004:');
  const has8122Registry = parsedRegistryFromUaid?.registryId === '8122' || didForRegistry.startsWith('did:8122:');
  const isSmartAgent =
    (agent as any).isSmartAgent === true ||
    (typeof (agent as any).smartAgentAccount === 'string' && (agent as any).smartAgentAccount.trim().startsWith('0x'));

  const mainTabDefs = useMemo(() => {
    const did = (agent as any).identity8004Did ?? agent.did ?? null;
    const descriptor = parseJsonObject((agent as any).identity8004DescriptorJson ?? (agent as any).rawJson ?? null) ?? {};
    const parsedDid = parseRegistryFromUaid(uaid) ?? parseRegistryFromDid(did);
    const registryId: '8004' | '8122' | null = (() => {
      if (parsedDid?.registryId) return parsedDid.registryId;
      if (has8122Registry) return '8122';
      if (has8004Registry) return '8004';
      const registryNamespace =
        typeof (descriptor as any)?.registryNamespace === 'string'
          ? String((descriptor as any).registryNamespace).trim().toLowerCase()
          : '';
      const type =
        typeof (descriptor as any)?.type === 'string'
          ? String((descriptor as any).type).trim().toLowerCase()
          : '';
      if (registryNamespace.includes('8122') || type.includes('8122')) return '8122';
      if (registryNamespace.includes('8004') || type.includes('8004')) return '8004';
      return null;
    })();
    const chainIdForRegistry =
      parsedDid?.chainId ??
      (typeof agent.chainId === 'number' && Number.isFinite(agent.chainId) && agent.chainId > 0 ? agent.chainId : null) ??
      parseChainIdFromUaid(uaid);
    const chainLabel = getChainLabel(chainIdForRegistry);
    const registryLabel = (() => {
      // If the agent has no on-chain registry identity, do not imply "8004".
      if (!registryId) {
        return isSmartAgent ? `Smart Agent (${chainLabel})` : `Agent (${chainLabel})`;
      }
      return isSmartAgent ? `Smart Agent (${registryId} ${chainLabel})` : `${registryId} ${chainLabel}`;
    })();

    const tabs: Array<{ id: TabId; label: string }> = [
      { id: 'id8004', label: registryLabel },
    ];
    if (hasEnsIdentity) tabs.push({ id: 'ens', label: 'ENS' });
    if (hasHolIdentity) tabs.push({ id: 'hol', label: 'HOL' });
    return tabs;
  }, [agent, uaid, hasEnsIdentity, hasHolIdentity, isSmartAgent, has8004Registry, has8122Registry]);

  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const registerProtocols = useMemo(
    () => {
      const out: Array<{ id: string; label: string; description: string }> = [];
      if (!has8004Registry) {
        out.push({ id: '8004', label: '8004', description: 'Register/update on-chain identity (ERC-8004)' });
      }
      if (!has8122Registry) {
        out.push({ id: '8122', label: '8122', description: 'Register/update on-chain identity (ERC-8122)' });
      }
      if (!hasEnsIdentity) {
        out.push({ id: 'ens', label: 'ENS', description: 'Publish ENS identity' });
      }
      if (!hasHolIdentity) {
        out.push({ id: 'hol', label: 'HOL', description: 'Register with Hashgraph Online' });
      }
      return out;
    },
    [has8004Registry, has8122Registry, hasEnsIdentity, hasHolIdentity],
  );

  const handleStartRegistration = useCallback(
    (protocol: string) => {
      const safeProtocol = String(protocol || '').trim().toLowerCase();
      if (!safeProtocol) return;
      if (safeProtocol === '8004' || safeProtocol === '8122') {
        // On-chain registry flows live in the Admin Tools registration tab.
        window.location.href = `/admin-tools/${encodeURIComponent(uaid)}?tab=registration&registry=${encodeURIComponent(safeProtocol)}`;
        return;
      }
      window.location.href = `/agent-registration/${encodeURIComponent(safeProtocol)}?uaid=${encodeURIComponent(uaid)}`;
    },
    [uaid],
  );

  useEffect(() => {
    if (renderOnlyTab) return;
    if (activeTab === 'ens' && !hasEnsIdentity) setActiveTab('id8004');
    if (activeTab === 'hol' && !hasHolIdentity) setActiveTab('id8004');
  }, [activeTab, hasEnsIdentity, hasHolIdentity, renderOnlyTab]);

  const extractServiceEndpointFromDescriptorJson = useCallback(
    (descriptorJson: string | null | undefined, serviceName: string): string | null => {
      if (!descriptorJson) return null;
      try {
        const parsed = JSON.parse(descriptorJson) as any;
        const services = Array.isArray(parsed?.services) ? parsed.services : [];
        const target = serviceName.trim().toLowerCase();
        for (const svc of services) {
          const name = typeof svc?.name === 'string' ? svc.name.trim().toLowerCase() : '';
          const endpoint = typeof svc?.endpoint === 'string' ? svc.endpoint.trim() : '';
          if (name === target && endpoint) return endpoint;
        }
      } catch {
        // ignore
      }
      return null;
    },
    [],
  );

  const identityTab = activeTab === 'ens' || activeTab === 'hol' || activeTab === 'id8004' ? activeTab : 'id8004';
  const identityDid =
    identityTab === 'ens'
      ? ((agent as any).identityEnsDid ?? null)
      : identityTab === 'hol'
        ? ((agent as any).identityHolDid ?? null)
        : ((agent as any).identity8004Did ?? agent.did ?? null);
  const identityHolUaid = identityTab === 'hol' ? ((agent as any).identityHolUaid ?? null) : null;
  const identityDescriptorJsonRaw =
    identityTab === 'ens'
      ? ((agent as any).identityEnsDescriptorJson ?? null)
      : identityTab === 'hol'
        ? ((agent as any).identityHolDescriptorJson ?? null)
        : ((agent as any).identity8004DescriptorJson ?? (agent as any).rawJson ?? null);
  const identityOnchainMetadataJsonRaw =
    identityTab === 'ens'
      ? ((agent as any).identityEnsOnchainMetadataJson ?? null)
      : identityTab === 'hol'
        ? ((agent as any).identityHolOnchainMetadataJson ?? null)
        : ((agent as any).identity8004OnchainMetadataJson ?? (agent as any).onchainMetadataJson ?? null);

  const identityDescriptor = useMemo(
    () => parseJsonObject(identityDescriptorJsonRaw),
    [identityDescriptorJsonRaw],
  );
  const identityOnchainMetadata = useMemo(() => {
    const parsed = parseJsonObject(identityOnchainMetadataJsonRaw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  }, [identityOnchainMetadataJsonRaw]);

  const structuredOnchainMetadata = useMemo(() => {
    if (identityTab !== 'id8004') return null;
    const meta = asRecord(identityOnchainMetadata);
    if (!meta) return null;
    const entriesRaw = meta.entries;
    const byKeyRaw = meta.byKey;
    const entries = Array.isArray(entriesRaw) ? (entriesRaw as StructuredOnchainMetadataEntry[]) : null;
    const byKey = asRecord(byKeyRaw);
    if (!entries || entries.length === 0) return null;
    return { entries, byKey };
  }, [identityOnchainMetadata, identityTab]);

  const identityA2aEndpoint =
    extractServiceEndpointFromDescriptorJson(identityDescriptorJsonRaw, 'a2a') ?? (identityTab === 'id8004' ? agent.a2aEndpoint : null);
  const identityMcpEndpoint =
    extractServiceEndpointFromDescriptorJson(identityDescriptorJsonRaw, 'mcp') ?? (identityTab === 'id8004' ? agent.mcpEndpoint : null);

  const identityDescriptorPretty = useMemo(
    () => formatJsonIfPossible(identityDescriptorJsonRaw),
    [identityDescriptorJsonRaw],
  );

  const identityRegistryInfo = useMemo(() => {
    if (identityTab !== 'id8004') return null;
    const parsedFromUaid = parseRegistryFromUaid(uaid);
    const parsedDid = parseRegistryFromDid(identityDid);
    const parsed = parsedFromUaid ?? parsedDid;
    // If this agent has no 8004/8122 registry identity, don't show a registry badge at all.
    if (!parsed) return null;
    const registryNamespace =
      typeof (identityDescriptor as any)?.registryNamespace === 'string'
        ? String((identityDescriptor as any).registryNamespace).trim()
        : null;
    const registeredBy =
      typeof (identityDescriptor as any)?.registeredBy === 'string'
        ? String((identityDescriptor as any).registeredBy).trim()
        : null;
    const type =
      typeof (identityDescriptor as any)?.type === 'string'
        ? String((identityDescriptor as any).type).trim()
        : null;
    const registryId: '8004' | '8122' = parsed.registryId;
    const chainId = parsed.chainId;
    return {
      registryId,
      chainId,
      chainLabel: getChainLabel(chainId),
      registryNamespace,
      registeredBy,
      type,
      uaid: typeof (identityDescriptor as any)?.uaid === 'string' ? String((identityDescriptor as any).uaid).trim() : null,
      registrations: Array.isArray((identityDescriptor as any)?.registrations) ? ((identityDescriptor as any).registrations as any[]) : null,
    };
  }, [identityDescriptor, identityDid, identityTab, uaid]);

  return (
    <ContainerTag style={containerStyle}>
      {/* Tab Navigation (hidden when renderOnlyTab is set) */}
      {!renderOnlyTab && !embedded && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: `2px solid ${palette.border}`,
            backgroundColor: palette.surfaceMuted,
            overflowX: 'auto',
          }}
        >
          <div style={{ display: 'flex', overflowX: 'auto' }}>
            {mainTabDefs.map((tab) => {
              const isActive = activeTab === tab.id;
              const label = tab.label;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                  }}
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
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ padding: '0.5rem 1rem', flex: '0 0 auto' }}>
            <button
              type="button"
              onClick={() => setRegisterDialogOpen(true)}
              style={{
                padding: '0.55rem 0.9rem',
                borderRadius: '999px',
                border: `1px solid ${palette.border}`,
                backgroundColor: palette.surface,
                color: palette.textPrimary,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Register agent
            </button>
          </div>
        </div>
      )}

      {/* Tab Content */}
      <div style={{ padding: embedded ? 0 : '1.5rem' }}>
        {(activeTab === 'id8004' || activeTab === 'ens' || activeTab === 'hol') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', fontSize: '0.9rem' }}>
                {identityTab === 'id8004' ? (
                  !has8004Registry && !has8122Registry ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      <div>
                        <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>UAID</strong>
                        <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all', userSelect: 'text' }}>
                          {uaid ?? '—'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>DID</strong>
                        <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all', userSelect: 'text' }}>
                          {agent.did ?? '—'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Chain</strong>
                        <div style={{ color: palette.textPrimary }}>
                          {getChainLabel(
                            (typeof agent.chainId === 'number' && Number.isFinite(agent.chainId) && agent.chainId > 0
                              ? agent.chainId
                              : null) ?? parseChainIdFromUaid(uaid),
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
                      <div>
                        <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Agent ID</strong>
                        <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>{agent.agentId}</div>
                      </div>
                      <div>
                        <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Chain</strong>
                        <div style={{ color: palette.textPrimary }}>{agent.chainId}</div>
                      </div>
                    </div>
                  )
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div>
                      <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>DID</strong>
                      <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all', userSelect: 'text' }}>
                        {identityDid ?? '—'}
                      </div>
                    </div>
                    {identityTab === 'hol' && identityHolUaid && (
                      <div>
                        <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>HOL UAID</strong>
                        <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all', userSelect: 'text' }}>
                          {identityHolUaid}
                        </div>
                      </div>
                    )}
                    <div>
                      <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Chain</strong>
                      <div style={{ color: palette.textPrimary }}>{agent.chainId || '—'}</div>
                    </div>
                  </div>
                )}

                {identityTab === 'id8004' && (
                  <>
                    {identityRegistryInfo && (
                      <div
                        style={{
                          borderTop: `1px dashed ${palette.border}`,
                          paddingTop: '0.85rem',
                          marginTop: '0.25rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.6rem',
                        }}
                      >
                        <div>
                          <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>
                            Registry
                          </strong>
                          <div style={{ color: palette.textPrimary }}>
                            {identityRegistryInfo.registryId} {identityRegistryInfo.chainLabel}
                          </div>
                        </div>
                        {identityRegistryInfo.registryNamespace && (
                          <div>
                            <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>
                              Registry Namespace
                            </strong>
                            <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all' }}>
                              {identityRegistryInfo.registryNamespace}
                            </div>
                          </div>
                        )}
                        {identityRegistryInfo.registeredBy && (
                          <div>
                            <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>
                              Registered By
                            </strong>
                            <div style={{ color: palette.textPrimary }}>{identityRegistryInfo.registeredBy}</div>
                          </div>
                        )}
                        {identityRegistryInfo.type && (
                          <div>
                            <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>
                              Registration Type
                            </strong>
                            <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all' }}>
                              {identityRegistryInfo.type}
                            </div>
                          </div>
                        )}
                        {identityRegistryInfo.registrations && identityRegistryInfo.registrations.length > 0 && (
                          <div>
                            <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>
                              Registrations
                            </strong>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              {identityRegistryInfo.registrations.slice(0, 8).map((r, idx) => (
                                <div key={r?.agentId ?? idx} style={{ color: palette.textPrimary }}>
                                  <span style={{ fontFamily: 'monospace' }}>
                                    {String(r?.agentRegistry ?? '').trim() || '—'}
                                  </span>
                                  {r?.registeredAt ? (
                                    <span style={{ color: palette.textSecondary }}>
                                      {' '}
                                      · {String(r.registeredAt)}
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                              {identityRegistryInfo.registrations.length > 8 && (
                                <div style={{ color: palette.textSecondary }}>
                                  +{identityRegistryInfo.registrations.length - 8} more…
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>OwnerAccount</strong>
                      <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all', userSelect: 'text' }}>
                        {(agent as any).identityOwnerAccount || '—'}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
                      <div>
                        <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>OperatorAccount</strong>
                        <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all', userSelect: 'text' }}>
                          {(agent as any).identityOperatorAccount || '—'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>WalletAccount</strong>
                        <div style={{ fontFamily: 'monospace', color: palette.textPrimary, wordBreak: 'break-all', userSelect: 'text' }}>
                          {(agent as any).identityWalletAccount || '—'}
                        </div>
                      </div>
                    </div>
                  </>
                )}
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
                <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: palette.textPrimary }}>Application Endpoints</h3>
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
                    {identityA2aEndpoint ? (
                      <a
                        href={identityA2aEndpoint}
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
                        {identityA2aEndpoint}
                      </a>
                    ) : (
                      <div style={{ fontFamily: 'monospace', color: palette.textSecondary }}>—</div>
                    )}
                </div>
                <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>MCP</strong>
                    {identityMcpEndpoint ? (
                      <a
                        href={identityMcpEndpoint}
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
                        {identityMcpEndpoint}
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
                {(((identityOnchainMetadata as any).agentCategory as string | undefined) || agent.agentCategory) && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Category</strong>
                    <div style={{ color: palette.textPrimary, fontWeight: 500 }}>
                      {((identityOnchainMetadata as any).agentCategory as string | undefined) || agent.agentCategory}
                    </div>
                  </div>
                )}
            {(typeof (identityDescriptor as any)?.description === 'string' ? (identityDescriptor as any).description : agent.description) && (
              <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Description</strong>
                <p style={{ margin: 0, lineHeight: 1.6, color: palette.textPrimary }}>
                  {typeof (identityDescriptor as any)?.description === 'string'
                    ? (identityDescriptor as any).description
                    : agent.description}
                </p>
              </div>
            )}
                {(typeof (identityDescriptor as any)?.image === 'string' ? (identityDescriptor as any).image : agent.image) && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Image</strong>
                    <a
                      href={
                        (typeof (identityDescriptor as any)?.image === 'string'
                          ? (identityDescriptor as any).image
                          : agent.image) as string
                      }
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
                      {typeof (identityDescriptor as any)?.image === 'string'
                        ? (identityDescriptor as any).image
                        : agent.image}
                    </a>
                  </div>
                )}
                {(((identityOnchainMetadata as any).agentUri as string | undefined) || agent.agentUri) && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Agent URI</strong>
                    <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: palette.textPrimary, fontSize: '0.85rem' }}>
                      {((identityOnchainMetadata as any).agentUri as string | undefined) || agent.agentUri}
                    </div>
                  </div>
                )}
                {identityTab === 'id8004' && agent.contractAddress && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Contract Address</strong>
                    <div style={{ fontFamily: 'monospace', color: palette.textPrimary }}>
                      {shorten(agent.contractAddress)}
                    </div>
                  </div>
                )}
                {identityDid && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>DID</strong>
                    <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: palette.textPrimary, fontSize: '0.85rem' }}>
                      {identityDid}
                    </div>
                  </div>
                )}
                {(typeof (identityDescriptor as any)?.supportedTrust !== 'undefined' || agent.supportedTrust) && (
                  <div>
                    <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem' }}>Supported Trust</strong>
                    <div style={{ color: palette.textPrimary }}>
                      {typeof (identityDescriptor as any)?.supportedTrust !== 'undefined'
                        ? JSON.stringify((identityDescriptor as any).supportedTrust)
                        : typeof agent.supportedTrust === 'string'
                          ? agent.supportedTrust
                          : JSON.stringify(agent.supportedTrust)}
                    </div>
                  </div>
                )}
                {/* KB-provided onchainMetadataJson (already assembled; no chain call) */}
                {Object.keys(identityOnchainMetadata).length > 0 && (
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
                      {structuredOnchainMetadata ? (
                        <>
                          {structuredOnchainMetadata.byKey && (
                            <div>
                              <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.4rem' }}>
                                Summary
                              </strong>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                  gap: '0.6rem 1rem',
                                }}
                              >
                                {Object.entries(structuredOnchainMetadata.byKey).map(([k, v]) => (
                                  <div key={k} style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        color: palette.textSecondary,
                                        fontFamily: 'monospace',
                                        fontSize: '0.78rem',
                                        marginBottom: '0.2rem',
                                      }}
                                    >
                                      {k}
                                    </div>
                                    <div
                                      style={{
                                        color: palette.textPrimary,
                                        wordBreak: 'break-all',
                                        fontFamily:
                                          typeof v === 'string' && (v.startsWith('0x') || v.startsWith('uaid:'))
                                            ? 'monospace'
                                            : 'inherit',
                                      }}
                                    >
                                      {typeof v === 'string' ? v : JSON.stringify(v)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div>
                            <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.4rem' }}>
                              Entries ({structuredOnchainMetadata.entries.length})
                            </strong>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                              {structuredOnchainMetadata.entries.map((entry, idx) => {
                                const entryKey = typeof entry?.key === 'string' ? entry.key : `entry_${idx}`;
                                const value = typeof entry?.value === 'string' ? entry.value : null;
                                const setBy = typeof entry?.setBy === 'string' ? entry.setBy : null;
                                const txHash = typeof entry?.txHash === 'string' ? entry.txHash : null;
                                const blockNumber =
                                  typeof entry?.blockNumber === 'string' || typeof entry?.blockNumber === 'number'
                                    ? String(entry.blockNumber)
                                    : null;
                                const iso = formatIsoTime(entry?.timestamp ?? entry?.setAt);
                                const rel = toEpochSeconds(entry?.timestamp ?? entry?.setAt);

                                return (
                                  <div
                                    key={entry?.id || `${entryKey}_${idx}`}
                                    style={{
                                      border: `1px solid ${palette.border}`,
                                      borderRadius: '10px',
                                      padding: '0.75rem',
                                      backgroundColor: palette.surface,
                                    }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: palette.textSecondary }}>
                                          {entryKey}
                                        </div>
                                        <div style={{ color: palette.textPrimary, wordBreak: 'break-all', fontFamily: value?.startsWith('0x') ? 'monospace' : 'inherit' }}>
                                          {value ?? '—'}
                                        </div>
                                      </div>
                                      <div style={{ color: palette.textSecondary, fontSize: '0.78rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        {rel ? formatRelativeTime(rel) : '—'}
                                      </div>
                                    </div>

                                    <div
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                        gap: '0.4rem 1rem',
                                        marginTop: '0.6rem',
                                        fontSize: '0.8rem',
                                      }}
                                    >
                                      <div style={{ minWidth: 0 }}>
                                        <span style={{ color: palette.textSecondary }}>setBy</span>{' '}
                                        <span style={{ color: palette.textPrimary, fontFamily: 'monospace' }}>{setBy ? shorten(setBy) : '—'}</span>
                                      </div>
                                      <div style={{ minWidth: 0 }}>
                                        <span style={{ color: palette.textSecondary }}>block</span>{' '}
                                        <span style={{ color: palette.textPrimary, fontFamily: 'monospace' }}>{blockNumber ?? '—'}</span>
                                      </div>
                                      <div style={{ minWidth: 0 }}>
                                        <span style={{ color: palette.textSecondary }}>tx</span>{' '}
                                        <span style={{ color: palette.textPrimary, fontFamily: 'monospace' }}>{txHash ? shorten(txHash) : '—'}</span>
                                      </div>
                                      <div style={{ minWidth: 0 }}>
                                        <span style={{ color: palette.textSecondary }}>time</span>{' '}
                                        <span style={{ color: palette.textPrimary, fontFamily: 'monospace' }}>{iso ?? '—'}</span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      ) : (
                        Object.entries(identityOnchainMetadata).map(([key, value]) => (
                          <div key={key}>
                            <strong style={{ color: palette.textSecondary, display: 'block', marginBottom: '0.25rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                              {key}
                            </strong>
                            <div style={{ color: palette.textPrimary, wordBreak: 'break-word', fontFamily: key === 'agentAccount' ? 'monospace' : 'inherit' }}>
                              {typeof value === 'string' ? value : JSON.stringify(value)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            </div>

            {/* Descriptor JSON (from identity descriptor json) */}
            <div
              style={{
                border: `1px solid ${palette.border}`,
                borderRadius: '12px',
                padding: '1.25rem',
                backgroundColor: palette.surfaceMuted,
              }}
            >
              <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600, color: palette.textPrimary }}>
                Descriptor JSON
              </h3>
              {identityDescriptorPretty ? (
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: '0.85rem',
                    margin: 0,
                    color: palette.textPrimary,
                    maxHeight: '600px',
                    overflow: 'auto',
                  }}
                >
                  {identityDescriptorPretty}
                </pre>
              ) : (
                <div style={{ color: palette.textSecondary }}>No descriptor JSON available for this identity.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'feedback' && !modalTab && (
          <div>
            <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
              Review entries and aggregated reputation summary for this agent.
            </p>
            {feedbackLoading && (
              <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
                Loading reviews...
              </p>
            )}
            {feedbackError && (
              <p style={{ color: palette.dangerText, marginTop: 0, marginBottom: '1rem' }}>
                {feedbackError}
              </p>
            )}
            {(feedbackSummary || feedbackCount !== null || agent.feedbackAverageScore !== null) && (
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
                  <strong>Review count:</strong>{' '}
                  {/* Prefer discovery count, fallback to loaded detail count */}
                  {feedbackCount !== null ? feedbackCount : (feedbackSummary?.count ?? '0')}
                </span>
                <span>
                  <strong>Average score:</strong>{' '}
                  {typeof agent.feedbackAverageScore === 'number'
                    ? agent.feedbackAverageScore.toFixed(2)
                    : typeof feedbackSummary?.averageScore === 'number'
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
                  No reviews found for this agent.
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
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Review URI:</strong>{' '}
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
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Review JSON:</strong>
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

        {activeTab === 'validation' && !modalTab && (
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
                    Completed validations ({validationCompletedCount !== null ? validationCompletedCount : completedValidations.length})
                  </h4>
                  {completedValidations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {completedValidations.map((item: any, index) => (
                        (() => {
                          const requestObj = parseJsonObject(item.requestJson);
                          const responseObj = parseJsonObject(item.responseJson);
                          const obj = requestObj ?? responseObj;
                          const claimType = typeof obj?.claim?.type === 'string' ? obj.claim.type : null;
                          const claimText = typeof obj?.claim?.text === 'string' ? obj.claim.text : null;
                          const taskId = typeof obj?.taskId === 'string' ? obj.taskId : null;
                          const success = typeof obj?.success === 'boolean' ? obj.success : null;
                          const criteria = Array.isArray(obj?.criteria) ? obj.criteria : [];
                          return (
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
                            {(claimType || claimText || taskId || success !== null) && (
                              <div
                                style={{
                                  border: `1px solid ${palette.border}`,
                                  borderRadius: '8px',
                                  padding: '0.5rem 0.75rem',
                                  backgroundColor: palette.surface,
                                  fontSize: '0.85rem',
                                }}
                              >
                                {taskId && (
                                  <div>
                                    <strong>Task ID:</strong> <code style={{ fontFamily: 'monospace' }}>{taskId}</code>
                                  </div>
                                )}
                                {(claimType || claimText) && (
                                  <div>
                                    <strong>Claim:</strong>{' '}
                                    <span>
                                      {claimType ?? '—'}
                                      {claimText ? ` · ${claimText}` : ''}
                                    </span>
                                  </div>
                                )}
                                {success !== null && (
                                  <div>
                                    <strong>Success:</strong> {success ? 'true' : 'false'}
                                  </div>
                                )}
                              </div>
                            )}
                            {criteria.length > 0 && (
                              <div style={{ fontSize: '0.85rem' }}>
                                <strong>Criteria:</strong>
                                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
                                  {criteria.slice(0, 10).map((c: any, i: number) => (
                                    <li key={c?.id ?? i}>
                                      {typeof c?.name === 'string' ? c.name : '—'}
                                      {typeof c?.method === 'string' ? ` (${c.method})` : ''}
                                      {typeof c?.passCondition === 'string' ? ` — ${c.passCondition}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
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
                          );
                        })()
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
                    Pending validations ({validationPendingCount !== null ? validationPendingCount : pendingValidations.length})
                  </h4>
                  {pendingValidations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {pendingValidations.map((item: any, index) => (
                        (() => {
                          const requestObj = parseJsonObject(item.requestJson);
                          const claimType = typeof requestObj?.claim?.type === 'string' ? requestObj.claim.type : null;
                          const claimText = typeof requestObj?.claim?.text === 'string' ? requestObj.claim.text : null;
                          const taskId = typeof requestObj?.taskId === 'string' ? requestObj.taskId : null;
                          const criteria = Array.isArray(requestObj?.criteria) ? requestObj.criteria : [];
                          return (
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
                            {(claimType || claimText || taskId) && (
                              <div
                                style={{
                                  border: `1px solid ${palette.border}`,
                                  borderRadius: '8px',
                                  padding: '0.5rem 0.75rem',
                                  backgroundColor: palette.surface,
                                  fontSize: '0.85rem',
                                }}
                              >
                                {taskId && (
                                  <div>
                                    <strong>Task ID:</strong> <code style={{ fontFamily: 'monospace' }}>{taskId}</code>
                                  </div>
                                )}
                                {(claimType || claimText) && (
                                  <div>
                                    <strong>Claim:</strong>{' '}
                                    <span>
                                      {claimType ?? '—'}
                                      {claimText ? ` · ${claimText}` : ''}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                            {criteria.length > 0 && (
                              <div style={{ fontSize: '0.85rem' }}>
                                <strong>Criteria:</strong>
                                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
                                  {criteria.slice(0, 10).map((c: any, i: number) => (
                                    <li key={c?.id ?? i}>
                                      {typeof c?.name === 'string' ? c.name : '—'}
                                      {typeof c?.method === 'string' ? ` (${c.method})` : ''}
                                      {typeof c?.passCondition === 'string' ? ` — ${c.passCondition}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
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
                          );
                        })()
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

        {activeTab === 'associations' && !modalTab && (
          <div>
            <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
              Associated accounts for this agent's smart account ({agent.agentAccount ? shorten(agent.agentAccount) : '—'})
            </p>
            {(initiatedAssociationCount !== null || approvedAssociationCount !== null) && (
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
                {initiatedAssociationCount !== null && (
                  <span>
                    <strong>Initiated:</strong> {initiatedAssociationCount}
                  </span>
                )}
                {approvedAssociationCount !== null && (
                  <span>
                    <strong>Approved:</strong> {approvedAssociationCount}
                  </span>
                )}
                {totalAssociationCount > 0 && (
                  <span>
                    <strong>Total:</strong> {totalAssociationCount}
                  </span>
                )}
              </div>
            )}
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

      {/* Modal dialogs for Reviews / Validations / Relationships */}
      {!embedded && !renderOnlyTab && (
        <Dialog
          open={modalTab !== null}
          onClose={() => setModalTab(null)}
          maxWidth="lg"
          fullWidth
        >
          <DialogTitle sx={{ pb: 0 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {modalTab === 'feedback'
                  ? 'Reviews'
                  : modalTab === 'validation'
                    ? 'Validations'
                    : 'Relationships'}
              </div>
              <IconButton aria-label="Close" onClick={() => setModalTab(null)}>
                <CloseIcon />
              </IconButton>
            </div>
            <div
              style={{
                display: 'flex',
                borderBottom: `2px solid ${palette.border}`,
                backgroundColor: palette.surfaceMuted,
                overflowX: 'auto',
                marginTop: '0.75rem',
              }}
            >
              {MODAL_TAB_DEFS.map((tab) => {
                const isActive = modalTab === tab.id;
                const label = getTabLabel(tab.id);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setModalTab(tab.id as ModalTabId)}
                    style={{
                      padding: '0.85rem 1.25rem',
                      border: 'none',
                      borderBottom: `3px solid ${isActive ? palette.accent : 'transparent'}`,
                      backgroundColor: 'transparent',
                      color: isActive ? palette.accent : palette.textSecondary,
                      fontWeight: isActive ? 700 : 600,
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
                    {label}
                  </button>
                );
              })}
            </div>
          </DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            {modalTab === 'feedback' && (
              <div>
                <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
                  Review entries and aggregated reputation summary for this agent.
                </p>
                {feedbackLoading && (
                  <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
                    Loading reviews...
                  </p>
                )}
                {feedbackError && (
                  <p style={{ color: palette.dangerText, marginTop: 0, marginBottom: '1rem' }}>
                    {feedbackError}
                  </p>
                )}
                {(feedbackSummary || feedbackCount !== null || agent.feedbackAverageScore !== null) && (
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
                      <strong>Review count:</strong>{' '}
                      {feedbackCount !== null ? feedbackCount : (feedbackSummary?.count ?? '0')}
                    </span>
                    <span>
                      <strong>Average score:</strong>{' '}
                      {typeof agent.feedbackAverageScore === 'number'
                        ? agent.feedbackAverageScore.toFixed(2)
                        : typeof feedbackSummary?.averageScore === 'number'
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
                      No reviews found for this agent.
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
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                                <span style={{ color: palette.textPrimary, fontWeight: 600 }}>
                                  Score: {record.score ?? record.rating ?? '—'}
                                </span>
                                <span style={{ color: palette.textSecondary, fontSize: '0.85rem' }}>
                                  {formatRelativeTime(record.timestamp ?? null)}
                                </span>
                              </div>
                              {typeof record.comment === 'string' && record.comment.trim() && (
                                <div style={{ color: palette.textPrimary }}>{record.comment}</div>
                              )}
                              {record.feedbackUri && (
                                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: palette.textSecondary }}>
                                  <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Review URI:</strong>{' '}
                                  {String(record.feedbackUri)}
                                </div>
                              )}
                              {record.feedbackJson && (
                                <details>
                                  <summary style={{ cursor: 'pointer', color: palette.textSecondary }}>
                                    <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Review JSON:</strong>
                                  </summary>
                                  <pre
                                    style={{
                                      margin: '0.5rem 0 0',
                                      padding: '0.75rem',
                                      borderRadius: '8px',
                                      border: `1px solid ${palette.border}`,
                                      backgroundColor: palette.surfaceMuted,
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                      fontFamily: 'ui-monospace, monospace',
                                      fontSize: '0.8rem',
                                      color: palette.textPrimary,
                                    }}
                                  >
                                    {formatJsonIfPossible(String(record.feedbackJson)) ?? String(record.feedbackJson)}
                                  </pre>
                                </details>
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

            {modalTab === 'validation' && (
              <div>
                <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
                  Pending and completed validations for this agent from the on-chain validation registry.
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
                  <p style={{ color: palette.textSecondary, margin: 0 }}>
                    Unable to load validation data.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: '1rem',
                        flexWrap: 'wrap',
                        fontSize: '0.9rem',
                        padding: '0.75rem',
                        backgroundColor: palette.surfaceMuted,
                        borderRadius: '8px',
                      }}
                    >
                      <span>
                        <strong>Completed:</strong>{' '}
                        {validationCompletedCount !== null ? validationCompletedCount : completedValidations.length}
                      </span>
                      <span>
                        <strong>Pending:</strong>{' '}
                        {validationPendingCount !== null ? validationPendingCount : pendingValidations.length}
                      </span>
                    </div>

                    <div>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                        Completed validations
                      </h4>
                      {completedValidations.length === 0 ? (
                        <p style={{ color: palette.textSecondary, margin: 0 }}>No completed validations.</p>
                      ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {completedValidations.slice(0, 50).map((item: any, idx: number) => (
                            <li
                              key={item.requestHash ?? item.id ?? idx}
                              style={{
                                border: `1px solid ${palette.border}`,
                                borderRadius: '10px',
                                padding: '0.75rem',
                                backgroundColor: palette.surface,
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {item.requestHash && (
                                  <div>
                                    <strong>Request Hash:</strong>{' '}
                                    <code style={{ fontFamily: 'monospace' }}>{String(item.requestHash)}</code>
                                  </div>
                                )}
                                {item.validatorAddress && (
                                  <div>
                                    <strong>Validator:</strong>{' '}
                                    <code style={{ fontFamily: 'monospace' }}>{String(item.validatorAddress)}</code>
                                  </div>
                                )}
                                {item.response !== undefined && (
                                  <div>
                                    <strong>Response:</strong> {String(item.response)}
                                  </div>
                                )}
                                {item.timestamp && (
                                  <div style={{ color: palette.textSecondary, fontSize: '0.85rem' }}>
                                    {new Date(Number(item.timestamp) * 1000).toLocaleString()}
                                  </div>
                                )}
                                {(item.requestJson || item.responseJson) && (
                                  <details>
                                    <summary style={{ cursor: 'pointer', color: palette.textSecondary }}>
                                      JSON
                                    </summary>
                                    <pre
                                      style={{
                                        margin: '0.5rem 0 0',
                                        padding: '0.75rem',
                                        borderRadius: '8px',
                                        border: `1px solid ${palette.border}`,
                                        backgroundColor: palette.surfaceMuted,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        fontFamily: 'ui-monospace, monospace',
                                        fontSize: '0.8rem',
                                        color: palette.textPrimary,
                                      }}
                                    >
                                      {formatJsonIfPossible(String(item.responseJson ?? item.requestJson)) ??
                                        String(item.responseJson ?? item.requestJson)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                        Pending validations
                      </h4>
                      {pendingValidations.length === 0 ? (
                        <p style={{ color: palette.textSecondary, margin: 0 }}>No pending validations.</p>
                      ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {pendingValidations.slice(0, 50).map((item: any, idx: number) => (
                            <li
                              key={item.requestHash ?? item.id ?? idx}
                              style={{
                                border: `1px solid ${palette.border}`,
                                borderRadius: '10px',
                                padding: '0.75rem',
                                backgroundColor: palette.surface,
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {item.requestHash && (
                                  <div>
                                    <strong>Request Hash:</strong>{' '}
                                    <code style={{ fontFamily: 'monospace' }}>{String(item.requestHash)}</code>
                                  </div>
                                )}
                                {item.validatorAddress && (
                                  <div>
                                    <strong>Validator:</strong>{' '}
                                    <code style={{ fontFamily: 'monospace' }}>{String(item.validatorAddress)}</code>
                                  </div>
                                )}
                                <div style={{ color: palette.textSecondary }}>
                                  <strong>Status:</strong> Awaiting response
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {modalTab === 'associations' && (
              <div>
                <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
                  Relationships associated with this agent's smart account ({agent.agentAccount ? shorten(agent.agentAccount) : '—'})
                </p>
                {(initiatedAssociationCount !== null || approvedAssociationCount !== null) && (
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
                    {initiatedAssociationCount !== null && (
                      <span>
                        <strong>Initiated:</strong> {initiatedAssociationCount}
                      </span>
                    )}
                    {approvedAssociationCount !== null && (
                      <span>
                        <strong>Approved:</strong> {approvedAssociationCount}
                      </span>
                    )}
                    {totalAssociationCount > 0 && (
                      <span>
                        <strong>Total:</strong> {totalAssociationCount}
                      </span>
                    )}
                  </div>
                )}
                {!agent.agentAccount ? (
                  <p style={{ color: palette.textSecondary, margin: 0 }}>No agent account address available.</p>
                ) : associationsLoading ? (
                  <p style={{ color: palette.textSecondary, margin: 0 }}>Loading relationships...</p>
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
                  <p style={{ color: palette.textSecondary, margin: 0 }}>No relationships found for this account.</p>
                ) : associationsData?.ok === true ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {associationsData.associations.slice(0, 100).map((assoc, index) => {
                      const active = assoc.revokedAt === 0;
                      const decoded =
                        assoc.record?.data && assoc.record.data.startsWith('0x')
                          ? decodeAssociationData(assoc.record.data as `0x${string}`)
                          : null;
                      const assocTypeLabel =
                        decoded
                          ? ASSOC_TYPE_OPTIONS.find((o) => o.value === decoded.assocType)?.label ??
                            `Type ${decoded.assocType}`
                          : null;

                      return (
                        <div
                          key={`${assoc.associationId}-${index}`}
                          style={{
                            border: `1px solid ${palette.border}`,
                            borderRadius: '10px',
                            padding: '0.75rem',
                            backgroundColor: palette.surface,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.5rem' }}>
                            <div style={{ color: palette.textSecondary, fontWeight: 700 }}>#{index + 1}</div>
                            <div
                              style={{
                                borderRadius: '6px',
                                padding: '0.25rem 0.75rem',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                backgroundColor: active ? `${palette.accent}20` : `${palette.dangerText}20`,
                                color: active ? palette.accent : palette.dangerText,
                              }}
                            >
                              {active ? 'Active' : 'Revoked'}
                            </div>
                          </div>
                          {assocTypeLabel && (
                            <div style={{ marginBottom: '0.5rem', color: palette.textPrimary }}>
                              <strong>Type:</strong> {assocTypeLabel}
                            </div>
                          )}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem', fontSize: '0.85rem' }}>
                            <div>
                              <strong>Initiator:</strong>{' '}
                              <code style={{ fontFamily: 'monospace' }}>{String(assoc.initiator ?? assoc.initiatorAddress ?? '—')}</code>
                            </div>
                            <div>
                              <strong>Approver:</strong>{' '}
                              <code style={{ fontFamily: 'monospace' }}>{String(assoc.approver ?? assoc.approverAddress ?? '—')}</code>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                              <strong>Counterparty:</strong>{' '}
                              <code style={{ fontFamily: 'monospace' }}>{String(assoc.counterparty ?? assoc.counterpartyAddress ?? '—')}</code>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ color: palette.textSecondary, margin: 0 }}>Unable to load relationships.</p>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Register agent dialog */}
      {!embedded && !renderOnlyTab && (
        <Dialog open={registerDialogOpen} onClose={() => setRegisterDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ pb: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <div style={{ fontWeight: 700 }}>Register agent</div>
              <IconButton aria-label="Close" onClick={() => setRegisterDialogOpen(false)}>
                <CloseIcon />
              </IconButton>
            </div>
          </DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <div style={{ color: palette.textSecondary, marginBottom: '1rem' }}>
              Choose a registration protocol.
            </div>
            {registerProtocols.length === 0 ? (
              <div style={{ color: palette.textSecondary }}>
                This agent already has all supported registries (8004/8122/ENS/HOL).
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                {registerProtocols.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleStartRegistration(p.id)}
                    style={{
                      padding: '0.9rem 1rem',
                      borderRadius: '12px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surface,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 800, color: palette.textPrimary }}>{p.label}</div>
                    <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: palette.textSecondary }}>
                      {p.description}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </ContainerTag>
  );
};

export default AgentDetailsTabs;
