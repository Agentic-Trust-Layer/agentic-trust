'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { useRouter } from 'next/navigation';
import type { DiscoverParams, DiscoverResponse } from '@agentic-trust/core/server';
import {
  getSupportedChainIds,
  getChainDisplayMetadata,
} from '@agentic-trust/core/server';
import { getChainRpcUrl } from '@agentic-trust/core';

import { Header } from '@/components/Header';
import { AgentsPage, type AgentsPageFilters } from '@/components/AgentsPage';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';

type Agent = DiscoverResponse['agents'][number] & {
  contractAddress?: string | null;
};

const DEFAULT_FILTERS: AgentsPageFilters = {
  chainId: 'all',
  address: '',
  name: '',
  agentId: '',
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
  const clientCache = useRef<Record<number, PublicClient>>({});

  const supportedChainIds = getSupportedChainIds();
  const chainOptions = useMemo(
    () =>
      supportedChainIds.map(chainId => {
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
    if (source.address.trim()) {
      params.agentAccount = source.address.trim() as Address;
    }
    if (source.name.trim()) {
      params.agentName = source.name.trim();
    }
    if (source.agentId.trim()) {
      params.agentId = source.agentId.trim();
    }
    return params;
  }, []);

  const searchAgents = useCallback(
    async (sourceFilters: AgentsPageFilters) => {
      try {
        setLoadingAgents(true);
        setError(null);
        const params = buildParams(sourceFilters);
        const payload = {
          page: 1,
          pageSize: PAGE_SIZE,
          orderBy: 'agentName',
          orderDirection: 'ASC' as const,
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
    <>
      <Header
        displayAddress={displayAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={loading}
      />
      <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
        {error && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '1rem',
              backgroundColor: '#ffebee',
              borderRadius: '8px',
              border: '1px solid #f44336',
              color: '#c62828',
            }}
          >
            {error}
          </div>
        )}

        <AgentsPage
          agents={agents}
          filters={filters}
          chainOptions={chainOptions}
          loading={loadingAgents}
          ownedMap={ownedMap}
          onFilterChange={(key, value) => {
            setFilters(prev => ({ ...prev, [key]: value }));
          }}
          onSearch={() => searchAgents(filters)}
          onClear={() => {
            setFilters(DEFAULT_FILTERS);
            searchAgents(DEFAULT_FILTERS);
          }}
          onEditAgent={handleEditAgent}
        />
      </main>
    </>
  );
}

