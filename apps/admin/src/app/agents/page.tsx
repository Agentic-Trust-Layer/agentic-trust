'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Container } from '@mui/material';
import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { useRouter } from 'next/navigation';
import { getSupportedChainIds, getChainDisplayMetadata, getChainRpcUrl } from '@agentic-trust/core';

import { Header } from '@/components/Header';
import {
  AgentsPage,
  type AgentsPageAgent,
  type AgentsPageFilters,
} from '@/components/AgentsPage';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';

type Agent = AgentsPageAgent;

type DiscoverParams = {
  chains?: number[];
  agentAccount?: Address;
  agentName?: string;
  agentId?: string;
};

const DEFAULT_FILTERS: AgentsPageFilters = {
  chainId: 'all',
  address: '',
  name: '',
  agentId: '',
  mineOnly: false,
  protocol: 'all',
  path: '',
};

const PAGE_SIZE = 18;

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
  const {
    isConnected,
    privateKeyMode,
    loading,
    walletAddress,
    openLoginModal,
    handleDisconnect,
  } = useAuth();
  const { eip1193Provider } = useWallet();
  const router = useRouter();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [filters, setFilters] = useState<AgentsPageFilters>(DEFAULT_FILTERS);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownedMap, setOwnedMap] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined);
  const clientCache = useRef<Record<number, PublicClient>>({});

  const supportedChainIds = getSupportedChainIds();
  const chainOptions = useMemo(
    () =>
      supportedChainIds.map((chainId: number) => {
        const metadata = getChainDisplayMetadata(chainId);
        const label = metadata?.displayName || metadata?.chainName || `Chain ${chainId}`;
        return { id: chainId, label };
      }),
    [supportedChainIds],
  );

  const buildParams = useCallback((source: AgentsPageFilters): DiscoverParams => {
    const params: DiscoverParams = {};
    if (source.chainId && source.chainId !== 'all') {
      const parsed = Number(source.chainId);
      if (!Number.isNaN(parsed)) {
        params.chains = [parsed];
      }
    }
    const addressQuery = source.address.trim();
    if (addressQuery && /^0x[a-fA-F0-9]{40}$/.test(addressQuery)) {
      params.agentAccount = addressQuery as Address;
    }
    if (source.name.trim()) {
      params.agentName = source.name.trim();
    }
    if (source.agentId.trim()) {
      params.agentId = source.agentId.trim();
    }
    if (source.protocol === 'a2a') {
      params.a2a = true;
    } else if (source.protocol === 'mcp') {
      params.mcp = true;
    }
    return params;
  }, []);

  const searchAgents = useCallback(
    async (sourceFilters: AgentsPageFilters, page: number = 1) => {
      try {
        setLoadingAgents(true);
        setError(null);
        const params = buildParams(sourceFilters);
        const pathQuery =
          typeof sourceFilters.path === 'string' && sourceFilters.path.trim().length > 0
            ? sourceFilters.path.trim()
            : undefined;
        const payload = {
          page,
          pageSize: PAGE_SIZE,
          orderBy: 'agentName',
          orderDirection: 'ASC' as const,
          query: pathQuery,
          params: Object.keys(params).length > 0 ? params : undefined,
        };

        const response = await fetch('/api/agents/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || errorData.error || 'Failed to fetch agents');
        }

        const data = await response.json();
        setAgents((data.agents as Agent[]) ?? []);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setCurrentPage(data.page ?? page);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      } finally {
        setLoadingAgents(false);
      }
    },
    [buildParams],
  );

  useEffect(() => {
    searchAgents(DEFAULT_FILTERS);
  }, [searchAgents]);

  useEffect(() => {
    let cancelled = false;

    async function getClient(chainId: number): Promise<PublicClient> {
      if (!clientCache.current[chainId]) {
        const rpcUrl = getChainRpcUrl(chainId);
        if (!rpcUrl) {
          throw new Error(`Missing RPC URL for chain ${chainId}`);
        }
        clientCache.current[chainId] = createPublicClient({
          transport: http(rpcUrl),
        });
      }
      return clientCache.current[chainId];
    }

    async function computeOwnership() {
      if (!isConnected || !walletAddress || agents.length === 0 || !eip1193Provider) {
        if (!cancelled) {
          setOwnedMap({});
        }
        return;
      }

      const lowerWallet = walletAddress.toLowerCase();
      const entries: Record<string, boolean> = {};

      for (const agent of agents) {
        const ownershipKey = `${agent.chainId}:${agent.agentId}`;
        const account = typeof agent.agentAccount === 'string' ? agent.agentAccount : null;
        if (!account || !account.startsWith('0x')) {
          entries[ownershipKey] = false;
          continue;
        }

        try {
          const client = await getClient(agent.chainId);
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
  }, [agents, eip1193Provider, isConnected, walletAddress]);

  const displayAddress = walletAddress;

  const handleEditAgent = useCallback(
    (agent: Agent) => {
      const query = new URLSearchParams({
        mode: 'edit',
        agentId: agent.agentId,
        chainId: String(agent.chainId),
      });
      router.push(`/admin-tools?${query.toString()}`);
    },
    [router],
  );

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Header
        displayAddress={displayAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={loading}
      />
      <Container
        maxWidth="xl"
        sx={{
          py: { xs: 3, md: 4 },
        }}
      >
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
          >
            {error}
          </Alert>
        )}

        <AgentsPage
          agents={agents}
          filters={filters}
          chainOptions={chainOptions}
          loading={loadingAgents}
          ownedMap={ownedMap}
          isConnected={isConnected}
          provider={eip1193Provider}
          walletAddress={walletAddress}
          total={total}
          currentPage={currentPage}
          totalPages={totalPages}
          onFilterChange={(key, value) => {
            setFilters(prev => ({ ...prev, [key]: value }));
          }}
          onSearch={override => {
            setCurrentPage(1);
            searchAgents(override ?? filters, 1);
          }}
          onClear={() => {
            setFilters(DEFAULT_FILTERS);
            setCurrentPage(1);
            searchAgents(DEFAULT_FILTERS, 1);
          }}
          onEditAgent={handleEditAgent}
          onPageChange={(page) => {
            setCurrentPage(page);
            searchAgents(filters, page);
          }}
        />
      </Container>
    </Box>
  );
}

