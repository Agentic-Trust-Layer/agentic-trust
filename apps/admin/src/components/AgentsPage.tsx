'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ShadowAgentImage from '../../../../docs/8004ShadowAgent.png';
import { grayscalePalette as palette } from '@/styles/palette';
import { AGENT_CATEGORY_OPTIONS } from '@/models/agentRegistration';
import {
  generateSessionPackage,
  buildDid8004,
  DEFAULT_CHAIN_ID,
  getChainDisplayMetadata,
  type AgentSkill,
} from '@agentic-trust/core';
import {
  updateAgentRegistrationWithWallet,
  getDeployedAccountClientByAgentName,
  giveFeedbackWithWallet,
} from '@agentic-trust/core';
import { signAndSendTransaction } from '@agentic-trust/core/client';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';
import { getClientChainEnv } from '@/lib/clientChainEnv';

export type AgentsPageAgent = {
  agentId: string;
  chainId: number;
  uaid?: string | null;
  agentName?: string | null;
  agentAccount?: string | null;
  agentIdentityOwnerAccount?: string | null;
  eoaAgentIdentityOwnerAccount?: string | null;
  eoaAgentAccount?: string | null;
  /**
   * KB v2 account fields (best-effort; may be null/undefined depending on agent type).
   */
  identityOwnerAccount?: string | null;
  identityWalletAccount?: string | null;
  identityOperatorAccount?: string | null;
  agentOwnerAccount?: string | null;
  agentWalletAccount?: string | null;
  agentOperatorAccount?: string | null;
  agentOwnerEOAAccount?: string | null;
  smartAgentAccount?: string | null;
  agentCategory?: string | null;
  active?: boolean | null;
  agentUri?: string | null;
  description?: string | null;
  image?: string | null;
  contractAddress?: string | null;
  a2aEndpoint?: string | null;
  mcpEndpoint?: string | null; // MCP endpoint URL from registration
  did?: string | null;
  supportedTrust?: string | null;
  rawJson?: string | null;
  onchainMetadataJson?: string | null;
   createdAtTime?: number | null;
  feedbackCount?: number | null;
  feedbackAverageScore?: number | null;
  validationPendingCount?: number | null;
  validationCompletedCount?: number | null;
  validationRequestedCount?: number | null;
  initiatedAssociationCount?: number | null;
  approvedAssociationCount?: number | null;
  atiOverallScore?: number | null;
  atiOverallConfidence?: number | null;
  atiVersion?: string | null;
  atiComputedAt?: number | null;
  atiBundleJson?: string | null;
  trustLedgerScore?: number | null;
  trustLedgerBadgeCount?: number | null;
  trustLedgerOverallRank?: number | null;
  trustLedgerCapabilityRank?: number | null;
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
  only8004Agents: boolean;
  protocol: 'all' | 'a2a' | 'mcp';
  path: string;
  minReviews: string;
  minValidations: string;
  minAssociations: string;
  minAtiOverallScore: string;
  minAvgRating: string;
  createdWithinDays: string;
};

type AgentsPageProps = {
  agents: Agent[];
  filters: AgentsPageFilters;
  chainOptions: ChainOption[];
  loading: boolean;
  hideFilters?: boolean;
  hideLeaderboard?: boolean;
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
  onPageChange?: (page: number) => void;
};

function getChainForId(chainId: number) {
  if (chainId === 11155111) return sepolia;
  if (chainId === 84532) return baseSepolia;
  if (chainId === 11155420) return optimismSepolia;
  return sepolia;
}

function getBundlerUrlForId(chainId: number) {
  return getClientChainEnv(chainId).bundlerUrl;
}


type AgentActionType =
  | 'info'
  | 'registration'
  | 'did-web'
  | 'did-8004'
  | 'did-agent'
  | 'a2a'
  | 'session'
  | 'feedback'
  | 'validations'
  | 'registration-edit'
  | 'give-feedback';

const ACTION_LABELS: Record<AgentActionType, string> = {
  info: 'Info',
  registration: 'Reg',
  'registration-edit': 'Edit Reg',
  'did-web': 'DID:Web',
  'did-agent': 'DID:Agent',
  'did-8004': 'DID:8004',
  a2a: 'A2A',
  session: 'Session',
  feedback: 'Feedback',
  validations: 'Validations',
  'give-feedback': 'Give Feedback',
};

const DEFAULT_FILTERS: AgentsPageFilters = {
  chainId: 'all',
  address: '',
  name: '',
  agentId: '',
  mineOnly: false,
  only8004Agents: false,
  protocol: 'all',
  path: '',
  minReviews: '',
  minValidations: '',
  minAssociations: '',
  minAtiOverallScore: '',
  minAvgRating: '',
  createdWithinDays: '',
};

export function AgentsPage({
  agents,
  filters: filtersProp,
  chainOptions,
  loading,
  hideFilters = false,
  hideLeaderboard = false,
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
  onPageChange,
}: AgentsPageProps) {


  // Ensure filters is always fully-populated so all inputs remain controlled.
  // (If a new filter field is added, older callers may pass a partial object.)
  const filters: AgentsPageFilters = { ...DEFAULT_FILTERS, ...(filtersProp ?? {}) };

  // If user disconnects, force "My agents" off (it depends on ownedMap from an active session)
  useEffect(() => {
    if (!isConnected && filters.mineOnly) {
      onFilterChange('mineOnly', false);
    }
  }, [isConnected, filters.mineOnly, onFilterChange]);

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

  const [atiLeaderboardCategory, setAtiLeaderboardCategory] = useState<string>('');
  const [atiLeaderboardTimeWindow, setAtiLeaderboardTimeWindow] = useState<'all' | '10d' | '30d' | '180d'>('all');
  const [atiLeaderboardChainId, setAtiLeaderboardChainId] = useState<string>('all');
  const [atiLeaderboard, setAtiLeaderboard] = useState<
    Array<{
      agentId: string;
      chainId: number;
      agentName: string;
      trustLedgerScore: number;
      trustLedgerOverallRank: number;
      trustLedgerBadgeCount?: number | null;
      agentCategory?: string | null;
      image?: string | null;
    }>
  >([]);
  const [atiLeaderboardLoading, setAtiLeaderboardLoading] = useState(false);
  const [atiLeaderboardError, setAtiLeaderboardError] = useState<string | null>(null);
  const router = useRouter();
  const [tokenUriLoading, setTokenUriLoading] = useState(false);
  const [navigatingToAgent, setNavigatingToAgent] = useState<string | null>(null);
  // Safety: if the destination route hangs (e.g. tokenUri/IPFS gateway issues), don't lock the user on a blocking overlay forever.
  useEffect(() => {
    if (!navigatingToAgent) return;
    const t = setTimeout(() => setNavigatingToAgent(null), 20_000);
    return () => clearTimeout(t);
  }, [navigatingToAgent]);
  const [a2aPreview, setA2APreview] = useState<{
    key: string | null;
    loading: boolean;
    error: string | null;
    messageEndpointUrl: string | null;
    agentCardUrl: string | null;
    agentCardText: string | null;
  }>({
    key: null,
    loading: false,
    error: null,
    messageEndpointUrl: null,
    agentCardUrl: null,
    agentCardText: null,
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
  const [validationsPreview, setValidationsPreview] = useState<{
    key: string | null;
    loading: boolean;
    error: string | null;
    pending: unknown[] | null;
    completed: unknown[] | null;
  }>({
    key: null,
    loading: false,
    error: null,
    pending: null,
    completed: null,
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

  const initialFeedbackForm = {
    rating: 5,
    comment: '',
    tag1: '',
    tag2: '',
    skillId: '',
    context: '',
    capability: '',
  };

  const [feedbackForm, setFeedbackForm] = useState(initialFeedbackForm);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitStatus, setFeedbackSubmitStatus] = useState<string | null>(null);
  const [feedbackSubmitError, setFeedbackSubmitError] = useState<string | null>(null);
  const [feedbackSubmitSuccess, setFeedbackSubmitSuccess] = useState<string | null>(null);
  const [feedbackSkillsCache, setFeedbackSkillsCache] = useState<Record<string, AgentSkill[]>>(
    {},
  );
  const [feedbackSkillsLoading, setFeedbackSkillsLoading] = useState(false);
  const [feedbackSkillsError, setFeedbackSkillsError] = useState<string | null>(null);

  const getAgentKey = (agent?: Agent | null) => {
    if (!agent) return null;
    const chainId =
      typeof agent.chainId === 'number' && Number.isFinite(agent.chainId)
        ? agent.chainId
        : DEFAULT_CHAIN_ID;
    const agentId =
      typeof agent.agentId === 'string'
        ? agent.agentId.trim()
        : agent.agentId !== undefined && agent.agentId !== null
          ? String(agent.agentId)
          : '';
    return `${chainId}:${agentId}`;
  };

  const EXPLORER_BY_CHAIN: Record<number, string> = {
    1: 'https://etherscan.io',
    11155111: 'https://sepolia.etherscan.io',
    84532: 'https://sepolia.basescan.org',
    11155420: 'https://sepolia-optimism.etherscan.io',
  };

  const shadowAgentSrc =
    (ShadowAgentImage as unknown as { src?: string }).src ?? '/8004ShadowAgent.png';

  const [gridColumns, setGridColumns] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [singleQuery, setSingleQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

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
    11155111: 'https://sepolia.app.ens.domains',
    84532: 'https://app.ens.domains',
    11155420: 'https://app.ens.domains',
  };

  const getEnsNameLink = (agent: Agent): { name: string; href: string } | null => {
    const base = ENS_APP_BY_CHAIN[agent.chainId] ?? 'https://app.ens.domains';

    // Prefer did:ens if present
    const did = agent.did;
    if (typeof did === 'string' && did.startsWith('did:ens:')) {
      const name = did.slice('did:ens:'.length);
      if (name) {
        return { name, href: `${base}/${name}` };
      }
    }

    // Fallback: if agentName looks like an ENS name, use it directly
    if (typeof agent.agentName === 'string') {
      const trimmed = agent.agentName.trim();
      if (trimmed.toLowerCase().endsWith('.eth')) {
        return { name: trimmed, href: `${base}/${trimmed}` };
      }
    }

    return null;
  };

  // Client-side filtering for address, mineOnly, and 8004-agent name suffix (applied on the client)
  const filteredAgents = useMemo(() => {
    const normalizeAddr = (value: unknown): string => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      if (!trimmed) return '';
      // Handle common structured formats like eip155:chainId:0x..., did:pkh:eip155:...:0x...
      const last = trimmed.includes(':') ? trimmed.split(':').pop() ?? trimmed : trimmed;
      const candidate = last.trim();
      return candidate.toLowerCase();
    };

    let result = agents;
    const addressQuery = filters.address.trim().toLowerCase();
    if (addressQuery) {
      result = result.filter(agent =>
        (agent.agentAccount ?? '').toLowerCase().includes(addressQuery),
      );
    }
    if (filters.mineOnly) {
      const before = result.length;
      const ownedKeys = Object.keys(ownedMap ?? {}).filter((k) => Boolean((ownedMap ?? {})[k]));
      const hasOwnedMap = ownedKeys.length > 0;

      if (hasOwnedMap) {
        result = result.filter((agent) => {
          const key = `${agent.chainId}:${agent.agentId}`;
          return Boolean(ownedMap?.[key]);
        });
      } else {
        // Fallback (best-effort) if a parent route didn't provide ownedMap.
        const eoa = normalizeAddr(walletAddress);
        result = result.filter((agent) => {
          const identityOwnerEoa = normalizeAddr(agent.eoaAgentIdentityOwnerAccount);
          const agentAccountEoa = normalizeAddr(agent.eoaAgentAccount);
          const identityOwnerAccount = normalizeAddr(agent.agentIdentityOwnerAccount);
          return (
            Boolean(eoa) &&
            (identityOwnerEoa === eoa ||
              agentAccountEoa === eoa ||
              identityOwnerAccount === eoa)
          );
        });
      }

      console.log('[AgentsPage][MyAgents]', {
        before,
        after: result.length,
        hasWalletAddress: Boolean(walletAddress),
        ownedMapTrueCount: ownedKeys.length,
        ownedMapSampleKeys: ownedKeys.slice(0, 10),
        usedOwnedMap: hasOwnedMap,
      });
    }
    if (filters.protocol === 'a2a') {
      result = result.filter(agent => Boolean(agent.a2aEndpoint));
    } else if (filters.protocol === 'mcp') {
      result = result.filter(agent => !!agent.mcpEndpoint);
    }
    const pathQuery = filters.path.trim().toLowerCase();
    if (pathQuery) {
      result = result.filter(agent => {
        const haystack = [
          agent.a2aEndpoint ?? '',
          agent.agentUri ?? '',
          agent.description ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(pathQuery);
      });
    }
    if (filters.only8004Agents) {
      result = result.filter(agent => {
        const name =
          typeof agent.agentName === 'string'
            ? agent.agentName.trim().toLowerCase()
            : '';
        return name.endsWith('8004-agent.eth');
      });
    }
    return result;
  }, [
    agents,
    filters.address,
    filters.mineOnly,
    filters.protocol,
    filters.path,
    filters.only8004Agents,
    ownedMap,
    walletAddress,
  ]);

  // If we're in "my agents" mode and we already loaded an owned-agents list,
  // never allow the client-side ownership filter to hide everything.
  const agentsToRender = useMemo(() => {
    if (filters.mineOnly && agents.length > 0 && filteredAgents.length === 0) {
      return agents;
    }
    return filteredAgents;
  }, [filters.mineOnly, agents, filteredAgents]);

  const totalAgentsLabel =
    typeof total === 'number' && Number.isFinite(total) ? total : undefined;

  const openActionDialog = (agent: Agent, action: AgentActionType) => {
    setActiveDialog({ agent, action });
  };

  // Leaderboard (single discovery query, sorted client-side)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setAtiLeaderboardLoading(true);
        setAtiLeaderboardError(null);

        const params: Record<string, unknown> = {};
        const chainForLeaderboard = atiLeaderboardChainId && atiLeaderboardChainId !== 'all' ? atiLeaderboardChainId : 'all';
        if (chainForLeaderboard !== 'all') {
          const parsed = Number(chainForLeaderboard);
          if (Number.isFinite(parsed)) {
            params.chains = [parsed];
          }
        }
        const category = (atiLeaderboardCategory || '').trim();
        if (category) {
          params.agentCategory = category;
        }
        // Time window applies to agent creation time for leaderboard views.
        if (atiLeaderboardTimeWindow === '10d') params.createdWithinDays = 10;
        if (atiLeaderboardTimeWindow === '30d') params.createdWithinDays = 30;
        if (atiLeaderboardTimeWindow === '180d') params.createdWithinDays = 180;

        const url =
          `/api/agents/search?page=1&pageSize=2000` +
          `&orderBy=createdAtTime&orderDirection=DESC` +
          `&params=${encodeURIComponent(JSON.stringify(params))}` +
          `&source=leaderboard`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || body?.message || `Failed to load leaderboard (${res.status})`);
        }
        const body = await res.json().catch(() => ({} as any));
        const list = Array.isArray(body?.agents) ? (body.agents as any[]) : [];

        const top = list
          .map((a) => {
            const scoreRaw = a?.trustLedgerScore;
            const score = typeof scoreRaw === 'number' ? scoreRaw : Number(scoreRaw);
            const rankRaw = a?.trustLedgerOverallRank;
            const rank = typeof rankRaw === 'number' ? rankRaw : Number(rankRaw);
            if (!Number.isFinite(score) || !Number.isFinite(rank) || rank <= 0) return null;
            const agentId = typeof a?.agentId === 'string' ? a.agentId : String(a?.agentId ?? '');
            const chainId = typeof a?.chainId === 'number' ? a.chainId : Number(a?.chainId ?? 0);
            const agentName = typeof a?.agentName === 'string' && a.agentName.trim() ? a.agentName.trim() : `Agent #${agentId || '—'}`;
            const agentCategory =
              typeof a?.agentCategory === 'string' && a.agentCategory.trim().length > 0 ? a.agentCategory.trim() : null;
            const image =
              typeof a?.image === 'string' && a.image.trim().length > 0 ? a.image.trim() : null;
            const badgeRaw = a?.trustLedgerBadgeCount;
            const badgeCount =
              typeof badgeRaw === 'number'
                ? badgeRaw
                : badgeRaw === null || badgeRaw === undefined
                  ? null
                  : Number(badgeRaw);
            const trustLedgerBadgeCount = Number.isFinite(badgeCount as number) ? (badgeCount as number) : null;
            if (!agentId || !Number.isFinite(chainId) || chainId <= 0) return null;
            return {
              agentId,
              chainId,
              agentName,
              trustLedgerScore: score,
              trustLedgerOverallRank: rank,
              trustLedgerBadgeCount,
              agentCategory,
              image,
            };
          })
          .filter(Boolean) as Array<{
          agentId: string;
          chainId: number;
          agentName: string;
          trustLedgerScore: number;
          trustLedgerOverallRank: number;
          trustLedgerBadgeCount?: number | null;
          agentCategory?: string | null;
          image?: string | null;
        }>;

        top.sort((a, b) => a.trustLedgerOverallRank - b.trustLedgerOverallRank);

        if (cancelled) return;
        setAtiLeaderboard(top.slice(0, 10));
      } catch (e: any) {
        if (cancelled) return;
        setAtiLeaderboard([]);
        setAtiLeaderboardError(e?.message || 'Failed to load leaderboard');
      } finally {
        if (!cancelled) setAtiLeaderboardLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [atiLeaderboardCategory, atiLeaderboardTimeWindow, atiLeaderboardChainId]);

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
    const key = getAgentKey(agent);
    if (!key) {
      return;
    }

    // For registration-edit, fetch latest tokenUri from contract
    if (activeDialog.action === 'registration-edit') {
      let cancelled = false;
      setTokenUriLoading(true);
      setLatestTokenUri(null);
      
      (async () => {
        try {
          const uaid = String((agent as any).uaid ?? '').trim();
          if (!uaid) {
            throw new Error('Missing uaid for agent');
          }
          const response = await fetch(`/api/agents/${encodeURIComponent(uaid)}`);
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
      // For regular registration view, use KB-provided registration JSON (identity8004.descriptor.json),
      // surfaced as `agent.rawJson` in discovery results.
      const rawJson = (agent as any).rawJson;
      if (typeof rawJson !== 'string' || !rawJson.trim()) {
        setRegistrationPreview({
          key,
          loading: false,
          error: 'No registration JSON available for this agent (missing identity descriptor json).',
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
          const text = await loadRegistrationContent(rawJson);
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
    if (activeDialog?.action === 'give-feedback') {
      setFeedbackForm(initialFeedbackForm);
      setFeedbackSubmitStatus(null);
      setFeedbackSubmitError(null);
      setFeedbackSubmitSuccess(null);
      // Load skills if available
      const { agent } = activeDialog;
      const key = getAgentKey(agent);
      if (key && !feedbackSkillsCache[key] && agent.a2aEndpoint) {
        setFeedbackSkillsLoading(true);
        setFeedbackSkillsError(null);
        (async () => {
          try {
            const { agentCardUrl } = deriveA2ADiscoveryUrls(agent.a2aEndpoint as string);
            const text = agentCardUrl ? await loadAgentCardContent(agentCardUrl) : await loadAgentCardContent(agent.a2aEndpoint as string);
            let skills: AgentSkill[] = [];
            try {
              const parsed = JSON.parse(text);
              if (Array.isArray(parsed?.skills)) {
                skills = parsed.skills as AgentSkill[];
              }
            } catch (error) {
              console.warn('[AgentsPage] Failed to parse agent card JSON:', error);
            }
            setFeedbackSkillsCache(prev => ({ ...prev, [key]: skills }));
          } catch (error: any) {
            setFeedbackSkillsError(
              error?.message ?? 'Unable to load agent card for feedback form.',
            );
          } finally {
            setFeedbackSkillsLoading(false);
          }
        })();
      }
    }
  }, [activeDialog, feedbackSkillsCache]);

  useEffect(() => {
    if (!activeDialog || activeDialog.action !== 'feedback') {
      return;
    }

    const { agent } = activeDialog;
    const key = getAgentKey(agent);
    if (!key) {
      return;
    }
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
        const uaid = String((agent as any).uaid ?? '').trim();
        if (!uaid) {
          throw new Error('Missing uaid for agent');
        }

        const feedbackResponse = await fetch(
          `/api/agents/${encodeURIComponent(uaid)}/feedback?includeRevoked=true`,
        );

        if (!feedbackResponse.ok) {
          const errorData = await feedbackResponse.json().catch(() => ({}));
          throw new Error(
            errorData.message || errorData.error || 'Failed to fetch feedback',
          );
        }

        const data = await feedbackResponse.json();
        if (cancelled) return;

        console.log('[FeedbackModal] Feedback API response:', {
          fullResponse: data,
          feedbackArray: data.feedback,
          summary: data.summary,
        });

        const feedbackItems = Array.isArray(data.feedback) ? data.feedback : [];
        
        console.log('[FeedbackModal] Feedback items:', {
          count: feedbackItems.length,
          items: feedbackItems.map((item: any, index: number) => ({
            index,
            fullItem: item,
            id: item.id,
            agentId: item.agentId,
            clientAddress: item.clientAddress,
            score: item.score,
            feedbackUri: item.feedbackUri,
            feedbackJson: item.feedbackJson ? 'present' : null,
            comment: item.comment,
            ratingPct: item.ratingPct,
            txHash: item.txHash,
            blockNumber: item.blockNumber,
            timestamp: item.timestamp,
            isRevoked: item.isRevoked,
            responseCount: item.responseCount,
          })),
        });

        setFeedbackPreview({
          key,
          loading: false,
          error: null,
          items: feedbackItems,
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
        error: 'No agent card (agent-card.json) URL configured for this agent.',
        messageEndpointUrl: null,
        agentCardUrl: null,
        agentCardText: null,
      });
      return;
    }
    const derived = deriveA2ADiscoveryUrls(endpoint);
    let cancelled = false;
    setA2APreview({
      key,
      loading: true,
      error: null,
      messageEndpointUrl: derived.messageEndpointUrl ?? endpoint,
      agentCardUrl: derived.agentCardUrl,
      agentCardText: null,
    });
    (async () => {
      try {
        const [agentCardResult] = await Promise.allSettled([
          derived.agentCardUrl ? loadAgentCardContent(derived.agentCardUrl) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setA2APreview({
          key,
          loading: false,
          error: null,
          messageEndpointUrl: derived.messageEndpointUrl ?? endpoint,
          agentCardUrl: derived.agentCardUrl,
          agentCardText: agentCardResult.status === 'fulfilled' ? agentCardResult.value : null,
        });
      } catch (error: any) {
        if (cancelled) return;
        setA2APreview({
          key,
          loading: false,
          error: error?.message ?? 'Unable to load agent card JSON.',
          messageEndpointUrl: derived.messageEndpointUrl ?? endpoint,
          agentCardUrl: derived.agentCardUrl,
          agentCardText: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDialog]);

  useEffect(() => {
    if (!activeDialog || activeDialog.action !== 'validations') {
      if (activeDialog?.action !== 'validations') {
        setValidationsPreview({
          key: null,
          loading: false,
          error: null,
          pending: null,
          completed: null,
        });
      }
      return;
    }

    const { agent } = activeDialog;
    const key = getAgentKey(agent);
    if (!key) {
      return;
    }

    let cancelled = false;

    setValidationsPreview({
      key,
      loading: true,
      error: null,
      pending: null,
      completed: null,
    });

    (async () => {
      try {
        const uaid = String((agent as any).uaid ?? '').trim();
        if (!uaid) {
          throw new Error('Missing uaid for agent');
        }
        
        // Fetch both on-chain validations and GraphQL validation responses
        const [validationsResponse, validationResponsesResponse] = await Promise.all([
          fetch(`/api/agents/${encodeURIComponent(uaid)}/validations`),
          fetch(`/api/agents/${encodeURIComponent(uaid)}/validation-responses?limit=100&offset=0&orderBy=timestamp&orderDirection=DESC`).catch(() => null),
        ]);

        if (!validationsResponse.ok) {
          const errorData = await validationsResponse.json().catch(() => ({}));
          throw new Error(
            errorData.message || errorData.error || 'Failed to fetch validations',
          );
        }

        const data = await validationsResponse.json();
        const graphQLData = validationResponsesResponse?.ok ? await validationResponsesResponse.json().catch(() => null) : null;
        
        if (cancelled) return;

        const pendingArray = Array.isArray(data.pending) ? data.pending : [];
        const completedArray = Array.isArray(data.completed) ? data.completed : [];
        
        // Merge GraphQL data with on-chain data by matching on requestHash
        // Normalize requestHash for comparison: convert to string, ensure 0x prefix, lowercase
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
          // Ensure 0x prefix and normalize to lowercase
          if (!hashStr.startsWith('0x')) {
            hashStr = '0x' + hashStr;
          }
          return hashStr.toLowerCase();
        };

        const graphQLRequests = graphQLData?.validationRequests || [];

        const graphQLByRequestHash = new Map<string, typeof graphQLRequests[0]>();
        for (const request of graphQLRequests) {
          const normalized = normalizeRequestHash(request.requestHash);
          if (normalized) {
            graphQLByRequestHash.set(normalized, request);
          }
        }

        const augmentValidation = (entry: any, type: 'pending' | 'completed'): any => {
          const contractRequestHash = entry.requestHash;
          const normalizedRequestHash = normalizeRequestHash(contractRequestHash);

          if (normalizedRequestHash) {
            const graphQLEntry = graphQLByRequestHash.get(normalizedRequestHash);
            if (graphQLEntry) {
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
            }
          }
          return entry;
        };

        const augmentedPending = pendingArray.map((entry: any) => augmentValidation(entry, 'pending'));
        const augmentedCompleted = completedArray.map((entry: any) => augmentValidation(entry, 'completed'));

        setValidationsPreview({
          key,
          loading: false,
          error: null,
          pending: augmentedPending,
          completed: augmentedCompleted,
        });
      } catch (error: any) {
        if (cancelled) return;
        setValidationsPreview({
          key,
          loading: false,
          error: error?.message ?? 'Unable to load validations.',
          pending: null,
          completed: null,
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
            <div style={{ marginTop: '1rem' }}>
              <strong
                style={{
                  color: palette.textPrimary,
                  display: 'block',
                  marginBottom: '0.5rem',
                }}
              >
                Info (from discovery: identity8004.descriptor.onchainMetadataJson)
              </strong>
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: '10px',
                  padding: '0.75rem',
                  backgroundColor: palette.surfaceMuted,
                  maxHeight: '350px',
                  overflow: 'auto',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.85rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {typeof (agent as any).onchainMetadataJson === 'string' &&
                (agent as any).onchainMetadataJson.trim() ? (
                  (() => {
                    try {
                      const parsed = JSON.parse((agent as any).onchainMetadataJson);
                      return JSON.stringify(parsed, null, 2);
                    } catch {
                      return String((agent as any).onchainMetadataJson);
                    }
                  })()
                ) : (
                  <span style={{ color: palette.textSecondary }}>
                    No onchainMetadataJson provided by discovery for this agent.
                  </span>
                )}
              </div>
            </div>
            {(agent.a2aEndpoint || agent.mcpEndpoint) && (
              <div style={{ marginTop: '1rem' }}>
                <strong style={{ color: palette.textPrimary, display: 'block', marginBottom: '0.5rem' }}>Endpoints</strong>
                {agent.a2aEndpoint && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>A2A:</strong>{' '}
                    <a
                      href={agent.a2aEndpoint}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: palette.accent,
                        wordBreak: 'break-all',
                        textDecoration: 'none',
                        userSelect: 'text',
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
                  </div>
                )}
                {agent.mcpEndpoint && (
                  <div>
                    <strong style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>MCP:</strong>{' '}
                    <a
                      href={agent.mcpEndpoint}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: palette.accent,
                        wordBreak: 'break-all',
                        textDecoration: 'none',
                        userSelect: 'text',
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
                  </div>
                )}
              </div>
            )}
          </>
        );
      case 'registration': {
        const previewMatchesAgent = registrationPreview.key === `${agent.chainId}:${agent.agentId}`;
        return (
          <>
            <p style={{ marginTop: 0 }}>
              Registration JSON (from discovery: identity8004.descriptor.json).
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

                    // Rebuild SmartAccount client for this agent using wallet + bundler
                    const bundlerEnv = getBundlerUrlForId(agent.chainId);
                    if (!bundlerEnv) {
                      setRegistrationEditError(
                        'Missing bundler URL configuration for this chain. Set NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_* env vars.',
                      );
                      return;
                    }

                    const agentNameForAA = agent.agentName;
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

                    await updateAgentRegistrationWithWallet({
                      did8004,
                      chain,
                      accountClient,
                      registration: raw,
                      onStatusUpdate: (msg: string) => {
                        console.log('[RegistrationUpdate]', msg);
                      },
                    });
                    try {
                      const uaid =
                        typeof agent.uaid === 'string' && agent.uaid.trim()
                          ? agent.uaid.trim()
                          : did8004;
                      await fetch(
                        `/api/agents/${encodeURIComponent(uaid)}/refresh`,
                        { method: 'POST' },
                      );
                    } catch (refreshError) {
                      console.warn('Agent refresh failed after registration update:', refreshError);
                    }

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
                  color: '#ffffff',
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
              DID:8004 binds ERC-8004 identities directly to smart accounts.
            </p>
            <p>
              Suggested identifier:{' '}
              <code>did:8004:{agent.chainId}:{agent.agentId}</code>
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
              A2A uses an <strong>agent-card.json</strong> document for discovery.
            </p>
            {a2aPreview.agentCardUrl ? (
              <a
                href={a2aPreview.agentCardUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: palette.accent, wordBreak: 'break-all' }}
              >
                {a2aPreview.agentCardUrl}
              </a>
            ) : (
              <p style={{ color: palette.dangerText }}>No agent card URL is available for this agent.</p>
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
              {!a2aPreview.agentCardUrl ? (
                <span style={{ color: palette.textSecondary }}>No discovery URL to preview.</span>
              ) : !a2aMatchesAgent || a2aPreview.loading ? (
                <span style={{ color: palette.textSecondary }}>Loading agent-card.json…</span>
              ) : a2aPreview.error ? (
                <span style={{ color: palette.dangerText }}>{a2aPreview.error}</span>
              ) : (
                <>
                  <div style={{ marginBottom: '0.9rem' }}>
                    {a2aPreview.agentCardText ? formatJsonIfPossible(a2aPreview.agentCardText) : '—'}
                  </div>
                </>
              )}
            </div>
          </>
        );
      }
      case 'validations': {
        const agentKey = getAgentKey(agent);
        const previewMatchesAgent =
          agentKey !== null && validationsPreview.key === agentKey;
        const loading = !previewMatchesAgent || validationsPreview.loading;
        const error = previewMatchesAgent ? validationsPreview.error : null;
        const pending = previewMatchesAgent && Array.isArray(validationsPreview.pending) ? validationsPreview.pending : [];
        const completed = previewMatchesAgent && Array.isArray(validationsPreview.completed) ? validationsPreview.completed : [];

        return (
          <>
            <p style={{ marginTop: 0 }}>
              Pending and completed validations for this agent from the on-chain
              validation registry.
            </p>
            {loading && !error && (
              <p style={{ color: palette.textSecondary }}>
                Loading validations…
              </p>
            )}
            {error && (
              <p style={{ color: palette.dangerText }}>{error}</p>
            )}
            {!loading && !error && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  maxHeight: '420px',
                  overflow: 'auto',
                  fontSize: '0.85rem',
                }}
              >
                <div>
                  <h4
                    style={{
                      margin: '0 0 0.5rem',
                      fontSize: '0.9rem',
                    }}
                  >
                    Completed validations ({completed.length})
                  </h4>
                  {completed.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {completed.map((item: any, index) => (
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
                    Pending validations ({pending.length})
                  </h4>
                  {pending.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {pending.map((item: any, index) => (
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
          </>
        );
      }
      case 'feedback': {
        const agentKey = getAgentKey(agent);
        const previewMatchesAgent =
          agentKey !== null && feedbackPreview.key === agentKey;
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
                    const id = record.id as string | undefined;
                    const agentId = record.agentId as string | number | undefined;
                    const clientAddress = record.clientAddress as string | undefined;
                    const score = record.score as number | undefined;
                    const isRevoked = record.isRevoked as boolean | undefined;
                    const feedbackUri = record.feedbackUri as string | undefined;
                    const feedbackJson = record.feedbackJson as string | undefined;
                    const txHash = record.txHash as string | undefined;
                    const blockNumber = record.blockNumber as number | undefined;
                    const timestamp = record.timestamp as number | string | undefined;
                    const comment = record.comment as string | null | undefined;
                    const ratingPct = record.ratingPct as number | null | undefined;
                    const responseCount = record.responseCount as number | null | undefined;
                    const createdAt = record.createdAt as string | undefined;
                    const updatedAt = record.updatedAt as string | undefined;

                    // Convert IPFS URI to HTTP URL if needed
                    const displayFeedbackUri = feedbackUri?.startsWith('ipfs://')
                      ? `https://ipfs.io/ipfs/${feedbackUri.replace('ipfs://', '').replace(/^ipfs\//i, '')}`
                      : feedbackUri;

                    return (
                      <li
                        key={id ?? record.index ?? index}
                        style={{
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: `1px solid ${palette.border}`,
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
                              gap: '0.75rem',
                              fontSize: '0.9rem',
                              fontWeight: 600,
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
                          {id && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>ID:</strong>{' '}
                              <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                {id.length > 40 ? `${id.slice(0, 20)}…${id.slice(-18)}` : id}
                              </code>
                            </div>
                          )}
                          {agentId !== undefined && agentId !== null && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Agent ID:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{String(agentId)}</span>
                            </div>
                          )}
                          {clientAddress && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Client:</strong>{' '}
                              <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                {clientAddress.length > 20 ? `${clientAddress.slice(0, 10)}…${clientAddress.slice(-8)}` : clientAddress}
                              </code>
                            </div>
                          )}
                          {comment && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Comment:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{comment}</span>
                            </div>
                          )}
                          {ratingPct !== null && ratingPct !== undefined && typeof ratingPct === 'number' && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Rating %:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{ratingPct}%</span>
                            </div>
                          )}
                          {txHash && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>TX Hash:</strong>{' '}
                              <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                {txHash.length > 20 ? `${txHash.slice(0, 10)}…${txHash.slice(-8)}` : txHash}
                              </code>
                            </div>
                          )}
                          {typeof blockNumber === 'number' && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Block:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{blockNumber}</span>
                            </div>
                          )}
                          {timestamp && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Time:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>
                                {new Date(Number(timestamp) * 1000).toLocaleString()}
                              </span>
                            </div>
                          )}
                          {responseCount !== null && responseCount !== undefined && typeof responseCount === 'number' && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Response Count:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{responseCount}</span>
                            </div>
                          )}
                          {displayFeedbackUri && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Feedback URI:</strong>{' '}
                              <a
                                href={displayFeedbackUri}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: '0.85rem',
                                  color: palette.accent,
                                  textDecoration: 'none',
                                  wordBreak: 'break-all',
                                }}
                              >
                                {feedbackUri}
                              </a>
                            </div>
                          )}
                          {feedbackJson && (
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
                                {formatJsonIfPossible(feedbackJson)}
                              </pre>
                            </div>
                          )}
                          {createdAt && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Created At:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>
                                {new Date(createdAt).toLocaleString()}
                              </span>
                            </div>
                          )}
                          {updatedAt && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Updated At:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>
                                {new Date(updatedAt).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        );
      }
      case 'give-feedback': {
        const { agent } = activeDialog;
        const agentKey = getAgentKey(agent);
        const skills = agentKey ? feedbackSkillsCache[agentKey] || [] : [];
        const score = feedbackForm.rating * 20; // Convert 1-5 to 20-100

        return (
          <>
            <p style={{ marginTop: 0 }}>
              Submit feedback for <strong>{agent.agentName || `Agent #${agent.agentId}`}</strong>.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: palette.textPrimary,
                  marginBottom: '0.5rem',
                }}
              >
                Rating
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() =>
                      setFeedbackForm(prev => ({ ...prev, rating: num }))
                    }
                    disabled={feedbackSubmitting}
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '8px',
                      fontWeight: 600,
                      cursor: feedbackSubmitting ? 'not-allowed' : 'pointer',
                      backgroundColor:
                        feedbackForm.rating === num
                          ? palette.accent
                          : palette.surfaceMuted,
                      color: palette.surface,
                      border: `1px solid ${palette.border}`,
                      transition: 'background-color 0.2s',
                    }}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {skills.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: palette.textPrimary,
                    marginBottom: '0.5rem',
                  }}
                >
                  Skill (optional)
                </label>
                <select
                  value={feedbackForm.skillId}
                  onChange={e =>
                    setFeedbackForm(prev => ({ ...prev, skillId: e.target.value }))
                  }
                  disabled={feedbackSubmitting}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontSize: '0.875rem',
                  }}
                >
                  <option value="">Select a skill…</option>
                  {skills.map(skill => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name || skill.id}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.75rem' }}>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: palette.textSecondary,
                    marginBottom: '0.25rem',
                  }}
                >
                  Tag 1 (optional)
                </label>
                <input
                  type="text"
                  value={feedbackForm.tag1}
                  onChange={e =>
                    setFeedbackForm(prev => ({ ...prev, tag1: e.target.value }))
                  }
                  placeholder="e.g. quality, speed"
                  disabled={feedbackSubmitting}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontSize: '0.875rem',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: palette.textSecondary,
                    marginBottom: '0.25rem',
                  }}
                >
                  Tag 2 (optional)
                </label>
                <input
                  type="text"
                  value={feedbackForm.tag2}
                  onChange={e =>
                    setFeedbackForm(prev => ({ ...prev, tag2: e.target.value }))
                  }
                  placeholder="e.g. helpful, safe"
                  disabled={feedbackSubmitting}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontSize: '0.875rem',
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.75rem' }}>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: palette.textSecondary,
                    marginBottom: '0.25rem',
                  }}
                >
                  Context (optional)
                </label>
                <input
                  type="text"
                  value={feedbackForm.context}
                  onChange={e =>
                    setFeedbackForm(prev => ({ ...prev, context: e.target.value }))
                  }
                  placeholder="e.g. enterprise, research"
                  disabled={feedbackSubmitting}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontSize: '0.875rem',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: palette.textSecondary,
                    marginBottom: '0.25rem',
                  }}
                >
                  Capability (optional)
                </label>
                <input
                  type="text"
                  value={feedbackForm.capability}
                  onChange={e =>
                    setFeedbackForm(prev => ({ ...prev, capability: e.target.value }))
                  }
                  placeholder="e.g. problem_solving"
                  disabled={feedbackSubmitting}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: `1px solid ${palette.border}`,
                    backgroundColor: palette.surfaceMuted,
                    color: palette.textPrimary,
                    fontSize: '0.875rem',
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: palette.textPrimary,
                  marginBottom: '0.5rem',
                }}
              >
                Comment
              </label>
              <textarea
                value={feedbackForm.comment}
                onChange={e =>
                  setFeedbackForm(prev => ({ ...prev, comment: e.target.value }))
                }
                placeholder="Enter your feedback..."
                disabled={feedbackSubmitting}
                style={{
                  width: '100%',
                  backgroundColor: palette.surfaceMuted,
                  color: palette.textPrimary,
                  borderRadius: '8px',
                  padding: '0.75rem',
                  border: `1px solid ${palette.border}`,
                  resize: 'vertical',
                  minHeight: '100px',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {feedbackSubmitError && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  backgroundColor: palette.dangerSurface,
                  border: `1px solid ${palette.dangerText}`,
                  borderRadius: '8px',
                }}
              >
                <p style={{ color: palette.dangerText, fontSize: '0.875rem' }}>
                  {feedbackSubmitError}
                </p>
              </div>
            )}

            {feedbackSubmitSuccess && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  backgroundColor: 'rgba(34, 197, 94, 0.2)',
                  border: '1px solid #22c55e',
                  borderRadius: '8px',
                }}
              >
                <p style={{ color: '#86efac', fontSize: '0.875rem' }}>
                  Feedback submitted successfully!
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => {
                  if (!feedbackSubmitting) {
                    closeDialog();
                  }
                }}
                disabled={feedbackSubmitting}
                style={{
                  flex: 1,
                  padding: '0.5rem 1rem',
                  backgroundColor: palette.surfaceMuted,
                  color: palette.textPrimary,
                  borderRadius: '8px',
                  border: `1px solid ${palette.border}`,
                  cursor: feedbackSubmitting ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: feedbackSubmitting ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (feedbackSubmitting || !feedbackForm.comment.trim()) {
                    return;
                  }

                  if (!provider || !walletAddress) {
                    setFeedbackSubmitError(
                      'Wallet not connected. Connect your wallet to submit feedback.',
                    );
                    return;
                  }

                  setFeedbackSubmitting(true);
                  setFeedbackSubmitError(null);
                  setFeedbackSubmitSuccess(null);
                  setFeedbackSubmitStatus('Requesting feedback authorization...');

                  try {
                    const parsedChainId =
                      typeof agent.chainId === 'number' &&
                      Number.isFinite(agent.chainId)
                        ? agent.chainId
                        : DEFAULT_CHAIN_ID;
                    const parsedAgentId =
                      typeof agent.agentId === 'string'
                        ? Number.parseInt(agent.agentId, 10)
                        : Number(agent.agentId ?? 0);
                    const did8004 = buildDid8004(parsedChainId, parsedAgentId);

                    // Ensure we have a connected wallet (Web3Auth / MetaMask)
                    if (!walletAddress) {
                      throw new Error(
                        'Wallet not connected. Please connect your wallet to give feedback.',
                      );
                    }
                    // Use the logged-in EOA address as the client for both feedbackAuth and giveFeedback.
                    const clientAddress = walletAddress as `0x${string}`;

                    // Request feedback auth
                    const feedbackAuthParams = new URLSearchParams({
                      clientAddress,
                      agentId: parsedAgentId.toString(),
                      chainId: parsedChainId.toString(),
                      ...(agent.agentName ? { agentName: agent.agentName } : {}),
                    });

                    setFeedbackSubmitStatus('Requesting feedback authorization...');
                    const feedbackAuthResponse = await fetch(
                      `/api/agents/${encodeURIComponent(
                        did8004,
                      )}/feedback-auth?${feedbackAuthParams.toString()}`,
                    );

                    if (!feedbackAuthResponse.ok) {
                      const errorData = await feedbackAuthResponse.json();
                      throw new Error(
                        errorData.message ||
                          errorData.error ||
                          'Failed to get feedback auth',
                      );
                    }

                    const feedbackAuthData = await feedbackAuthResponse.json();
                    const feedbackAuthId = feedbackAuthData.feedbackAuthId;
                    const resolvedAgentId =
                      feedbackAuthData.agentId || parsedAgentId;
                    const resolvedChainId =
                      feedbackAuthData.chainId || parsedChainId;

                    if (!feedbackAuthId) {
                      throw new Error('No feedbackAuth returned by provider');
                    }

                    // Build SmartAccount client for this agent using the connected wallet
                    const chain = getChainForId(resolvedChainId);
                    const bundlerEnv = getBundlerUrlForId(resolvedChainId);
                    if (!bundlerEnv) {
                      throw new Error(
                        'Missing bundler URL configuration for this chain. Set NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_* env vars.',
                      );
                    }

                    // Submit feedback via client-side EOA transaction (user pays gas)
                    setFeedbackSubmitStatus('Submitting feedback transaction…');
                    const feedbackResult = await giveFeedbackWithWallet({
                      did8004,
                      chain,
                      score,
                      feedback: feedbackForm.comment,
                      feedbackAuth: feedbackAuthId,
                      clientAddress: clientAddress as `0x${string}`,
                      ethereumProvider: provider,
                      ...(feedbackForm.tag1 && { tag1: feedbackForm.tag1 }),
                      ...(feedbackForm.tag2 && { tag2: feedbackForm.tag2 }),
                      ...(feedbackForm.skillId && { skill: feedbackForm.skillId }),
                      ...(feedbackForm.context && { context: feedbackForm.context }),
                      ...(feedbackForm.capability && {
                        capability: feedbackForm.capability,
                      }),
                      onStatusUpdate: (msg: string) => {
                        setFeedbackSubmitStatus(msg);
                      },
                    });

                    console.info('Feedback submitted successfully:', feedbackResult);
                    setFeedbackSubmitSuccess('Feedback submitted successfully!');
                    setFeedbackSubmitStatus(null);

                    // Reset form after a delay
                    setTimeout(() => {
                      setFeedbackForm(initialFeedbackForm);
                      closeDialog();
                    }, 1500);
                  } catch (error: any) {
                    console.error('Error submitting feedback:', error);
                    setFeedbackSubmitError(
                      error?.message ?? 'Failed to submit feedback. Please try again.',
                    );
                    setFeedbackSubmitStatus(null);
                  } finally {
                    setFeedbackSubmitting(false);
                  }
                }}
                disabled={feedbackSubmitting || !feedbackForm.comment.trim()}
                style={{
                  flex: 1,
                  padding: '0.5rem 1rem',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  borderRadius: '8px',
                  border: 'none',
                  cursor:
                    feedbackSubmitting || !feedbackForm.comment.trim()
                      ? 'not-allowed'
                      : 'pointer',
                  fontWeight: 600,
                  opacity:
                    feedbackSubmitting || !feedbackForm.comment.trim() ? 0.6 : 1,
                }}
              >
                {feedbackSubmitting
                  ? feedbackSubmitStatus || 'Submitting...'
                  : 'Submit'}
              </button>
            </div>
          </>
        );
      }
      case 'session': {
        const { agent } = activeDialog;
        return (
          <>
            <p style={{ marginTop: 0 }}>
              Session packages describe delegated SmartAccount access and can be used by tools to perform actions on behalf of this agent.
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
  }, [
    activeDialog,
    registrationPreview,
    a2aPreview,
    sessionPreview,
    validationsPreview,
    feedbackPreview,
    feedbackForm,
    feedbackSubmitting,
    feedbackSubmitError,
    feedbackSubmitSuccess,
    feedbackSubmitStatus,
    feedbackSkillsCache,
  ]);

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

        const chainEnv = getClientChainEnv(agent.chainId);
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
          chainId: agent.chainId,
          agentAccount: agent.agentAccount as `0x${string}`,
          provider,
          ownerAddress: walletAddress as `0x${string}`,
          rpcUrl: chainEnv.rpcUrl,
          bundlerUrl: chainEnv.bundlerUrl,
          identityRegistry: chainEnv.identityRegistry,
          reputationRegistry: chainEnv.reputationRegistry,
          validationRegistry: chainEnv.validationRegistry,
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
      {navigatingToAgent && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              padding: '2rem',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                border: '4px solid #f3f3f3',
                borderTop: '4px solid #2f2f2f',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <div style={{ fontSize: '1rem', fontWeight: 600 }}>Loading agent details...</div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div
          style={{
            display: isMobile ? 'block' : 'flex',
            gap: '1.5rem',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      {!hideFilters && (
      <div
        style={{
          display: isMobile ? 'block' : 'flex',
          gap: '1.5rem',
          alignItems: 'flex-start',
        }}
      >
      <div
        style={{
          flex: '1 1 auto',
          minWidth: 0,
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
                placeholder={isMobile ? 'Search by name' : 'Search by name or ID'}
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
                gridTemplateColumns: 'auto minmax(220px, 1fr) auto',
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
                  padding: '0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${palette.border}`,
                  backgroundColor: palette.surfaceMuted,
                  fontWeight: 600,
                  color: palette.textPrimary,
                  boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
                  minWidth: '130px',
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
                placeholder="Agent id"
                aria-label="Agent id"
                style={{
                  width: 'auto',
                  maxWidth: '12ch',
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

        {/* Advanced filters */}
        <div
          style={{
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: `1px dashed ${palette.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: '0.85rem',
                  color: palette.textSecondary,
                }}
              >
                {totalAgentsLabel} agents
              </span>
              <button
                type="button"
                onClick={() => {
                  const nextValue = !filters.only8004Agents;
                  const nextName = nextValue
                    ? '8004-agent.eth'
                    : filters.name.trim().toLowerCase() === '8004-agent.eth'
                    ? ''
                    : filters.name;
                  const updatedFilters = {
                    ...filters,
                    only8004Agents: nextValue,
                    name: nextName,
                  };
                  onFilterChange('only8004Agents', nextValue);
                  onFilterChange('name', nextName);
                  onSearch(updatedFilters);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '999px',
                  border: `1px solid ${filters.only8004Agents ? palette.accent : palette.border}`,
                  backgroundColor: filters.only8004Agents ? palette.accent : palette.surfaceMuted,
                  color: filters.only8004Agents ? palette.surface : palette.textSecondary,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    border: `1px solid ${
                      filters.only8004Agents ? '#16a34a' : palette.border
                    }`,
                    backgroundColor: 'transparent',
                    fontSize: '0.7rem',
                    color: filters.only8004Agents ? '#16a34a' : 'transparent',
                  }}
                >
                  {filters.only8004Agents ? '✓' : ''}
                </span>
                <span>8004-agent.eth</span>
              </button>
              {isConnected && Boolean(walletAddress) && (
                <button
                  type="button"
                  onClick={() => {
                    const nextValue = !filters.mineOnly;
                    const updatedFilters = { ...filters, mineOnly: nextValue };
                    onFilterChange('mineOnly', nextValue);
                    onSearch(updatedFilters);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '999px',
                    border: `1px solid ${filters.mineOnly ? '#16a34a' : palette.border}`,
                    backgroundColor: filters.mineOnly ? '#16a34a' : palette.surfaceMuted,
                    color: filters.mineOnly ? palette.surface : palette.textSecondary,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      border: `1px solid ${
                        filters.mineOnly ? palette.surface : palette.border
                      }`,
                      backgroundColor: 'transparent',
                      fontSize: '0.7rem',
                      color: filters.mineOnly ? palette.surface : 'transparent',
                    }}
                  >
                    {filters.mineOnly ? '✓' : ''}
                  </span>
                  <span>my agents</span>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(prev => !prev)}
              style={{
                padding: '0.4rem 0.9rem',
                borderRadius: '999px',
                border: `1px solid ${palette.border}`,
                backgroundColor: showAdvancedFilters ? palette.surfaceMuted : palette.surface,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                color: palette.textSecondary,
              }}
            >
              {showAdvancedFilters ? 'Hide advanced filters' : 'Show advanced filters'}
            </button>
          </div>
          {showAdvancedFilters && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                marginTop: '0.25rem',
              }}
            >
              {/* Row 1: Protocol, Created within, Path, Address */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  alignItems: 'flex-end',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: 'auto',
                    minWidth: isMobile ? '160px' : '140px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: palette.textSecondary,
                    }}
                  >
                    Created within (days)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={filters.createdWithinDays}
                    onChange={event => onFilterChange('createdWithinDays', event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSearch();
                      }
                    }}
                    placeholder="e.g. 30"
                    aria-label="Created within days"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: 'auto',
                    minWidth: isMobile ? '160px' : '140px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: palette.textSecondary,
                    }}
                  >
                    Protocol
                  </label>
                  <select
                    value={filters.protocol}
                    onChange={event => {
                      const value = event.target.value as AgentsPageFilters['protocol'];
                      onFilterChange('protocol', value);
                      onSearch({ ...filters, protocol: value });
                    }}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.85rem',
                    }}
                  >
                    <option value="all">All</option>
                    <option value="a2a">A2A only</option>
                    <option value="mcp">MCP only</option>
                  </select>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: 'auto',
                    minWidth: isMobile ? '180px' : '200px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: palette.textSecondary,
                    }}
                  >
                    Protocol Path Contains
                  </label>
                  <input
                    value={filters.path}
                    onChange={event => onFilterChange('path', event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSearch();
                      }
                    }}
                    placeholder="Endpoint or URL fragment"
                    aria-label="Protocol path filter"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: 'auto',
                    minWidth: isMobile ? '200px' : '220px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: palette.textSecondary,
                    }}
                  >
                    Address (on-chain agent account)
                  </label>
                  <input
                    value={filters.address}
                    onChange={event => onFilterChange('address', event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSearch();
                      }
                    }}
                    placeholder="0x… agent account"
                    aria-label="Agent account address"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
              </div>

              {/* Row 2: Min reviews, Min avg rating, Min validations */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  alignItems: 'flex-end',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: 'auto',
                    minWidth: isMobile ? '140px' : '120px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: palette.textSecondary,
                    }}
                  >
                    Min reviews
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={filters.minReviews}
                    onChange={event => onFilterChange('minReviews', event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSearch();
                      }
                    }}
                    placeholder="e.g. 5"
                    aria-label="Minimum reviews"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: 'auto',
                    minWidth: isMobile ? '140px' : '120px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: palette.textSecondary,
                    }}
                  >
                    Min avg rating
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={filters.minAvgRating}
                    onChange={event => onFilterChange('minAvgRating', event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSearch();
                      }
                    }}
                    placeholder="e.g. 4.0"
                    aria-label="Minimum average rating"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: 'auto',
                    minWidth: isMobile ? '140px' : '120px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: palette.textSecondary,
                    }}
                  >
                    Min validations
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={filters.minValidations}
                    onChange={event => onFilterChange('minValidations', event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSearch();
                      }
                    }}
                    placeholder="e.g. 3"
                    aria-label="Minimum validations"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: 'auto',
                    minWidth: isMobile ? '140px' : '120px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: palette.textSecondary,
                    }}
                  >
                    Min associations
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={filters.minAssociations}
                    onChange={event => onFilterChange('minAssociations', event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSearch();
                      }
                    }}
                    placeholder="e.g. 10"
                    aria-label="Minimum associations"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.85rem',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: 'auto',
                    minWidth: isMobile ? '140px' : '120px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: palette.textSecondary,
                    }}
                  >
                    Min ATI score
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={filters.minAtiOverallScore}
                    onChange={event => onFilterChange('minAtiOverallScore', event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onSearch();
                      }
                    }}
                    placeholder="e.g. 80"
                    aria-label="Minimum ATI overall score"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '10px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
            gap: '1.5rem',
          }}
        >
          {agentsToRender.length === 0 && (
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

          {agentsToRender.map(agent => {
            const ownershipKey = `${agent.chainId}:${agent.agentId}`;
            const isOwned = Boolean(ownedMap[ownershipKey]);
            const imageUrl =
              typeof agent.image === 'string' && agent.image.trim()
                ? agent.image.trim()
                : shadowAgentSrc;
            const explorerBase = EXPLORER_BY_CHAIN[agent.chainId] ?? 'https://etherscan.io';
            const nftTransfersUrl =
              typeof agent.agentAccount === 'string' && agent.agentAccount
                ? `${explorerBase}/address/${agent.agentAccount}#nfttransfers`
                : null;

            const chainMeta = getChainDisplayMetadata(agent.chainId);
            const chainLabel =
              chainMeta?.displayName ||
              chainMeta?.chainName ||
              `Chain ${agent.chainId}`;
            const ownerDisplay =
              typeof agent.agentAccount === 'string' && agent.agentAccount.length > 10
                ? `${agent.agentAccount.slice(0, 5)}…${agent.agentAccount.slice(-5)}`
                : agent.agentAccount || null;

            const reviewsCount =
              typeof agent.feedbackCount === 'number' && agent.feedbackCount >= 0
                ? agent.feedbackCount
                : 0;
            const validationsCount =
              typeof agent.validationCompletedCount === 'number' &&
              agent.validationCompletedCount >= 0
                ? agent.validationCompletedCount
                : 0;
            const validationsPendingCount =
              typeof agent.validationPendingCount === 'number' &&
              agent.validationPendingCount >= 0
                ? agent.validationPendingCount
                : 0;
            const validationsRequestedCount =
              typeof agent.validationRequestedCount === 'number' &&
              agent.validationRequestedCount >= 0
                ? agent.validationRequestedCount
                : 0;
            const initiatedAssociationsCount =
              typeof agent.initiatedAssociationCount === 'number' &&
              Number.isFinite(agent.initiatedAssociationCount) &&
              agent.initiatedAssociationCount >= 0
                ? agent.initiatedAssociationCount
                : null;
            const approvedAssociationsCount =
              typeof agent.approvedAssociationCount === 'number' &&
              Number.isFinite(agent.approvedAssociationCount) &&
              agent.approvedAssociationCount >= 0
                ? agent.approvedAssociationCount
                : null;
            const totalAssociationsForDisplay =
              (initiatedAssociationsCount ?? 0) + (approvedAssociationsCount ?? 0);
            const averageRating =
              typeof agent.feedbackAverageScore === 'number' &&
              Number.isFinite(agent.feedbackAverageScore)
                ? agent.feedbackAverageScore
                : null;

            const trustLedgerScore =
              typeof (agent as any).trustLedgerScore === 'number' &&
              Number.isFinite((agent as any).trustLedgerScore) &&
              (agent as any).trustLedgerScore >= 0
                ? ((agent as any).trustLedgerScore as number)
                : null;
            const trustLedgerOverallRank =
              typeof (agent as any).trustLedgerOverallRank === 'number' &&
              Number.isFinite((agent as any).trustLedgerOverallRank) &&
              (agent as any).trustLedgerOverallRank > 0
                ? ((agent as any).trustLedgerOverallRank as number)
                : null;
            const trustLedgerBadgeCount =
              typeof (agent as any).trustLedgerBadgeCount === 'number' &&
              Number.isFinite((agent as any).trustLedgerBadgeCount) &&
              (agent as any).trustLedgerBadgeCount >= 0
                ? ((agent as any).trustLedgerBadgeCount as number)
                : null;

            const createdAtTimeSeconds =
              typeof agent.createdAtTime === 'number' && Number.isFinite(agent.createdAtTime)
                ? agent.createdAtTime
                : null;
            const nowSeconds = Math.floor(Date.now() / 1000);
            const secondsAgo =
              createdAtTimeSeconds && createdAtTimeSeconds > 0
                ? Math.max(0, nowSeconds - createdAtTimeSeconds)
                : null;
            const daysAgo =
              secondsAgo !== null ? Math.floor(secondsAgo / (24 * 60 * 60)) : null;
            const hoursAgo =
              secondsAgo !== null ? Math.floor(secondsAgo / (60 * 60)) : null;
            const minutesAgo =
              secondsAgo !== null ? Math.floor(secondsAgo / 60) : null;
            return (
              <article
                key={String((agent as any).uaid ?? `${agent.chainId}-${agent.agentId}`)}
                style={{
                  borderRadius: '20px',
                  border: `1px solid ${palette.border}`,
                  padding: '1.75rem',
                  backgroundColor: palette.surface,
                  boxShadow: '0 4px 12px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  position: 'relative',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  cursor: 'pointer',
                  overflow: 'hidden',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.transform = 'translateY(-6px)';
                  event.currentTarget.style.boxShadow = '0 12px 32px rgba(15,23,42,0.15), 0 4px 8px rgba(15,23,42,0.08)';
                  event.currentTarget.style.borderColor = palette.accent + '40';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.transform = 'none';
                  event.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04)';
                  event.currentTarget.style.borderColor = palette.border;
                }}
                onClick={(event) => {
                  if (event.defaultPrevented) {
                    return;
                  }
                  const target = event.target as HTMLElement | null;
                  if (target?.closest('button,[data-agent-card-link]')) {
                    return;
                  }
                  const uaid = String((agent as any).uaid ?? '').trim();
                  if (!uaid || !uaid.startsWith('uaid:')) {
                    throw new Error(
                      `Invalid agent.uaid (expected uaid:*): ${uaid || '<empty>'}`,
                    );
                  }
                  setNavigatingToAgent(uaid);
                  router.push(`/agents/${encodeURIComponent(uaid)}`);
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '0.75rem',
                    right: '0.75rem',
                    display: 'flex',
                    gap: '0.4rem',
                  }}
                >
                  {isOwned && (
                    <>
                      {(() => {
                        const raw = (agent as any).active ?? (agent as any).agentActive;
                        const isActive =
                          typeof raw === 'boolean'
                            ? raw
                            : typeof raw === 'string'
                              ? raw.toLowerCase() === 'true'
                              : true;
                        const fg = isActive ? '#166534' : '#1e3a8a'; // green / dark blue
                        const bg = isActive ? 'rgba(22,101,52,0.10)' : 'rgba(30,58,138,0.10)';
                        const border = isActive ? 'rgba(22,101,52,0.35)' : 'rgba(30,58,138,0.35)';
                        return (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              const uaid = String((agent as any).uaid ?? '').trim();
                              if (!uaid || !uaid.startsWith('uaid:')) {
                                throw new Error(
                                  `Invalid agent.uaid (expected uaid:*): ${uaid || '<empty>'}`,
                                );
                              }
                              setNavigatingToAgent(uaid);
                              router.push(`/admin-tools/${encodeURIComponent(uaid)}`);
                            }}
                            aria-label={`Edit Agent ${agent.agentId}`}
                            title={isActive ? 'Edit agent (active)' : 'Edit agent (inactive)'}
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '999px',
                              border: `1px solid ${border}`,
                              backgroundColor: bg,
                              color: fg,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              boxShadow: '0 2px 6px rgba(15,23,42,0.15)',
                              lineHeight: 1,
                            }}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden="true"
                              focusable="false"
                              style={{ display: 'block' }}
                            >
                              <path
                                d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Z"
                                fill="currentColor"
                              />
                              <path
                                d="M20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82Z"
                                fill="currentColor"
                              />
                            </svg>
                          </button>
                        );
                      })()}
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
                  <img
                    src={imageUrl}
                    alt={agent.agentName || 'Agent'}
                    onError={event => {
                      const target = event.currentTarget as HTMLImageElement;
                      if (!target.src.includes(shadowAgentSrc)) {
                        target.src = shadowAgentSrc;
                      }
                    }}
                    style={{
                      height: '64px',
                      width: 'auto',
                      maxWidth: '100%',
                      objectFit: 'cover',
                    }}
                  />
                  <div>
                    {nftTransfersUrl ? (
                      <a
                        data-agent-card-link
                        onClick={(event) => event.stopPropagation()}
                        href={nftTransfersUrl}
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
                    <div
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: palette.textSecondary,
                        marginTop: '0.05rem',
                      }}
                    >
                      {chainLabel}
                    </div>
                  </div>
                  
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {(() => {
                    const ensLink = getEnsNameLink(agent);
                    const isEnsName =
                      typeof agent.agentName === 'string' &&
                      agent.agentName.toLowerCase().endsWith('.eth');

                    // Get display name: handle empty strings explicitly
                    const displayName = 
                      typeof agent.agentName === 'string' && agent.agentName.trim().length > 0
                        ? agent.agentName.trim()
                        : 'Unnamed Agent';


                    return (
                      <>
                        <h4 style={{ margin: 0, fontSize: '1.15rem' }}>
                          {ensLink && isEnsName ? (
                            <a
                              data-agent-card-link
                              onClick={(event) => event.stopPropagation()}
                              href={ensLink.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: 'rgb(56, 137, 255)',
                                textDecoration: 'none',
                              }}
                            >
                              {displayName}
                            </a>
                          ) : (
                            displayName
                          )}
                        </h4>
                        {agent.agentCategory && (
                          <div
                            style={{
                              fontSize: '0.85rem',
                              color: palette.textSecondary,
                              marginTop: '0.25rem',
                              fontWeight: 500,
                            }}
                          >
                            {agent.agentCategory}
                          </div>
                        )}
                        {ensLink && !isEnsName && (
                          <a
                            data-agent-card-link
                            onClick={(event) => event.stopPropagation()}
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
                        )}
                      </>
                    );
                  })()}
                </div>
                {(() => {
                  const descRaw =
                    typeof agent.description === 'string' && agent.description.trim().length > 0
                      ? agent.description.trim()
                      : 'No description provided.';
                  return (
                    <p
                      style={{
                        margin: 0,
                        color: palette.textSecondary,
                        fontSize: '0.85rem',
                        lineHeight: 1.35,
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      title={descRaw}
                    >
                      {descRaw}
                    </p>
                  );
                })()}
                <div
                  style={{
                    marginTop: '0.75rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.3rem',
                      alignItems: 'flex-start',
                      minWidth: 0,
                    }}
                  >
                    {ownerDisplay && (
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: palette.textSecondary,
                          maxWidth: '100%',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={agent.agentAccount || undefined}
                      >
                        <strong style={{ fontWeight: 600 }}>Owner:</strong>{' '}
                        <span>{ownerDisplay}</span>
                      </div>
                    )}
                    {/* Endpoint URLs are available via the action buttons (A2A/MCP) and agent details. */}
                    {/* Agent account address link removed per design; still available in data if needed */}
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
                    {/* Feedback button removed; feedback is now accessed via the reviews link in the stats row */}
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
                        cursor: (agent as any).rawJson ? 'pointer' : 'not-allowed',
                        opacity: (agent as any).rawJson ? 1 : 0.5,
                        color: palette.textPrimary,
                      }}
                      disabled={!(agent as any).rawJson}
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
                <div
                  style={{
                    marginTop: '0.75rem',
                    paddingTop: '0.6rem',
                    borderTop: `1px solid ${palette.border}`,
                    width: '100%',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.8rem',
                    color: palette.textSecondary,
                  }}
                >
                  <span>
                    {secondsAgo === null
                      ? 'Age N/A'
                      : daysAgo && daysAgo > 0
                        ? `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`
                        : hoursAgo && hoursAgo > 0
                          ? `${hoursAgo} hour${hoursAgo === 1 ? '' : 's'} ago`
                          : minutesAgo && minutesAgo > 0
                            ? `${minutesAgo} minute${minutesAgo === 1 ? '' : 's'} ago`
                            : `${secondsAgo} second${secondsAgo === 1 ? '' : 's'} ago`}
                  </span>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.75rem',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    {reviewsCount > 0 && (
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation();
                          openActionDialog(agent, 'feedback');
                        }}
                        style={{
                          padding: 0,
                          border: 'none',
                          background: 'none',
                          color: palette.accent,
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        reviews ({reviewsCount.toLocaleString()})
                      </button>
                    )}
                    {(validationsCount > 0 || validationsPendingCount > 0) && (
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation();
                          openActionDialog(agent, 'validations' as any);
                        }}
                        style={{
                          padding: 0,
                          border: 'none',
                          background: 'none',
                          color: palette.accent,
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                        title={`Completed: ${validationsCount}, Pending: ${validationsPendingCount}`}
                      >
                        validations ({validationsCount} / {validationsPendingCount})
                      </button>
                    )}
                    {totalAssociationsForDisplay > 0 && (
                      <span
                        title={`Discovery (GraphQL) counts — initiated: ${initiatedAssociationsCount ?? '—'}, approved: ${approvedAssociationsCount ?? '—'}`}
                      >
                        associations ({initiatedAssociationsCount ?? 0} / {approvedAssociationsCount ?? 0})
                      </span>
                    )}
                    {trustLedgerScore !== null && trustLedgerOverallRank !== null && (
                      <span
                        title={`Agent Index · score: ${Math.round(trustLedgerScore)} · rank: #${trustLedgerOverallRank}${trustLedgerBadgeCount !== null ? ` · badges: ${trustLedgerBadgeCount}` : ''}`}
                      >
                        score {Math.round(trustLedgerScore)} · rank #{trustLedgerOverallRank}
                      </span>
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

          </div>

          {!isMobile && !hideLeaderboard && (
            <aside
              style={{
                width: 340,
                flex: '0 0 340px',
                borderRadius: '16px',
                border: `1px solid ${palette.border}`,
                backgroundColor: palette.surface,
                padding: '1.25rem',
                position: 'sticky',
                top: '1rem',
                boxShadow: '0 4px 12px rgba(15,23,42,0.06)',
                alignSelf: 'flex-start',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: palette.textPrimary }}>
                    Agent Index
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: palette.textSecondary }}>Top by rank</span>
                </div>

                {/* compact filters (match "VIEW: All Time / All Mountains" style) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em', color: palette.textSecondary }}>
                    VIEW:
                  </span>
                  <select
                    value={atiLeaderboardTimeWindow}
                    onChange={(e) => setAtiLeaderboardTimeWindow(e.target.value as any)}
                    aria-label="ATI leaderboard time window"
                    style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '8px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.75rem',
                      height: 28,
                    }}
                  >
                    <option value="all">All Time</option>
                    <option value="10d">Past 10 days</option>
                    <option value="30d">Past Month</option>
                    <option value="180d">Past 6 months</option>
                  </select>

                  <select
                    value={atiLeaderboardChainId}
                    onChange={(e) => setAtiLeaderboardChainId(e.target.value)}
                    aria-label="ATI leaderboard chain filter"
                    style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '8px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.75rem',
                      height: 28,
                    }}
                  >
                    <option value="all">All Chains</option>
                    {chainOptions.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={atiLeaderboardCategory}
                    onChange={(e) => setAtiLeaderboardCategory(e.target.value)}
                    aria-label="ATI leaderboard agent category"
                    style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '8px',
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      color: palette.textPrimary,
                      fontSize: '0.75rem',
                      height: 28,
                      minWidth: 160,
                      flex: '1 1 160px',
                    }}
                  >
                    {/* same category list as registration */}
                    {AGENT_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.value === '' ? 'All categories' : opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {atiLeaderboardLoading && (
                  <div style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Loading…</div>
                )}
                {atiLeaderboardError && (
                  <div style={{ fontSize: '0.85rem', color: '#b91c1c' }}>{atiLeaderboardError}</div>
                )}

                {!atiLeaderboardLoading && !atiLeaderboardError && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {atiLeaderboard.length === 0 ? (
                      <div style={{ fontSize: '0.85rem', color: palette.textSecondary }}>
                        No ranked agents found.
                      </div>
                    ) : (
                      atiLeaderboard.map((row, idx) => (
                        <button
                          key={String((row as any).uaid ?? `${row.chainId}:${row.agentId}`)}
                          type="button"
                          onClick={() => {
                            const uaid = String((row as any).uaid ?? '').trim();
                            if (!uaid) return;
                            router.push(`/agents/${encodeURIComponent(uaid)}`);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            padding: '0.65rem 0.75rem',
                            borderRadius: '12px',
                            border: `1px solid ${palette.border}`,
                            background: palette.surfaceMuted,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                            <div
                              style={{
                                width: 26,
                                height: 26,
                                borderRadius: 999,
                                backgroundColor: '#0f172a',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                flex: '0 0 auto',
                              }}
                            >
                              {idx + 1}
                            </div>
                            <img
                              src={row.image && row.image.trim() ? row.image.trim() : shadowAgentSrc}
                              alt={row.agentName}
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 999,
                                objectFit: 'cover',
                                border: `1px solid ${palette.border}`,
                                flex: '0 0 auto',
                                backgroundColor: palette.surface,
                              }}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                if (!target.src.includes(shadowAgentSrc)) {
                                  target.src = shadowAgentSrc;
                                }
                              }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: '0.85rem',
                                  fontWeight: 700,
                                  color: palette.textPrimary,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: 220,
                                }}
                                title={row.agentName}
                              >
                                #{row.trustLedgerOverallRank} {row.agentName}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: palette.textSecondary }}>
                                #{row.agentId}
                              </div>
                            </div>
                          </div>
                          <div
                            title={`Agent Index score${typeof row.trustLedgerBadgeCount === 'number' ? ` · badges: ${row.trustLedgerBadgeCount}` : ''}`}
                            style={{ fontSize: '0.9rem', fontWeight: 800, color: palette.accent }}
                          >
                            {Math.round(row.trustLedgerScore)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </aside>
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
    const payloadTrimmed = payload.trim();

    // Some tokenUris are incorrectly marked as base64 but contain plain JSON.
    if (payloadTrimmed.startsWith('{') || payloadTrimmed.startsWith('[')) {
      return formatJsonIfPossible(payloadTrimmed);
    }

    if (isBase64) {
      try {
        // Support base64url and missing padding
        let normalized = payloadTrimmed.replace(/-/g, '+').replace(/_/g, '/');
        while (normalized.length % 4 !== 0) normalized += '=';

        const decoded =
          typeof window !== 'undefined' && typeof window.atob === 'function'
            ? window.atob(normalized)
            : payloadTrimmed;
        return formatJsonIfPossible(decoded);
      } catch (error) {
        // Fall through to percent-decoding / raw parsing before giving up.
      }
    }
    try {
      const decoded = decodeURIComponent(payloadTrimmed);
      return formatJsonIfPossible(decoded);
    } catch {
      return formatJsonIfPossible(payloadTrimmed);
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

function deriveA2ADiscoveryUrls(endpoint: string): {
  messageEndpointUrl: string | null;
  agentCardUrl: string | null;
} {
  if (!endpoint || typeof endpoint !== 'string') {
    return { messageEndpointUrl: null, agentCardUrl: null };
  }
  try {
    const url = new URL(endpoint);
    const origin = url.origin;
    const path = url.pathname || '';

    const agentCardUrl = `${origin}/.well-known/agent-card.json`; // canonical v1.0 agent card

    // `a2aEndpoint` is expected to point to the agent card (agent-card.json).
    // Keep it verbatim if it already looks like an agent-card.json URL.
    const looksLikeAgentCard =
      /\/agent-card\.json\/?$/i.test(path) ||
      path.endsWith('/.well-known/agent-card.json') ||
      path.endsWith('/.well-known/agent-card.json/');
    const explicitAgentCardUrl = looksLikeAgentCard ? url.toString() : agentCardUrl;

    // Back-compat: if we are given a historical message endpoint like /api/a2a,
    // expose it as messageEndpointUrl and still derive agent-card.json from origin.
    const looksLikeMessageEndpoint = /\/api\/a2a\/?$/i.test(path);
    return {
      // For UI, we want a stable link. Prefer the agent card URL if present.
      messageEndpointUrl: looksLikeAgentCard ? url.toString() : looksLikeMessageEndpoint ? url.toString() : null,
      agentCardUrl: explicitAgentCardUrl,
    };
  } catch {
    return { messageEndpointUrl: null, agentCardUrl: null };
  }
}


