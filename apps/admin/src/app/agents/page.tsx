'use client';

// Avoid static prerendering for this route to speed up `next build` page-data collection.
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Container } from '@mui/material';
import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { useRouter } from 'next/navigation';
import { getSupportedChainIds, getChainDisplayMetadata, getChainRpcUrl, buildDid8004 } from '@agentic-trust/core';

import { Header } from '@/components/Header';
import {
  AgentsPage,
  type AgentsPageAgent,
  type AgentsPageFilters,
} from '@/components/AgentsPage';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { useAgentsContext } from '@/context/AgentsContext';

type Agent = AgentsPageAgent;

type DiscoverParams = {
  chains?: number[];
  agentAccount?: Address;
  agentName?: string;
  agentIdentifierMatch?: string;
  a2a?: boolean;
  mcp?: boolean;
  minFeedbackCount?: number;
  minValidationCompletedCount?: number;
  minAssociations?: number;
  minFeedbackAverageScore?: number;
  minAtiOverallScore?: number;
  createdWithinDays?: number;
};

const PAGE_SIZE = 18;

const DEFAULT_FILTERS: AgentsPageFilters = {
  // Default Agents page to Honor roll. Honor roll requires a concrete chain id.
  chainId: '1',
  address: '',
  name: '',
  agentIdentifierMatch: '',
  scope: 'honorRoll',
  protocol: 'all',
  path: '',
  minReviews: '',
  minValidations: '',
  minAssociations: '',
  minAtiOverallScore: '',
  minAvgRating: '',
  createdWithinDays: '',
};

const OWNER_ABI = [
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

const GET_OWNER_ABI = [
  {
    name: 'getOwner',
    type: 'function',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

const OWNERS_ABI = [
  {
    name: 'owners',
    type: 'function',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const;

export default function AgentsRoute() {
  const auth = useAuth();
  const {
    connected: walletConnected,
    address: walletAddress,
    eip1193Provider,
    privateKeyMode,
    loading,
  } = useWallet();
  const router = useRouter();

  const {
    agents,
    setAgents,
    filters,
    setFilters,
    total,
    setTotal,
    totalPages,
    setTotalPages,
    currentPage,
    setCurrentPage,
    loading: loadingAgents,
    setLoading: setLoadingAgents,
    hasLoaded,
    setHasLoaded,
  } = useAgentsContext();

  const [error, setError] = useState<string | null>(null);
  const [ownedMap, setOwnedMap] = useState<Record<string, boolean>>({});
  const clientCache = useRef<Record<number, PublicClient>>({});

  const supportedChainIds = getSupportedChainIds();
  const chainOptions = useMemo(
    () =>
      Array.from(new Set([...supportedChainIds, 295])).map((chainId: number) => {
        if (chainId === 295) {
          return { id: chainId, label: 'Hashgraph Online' };
        }
        const metadata = getChainDisplayMetadata(chainId);
        const label = metadata?.displayName || metadata?.chainName || `Chain ${chainId}`;
        return { id: chainId, label };
      }),
    [supportedChainIds],
  );

  const buildParams = useCallback((source: AgentsPageFilters): DiscoverParams => {
    const params: DiscoverParams = {};
    if (source?.chainId && source.chainId !== 'all') {
      const parsed = Number(source.chainId);
      if (!Number.isNaN(parsed)) {
        params.chains = [parsed];
      }
    }
    const addressQuery = (source?.address || '').trim();
    if (addressQuery && /^0x[a-fA-F0-9]{40}$/.test(addressQuery)) {
      params.agentAccount = addressQuery as Address;
    }
    if ((source?.name || '').trim()) {
      params.agentName = (source.name || '').trim();
    }
    if ((source?.agentIdentifierMatch || '').trim()) {
      params.agentIdentifierMatch = (source.agentIdentifierMatch || '').trim();
    }
    if (source?.protocol === 'a2a') {
      params.a2a = true;
    } else if (source?.protocol === 'mcp') {
      params.mcp = true;
    }

    const minReviews = Number.parseInt((source?.minReviews || '').trim(), 10);
    if (Number.isFinite(minReviews) && minReviews > 0) {
      params.minFeedbackCount = minReviews;
    }

    const minValidations = Number.parseInt((source?.minValidations || '').trim(), 10);
    if (Number.isFinite(minValidations) && minValidations > 0) {
      params.minValidationCompletedCount = minValidations;
    }

    const minAssociations = Number.parseInt((source?.minAssociations || '').trim(), 10);
    if (Number.isFinite(minAssociations) && minAssociations > 0) {
      params.minAssociations = minAssociations;
    }

    const minAvgRating = Number.parseFloat((source?.minAvgRating || '').trim());
    if (Number.isFinite(minAvgRating) && minAvgRating > 0) {
      params.minFeedbackAverageScore = minAvgRating;
    }

    const minAtiOverallScore = Number.parseInt((source?.minAtiOverallScore || '').trim(), 10);
    if (Number.isFinite(minAtiOverallScore) && minAtiOverallScore > 0) {
      params.minAtiOverallScore = minAtiOverallScore;
    }

    const createdWithinDays = Number.parseInt((source?.createdWithinDays || '').trim(), 10);
    if (Number.isFinite(createdWithinDays) && createdWithinDays > 0) {
      params.createdWithinDays = createdWithinDays;
    }

    return params;
  }, []);

  const searchAgents = useCallback(
    async (sourceFilters: AgentsPageFilters, page: number = 1) => {
      try {
        setLoadingAgents(true);
        setError(null);
        // Ensure sourceFilters is never undefined
        const safeFilters = sourceFilters || filters || DEFAULT_FILTERS;

        const payload = {
          scope: safeFilters.scope,
          page,
          pageSize: PAGE_SIZE,
          walletAddress: walletConnected && walletAddress ? walletAddress : undefined,
          filters: safeFilters,
        };

        const response = await fetch('/api/agents/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || errorData.error || `Failed to fetch agents (${response.status})`);
        }

        const data = await response.json();
        if (process.env.NODE_ENV === 'development') {
          const list = Array.isArray((data as any)?.agents) ? ((data as any).agents as any[]) : [];
          // eslint-disable-next-line no-console
          console.log('[Admin][AgentsRoute] /api/agents/list response:', {
            agentsLength: list.length,
            total: (data as any)?.total,
            sampleUaid: list.slice(0, 5).map((a) => a?.uaid).filter(Boolean),
          });
        }
        if (safeFilters.scope === 'myAgents') {
          const ownedEntries: Record<string, boolean> = {};
          const list = Array.isArray((data as any)?.agents) ? ((data as any).agents as Agent[]) : [];
          for (const agent of list) {
            const uaid = typeof (agent as any)?.uaid === 'string' ? String((agent as any).uaid).trim() : '';
            if (!uaid || !uaid.startsWith('uaid:')) continue;
            ownedEntries[uaid] = true;
          }
          setOwnedMap(ownedEntries);
        } else {
          setOwnedMap({});
        }
        setAgents((data.agents as Agent[]) ?? []);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setCurrentPage(data.page ?? page);
        setHasLoaded(true);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      } finally {
        setLoadingAgents(false);
      }
    },
    [filters, setAgents, setTotal, setTotalPages, setCurrentPage, setLoadingAgents, setHasLoaded, walletConnected, walletAddress],
  );

  // Initial load: only if we haven't loaded yet or if explicitly refreshing.
  // But careful: filters might have changed.
  // For now, we load if (!hasLoaded).
  useEffect(() => {
    if (!hasLoaded) {
      searchAgents(filters, currentPage);
    }
  }, [hasLoaded, searchAgents, filters, currentPage]);

  // When user manually changes filters or page in AgentsPage, we call searchAgents.
  // We need to update the context state when that happens.
  const handleSearch = useCallback((filtersOverride?: AgentsPageFilters) => {
    const filtersToUse = filtersOverride ?? filters;
    if (filtersOverride) {
      setFilters(filtersToUse);
    }
    setCurrentPage(1); // Reset to page 1 on new filter
    searchAgents(filtersToUse, 1);
  }, [filters, setFilters, setCurrentPage, searchAgents]);

  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(newPage);
    searchAgents(filters, newPage);
  }, [filters, setCurrentPage, searchAgents]);

  const handleFilterChange = useCallback(<K extends keyof AgentsPageFilters>(
    key: K,
    value: AgentsPageFilters[K],
  ) => {
    setFilters({ ...filters, [key]: value });
  }, [filters, setFilters]);

  const handleClear = useCallback(() => {
    const next: AgentsPageFilters = {
      ...filters,
      address: '',
      name: '',
      agentIdentifierMatch: '',
      protocol: 'all',
      path: '',
      minReviews: '',
      minValidations: '',
      minAssociations: '',
      minAvgRating: '',
      minAtiOverallScore: '',
      createdWithinDays: '',
    };
    setFilters(next);
    setCurrentPage(1);
    searchAgents(next, 1);
  }, [filters, setFilters, setCurrentPage, searchAgents]);

  useEffect(() => {
    let cancelled = false;

    const parseUaidDid8004Parts = (uaid: string): { chainId: number; agentId: string } | null => {
      const raw = String(uaid || '').trim();
      if (!raw.startsWith('uaid:did:8004:')) return null;
      const did = raw.slice('uaid:'.length);
      const m = /^did:8004:(\d+):(\d+)$/.exec(did);
      if (!m) return null;
      const chainId = Number(m[1]);
      const agentId = m[2];
      if (!Number.isFinite(chainId) || !agentId) return null;
      return { chainId, agentId };
    };

    async function getClient(chainId: number): Promise<PublicClient> {
      if (!clientCache.current[chainId]) {
        const rpcUrl = getChainRpcUrl(chainId);
        if (!rpcUrl) return null as unknown as PublicClient;
        clientCache.current[chainId] = createPublicClient({
          transport: http(rpcUrl),
        });
      }
      return clientCache.current[chainId];
    }

    async function computeOwnership() {
      // If "my agents" is enabled, we treat the list as already owned and keep
      // the ownedMap set by the owned-agents fetch.
      if (filters.scope === 'myAgents') {
        return;
      }

      if (!walletConnected || !walletAddress || agents.length === 0 || !eip1193Provider) {
        // Don't clobber an existing ownedMap in cases where we can't compute ownership.
        // (e.g. no EIP-1193 provider available)
        return;
      }

      const lowerWallet = walletAddress.toLowerCase();
      const entries: Record<string, boolean> = {};

      for (const agent of agents) {
        const uaid = typeof (agent as any)?.uaid === 'string' ? String((agent as any).uaid).trim() : '';
        if (!uaid || !uaid.startsWith('uaid:')) {
          continue;
        }
        const ownershipKey = uaid;
        const did8004Parts = parseUaidDid8004Parts(uaid);
        if (!did8004Parts) {
          // Non-EVM UAIDs: ownership via EVM RPC doesn't apply.
          entries[ownershipKey] = false;
          continue;
        }
        const account = typeof agent.agentAccount === 'string' ? agent.agentAccount : null;
        if (!account || !account.startsWith('0x')) {
          entries[ownershipKey] = false;
          continue;
        }

        try {
          const client = await getClient(did8004Parts.chainId);
          if (!client) {
            // Non-EVM chain or missing RPC; skip ownership computation.
            entries[ownershipKey] = false;
            continue;
          }
          const code = await client.getBytecode({ address: account as Address });

          if (!code || code === '0x') {
            entries[ownershipKey] = account.toLowerCase() === lowerWallet;
            continue;
          }

          let controller: string | null = null;

          try {
            controller = (await client.readContract({
              address: account as Address,
              abi: OWNER_ABI,
              functionName: 'owner',
            })) as `0x${string}`;
          } catch {
            // ignore
          }

          if (!controller) {
            try {
              controller = (await client.readContract({
                address: account as Address,
                abi: GET_OWNER_ABI,
                functionName: 'getOwner',
              })) as `0x${string}`;
            } catch {
              // ignore
            }
          }

          if (!controller) {
            try {
              const owners = (await client.readContract({
                address: account as Address,
                abi: OWNERS_ABI,
                functionName: 'owners',
              })) as `0x${string}`[];
              controller = owners?.[0] ?? null;
            } catch {
              // ignore
            }
          }

          entries[ownershipKey] = Boolean(controller && controller.toLowerCase() === lowerWallet);
        } catch (ownershipError) {
          console.debug('Ownership detection failed', ownershipError);
          entries[ownershipKey] = false;
        }
      }

      if (!cancelled) {
        setOwnedMap(entries);
      }
    }

    computeOwnership();

    return () => {
      cancelled = true;
    };
  }, [agents, walletConnected, walletAddress, eip1193Provider, filters.scope]);

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Header
        displayAddress={walletAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={walletConnected}
        onConnect={auth.openLoginModal}
        onDisconnect={auth.handleDisconnect}
        disableConnect={loading || auth.loading}
      />
      <Container
        maxWidth={false}
        disableGutters
        sx={{
          py: { xs: 0.625, md: 4 },
          px: { xs: 0.625, md: 4 },
          width: '100%',
        }}
      >
        {error && (
          <Alert severity="error" sx={{ mb: 4 }}>
            {error}
          </Alert>
        )}

        <AgentsPage
          agents={agents}
          loading={loadingAgents}
          filters={filters}
          onSearch={handleSearch}
          onFilterChange={handleFilterChange}
          onClear={handleClear}
          chainOptions={chainOptions}
          ownedMap={ownedMap}
          isConnected={walletConnected}
          walletAddress={walletAddress}
          provider={eip1193Provider}
          total={total}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      </Container>
    </Box>
  );
}
