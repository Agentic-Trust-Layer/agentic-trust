'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Container, TextField, Button, Typography } from '@mui/material';
import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import {
  getSupportedChainIds,
  getChainDisplayMetadata,
  getChainRpcUrl,
  buildDid8004,
} from '@agentic-trust/core';

import { Header } from '@/components/Header';
import {
  AgentsPage,
  type AgentsPageAgent,
} from '@/components/AgentsPage';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';

type Agent = AgentsPageAgent;

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

type SemanticMatch = {
  score?: number | null;
  matchReasons?: unknown[] | null;
  agent?: {
    chainId?: number | null;
    agentId?: string | number | null;
    agentName?: string | null;
    agentAccount?: string | null;
    agentIdentityOwnerAccount?: string | null;
    eoaAgentIdentityOwnerAccount?: string | null;
    eoaAgentAccount?: string | null;
    agentUri?: string | null;
    description?: string | null;
    image?: string | null;
    contractAddress?: string | null;
    a2aEndpoint?: string | null;
    mcpEndpoint?: string | null;
    did?: string | null;
    supportedTrust?: string | null;
    createdAtTime?: number | string | null;
    feedbackCount?: number | null;
    feedbackAverageScore?: number | null;
    validationPendingCount?: number | null;
    validationCompletedCount?: number | null;
    validationRequestedCount?: number | null;
    metadata?: Array<{ key?: string | null; valueText?: string | null }> | null;
  } | null;
};

type SemanticSearchResponse = {
  success?: boolean;
  total?: number;
  matches?: SemanticMatch[];
};

export default function AgentDiscoveryRoute() {
  const {
    isConnected,
    privateKeyMode,
    loading,
    walletAddress,
    openLoginModal,
    handleDisconnect,
  } = useAuth();
  const { eip1193Provider } = useWallet();

  const [query, setQuery] = useState('');
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownedMap, setOwnedMap] = useState<Record<string, boolean>>({});
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

  const pageAgents = useMemo(() => {
    if (!allAgents.length) return [];
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const sliced = allAgents.slice(start, end);
    console.log('[AgentDiscovery] pageAgents computed:', {
      allAgentsCount: allAgents.length,
      currentPage,
      start,
      end,
      slicedCount: sliced.length,
      slicedAgentNames: sliced.map((a) => ({
        agentId: a.agentId,
        agentName: a.agentName,
      })),
    });
    return sliced;
  }, [allAgents, currentPage]);

  const searchAgents = useCallback(
    async (overrideText?: string) => {
      try {
        setLoadingAgents(true);
        setError(null);

        const effectiveText =
          typeof overrideText === 'string' ? overrideText : query;
        const text = (effectiveText ?? '').trim();

        if (!text) {
          setAllAgents([]);
          setTotal(0);
          setTotalPages(0);
          setCurrentPage(1);
          return;
        }

        const response = await fetch('/api/agents/semantic-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || errorData.error || 'Failed to run semantic search',
          );
        }

        const data = (await response.json()) as SemanticSearchResponse;
        const matches = Array.isArray(data.matches) ? data.matches : [];

        console.log('[AgentDiscovery] Raw API response:', {
          total: data.total,
          matchesCount: matches.length,
          firstMatchSample: matches[0]
            ? {
                score: matches[0].score,
                agentId: matches[0].agent?.agentId,
                agentName: matches[0].agent?.agentName,
                agentNameType: typeof matches[0].agent?.agentName,
                metadata: matches[0].agent?.metadata,
              }
            : null,
        });

        const nextAgents: Agent[] = [];

        for (let i = 0; i < matches.length; i++) {
          const match = matches[i];
          if (!match || !match.agent) {
            console.log(`[AgentDiscovery] Match ${i}: Skipping - no match or agent`);
            continue;
          }
          const agent = match.agent;

          console.log(`[AgentDiscovery] Processing match ${i}:`, {
            agentId: agent.agentId,
            rawAgentName: agent.agentName,
            rawAgentNameType: typeof agent.agentName,
            rawAgentNameValue: JSON.stringify(agent.agentName),
            metadata: agent.metadata,
            metadataLength: Array.isArray(agent.metadata) ? agent.metadata.length : 0,
          });

          const chainId =
            typeof agent.chainId === 'number' && Number.isFinite(agent.chainId)
              ? agent.chainId
              : 0;

          const rawAgentId = agent.agentId;
          const agentId =
            typeof rawAgentId === 'string'
              ? rawAgentId.trim()
              : rawAgentId !== undefined && rawAgentId !== null
                ? String(rawAgentId)
                : '';

          const createdAt =
            typeof agent.createdAtTime === 'number'
              ? agent.createdAtTime
              : typeof agent.createdAtTime === 'string'
                ? Number(agent.createdAtTime)
                : null;

          // Extract agentName: prefer direct field, then metadata, then fallback
          let agentName: string = 'Unnamed Agent';
          
          // Handle direct agentName field - must be non-empty after trim
          const rawAgentName = agent.agentName;
          const directName =
            typeof rawAgentName === 'string' && rawAgentName.trim().length > 0
              ? rawAgentName.trim()
              : null;
          
          console.log(`[AgentDiscovery] Match ${i} agentName extraction:`, {
            rawAgentName,
            rawAgentNameType: typeof rawAgentName,
            rawAgentNameValue: JSON.stringify(rawAgentName),
            directName,
            directNameLength: directName ? directName.length : 0,
            hasMetadata: Array.isArray(agent.metadata),
            metadataLength: Array.isArray(agent.metadata) ? agent.metadata.length : 0,
          });

          if (directName) {
            agentName = directName;
            console.log(`[AgentDiscovery] Match ${i}: Using directName: "${agentName}"`);
          } else {
            // Try metadata if direct field is empty/null/undefined
            if (Array.isArray(agent.metadata) && agent.metadata.length > 0) {
              const nameEntry = agent.metadata.find(
                (entry) =>
                  entry &&
                  typeof entry.key === 'string' &&
                  entry.key === 'agentName' &&
                  typeof entry.valueText === 'string' &&
                  entry.valueText.trim().length > 0,
              );
              if (nameEntry && typeof nameEntry.valueText === 'string') {
                const trimmed = nameEntry.valueText.trim();
                if (trimmed) {
                  agentName = trimmed;
                  console.log(`[AgentDiscovery] Match ${i}: Using metadata agentName: "${agentName}"`);
                } else {
                  console.log(`[AgentDiscovery] Match ${i}: Metadata agentName found but empty after trim`);
                }
              } else {
                console.log(`[AgentDiscovery] Match ${i}: No valid agentName in metadata`, {
                  nameEntry,
                  metadataKeys: agent.metadata.map((e) => e?.key).filter(Boolean),
                  metadataEntries: agent.metadata,
                });
              }
            } else {
              console.log(`[AgentDiscovery] Match ${i}: No directName and no metadata array, using fallback "Unnamed Agent"`);
            }
          }
          
          // Final safety check - ensure we never have an empty string
          if (!agentName || agentName.trim().length === 0) {
            agentName = 'Unnamed Agent';
            console.log(`[AgentDiscovery] Match ${i}: Final safety check - agentName was empty, using fallback`);
          }

          const normalized: Agent = {
            agentId,
            chainId,
            agentName,
            agentAccount: agent.agentAccount ?? null,
            agentCategory: null,
            agentIdentityOwnerAccount: agent.agentIdentityOwnerAccount ?? null,
            eoaAgentIdentityOwnerAccount: agent.eoaAgentIdentityOwnerAccount ?? null,
            eoaAgentAccount: agent.eoaAgentAccount ?? null,
            agentUri: agent.agentUri ?? null,
            description: agent.description ?? null,
            image: agent.image ?? null,
            contractAddress: agent.contractAddress ?? null,
            a2aEndpoint: agent.a2aEndpoint ?? null,
            mcpEndpoint: agent.mcpEndpoint ?? null,
            did: agent.did ?? null,
            supportedTrust: agent.supportedTrust ?? null,
            createdAtTime:
              createdAt !== null && Number.isFinite(createdAt) ? createdAt : null,
            feedbackCount: agent.feedbackCount ?? null,
            feedbackAverageScore: agent.feedbackAverageScore ?? null,
            validationPendingCount: agent.validationPendingCount ?? null,
            validationCompletedCount: agent.validationCompletedCount ?? null,
            validationRequestedCount: agent.validationRequestedCount ?? null,
          };

          console.log(`[AgentDiscovery] Match ${i} normalized agent:`, {
            agentId: normalized.agentId,
            agentName: normalized.agentName ?? 'Unnamed Agent',
            agentNameLength:
              typeof normalized.agentName === 'string' && normalized.agentName
                ? normalized.agentName.length
                : 0,
          });

          nextAgents.push(normalized);
        }

        console.log('[AgentDiscovery] Final agents array:', {
          count: nextAgents.length,
          agentNames: nextAgents.map((a) => ({
            agentId: a.agentId,
            agentName: a.agentName,
          })),
        });

        setAllAgents(nextAgents);
        console.log('[AgentDiscovery] setAllAgents called with:', {
          count: nextAgents.length,
          firstAgent: nextAgents[0]
            ? {
                agentId: nextAgents[0].agentId,
                agentName: nextAgents[0].agentName,
              }
            : null,
        });

        const totalCount = nextAgents.length;
        setTotal(totalCount);
        const totalPageCount =
          totalCount > 0 ? Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) : 0;
        setTotalPages(totalPageCount);
        setCurrentPage(1);
      } catch (err) {
        console.error('Failed to run semantic agent search:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to run semantic agent search',
        );
      } finally {
        setLoadingAgents(false);
      }
    },
    [query],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void searchAgents(query);
    },
    [query, searchAgents],
  );

  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(newPage);
  }, []);

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
      if (!isConnected || !walletAddress || pageAgents.length === 0 || !eip1193Provider) {
        if (!cancelled) {
          setOwnedMap({});
        }
        return;
      }

      const lowerWallet = walletAddress.toLowerCase();
      const entries: Record<string, boolean> = {};

      for (const agent of pageAgents) {
        const ownershipKey = `${agent.chainId}:${agent.agentId}`;
        const account =
          typeof agent.agentAccount === 'string' ? agent.agentAccount : null;
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
  }, [pageAgents, isConnected, walletAddress, eip1193Provider]);

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Header
        displayAddress={walletAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={loading}
      />
      <Container
        maxWidth="lg"
        sx={{
          py: { xs: 0.625, md: 6 },
          px: { xs: 0.625, md: 2 },
        }}
      >
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            mb: 3,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 1.5,
            alignItems: { xs: 'stretch', sm: 'center' },
          }}
        >
          <TextField
            label="Search agents"
            placeholder="Describe the agents you're looking for..."
            size="small"
            fullWidth
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={loadingAgents}
            sx={{
              minWidth: { xs: '100%', sm: 140 },
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            {loadingAgents ? 'Searching…' : 'Search'}
          </Button>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            This is a semantic search that uses advanced natural language processing to vectorize your query and the agent data, then finds the closest matches.
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 4 }}>
            {error}
          </Alert>
        )}

        {(() => {
          console.log('[AgentDiscovery] Rendering AgentsPage with pageAgents:', {
            count: pageAgents.length,
            agentNames: pageAgents.map((a) => ({
              agentId: a.agentId,
              agentName: a.agentName,
              agentNameType: typeof a.agentName,
              agentNameLength: typeof a.agentName === 'string' ? a.agentName.length : 0,
            })),
          });
          return null;
        })()}

        <AgentsPage
          agents={pageAgents}
          loading={loadingAgents}
          hideFilters
          hideLeaderboard
          filters={{
            chainId: 'all',
            address: '',
            name: '',
            agentIdentifierMatch: '',
            scope: 'allAgents',
            protocol: 'all',
            path: '',
            minReviews: '',
            minValidations: '',
            minAssociations: '',
            minAtiOverallScore: '',
            minAvgRating: '',
            createdWithinDays: '',
          }}
          onSearch={() => {}}
          // Filters are hidden on this page; no-ops keep the API surface satisfied.
          onFilterChange={() => {}}
          onClear={() => {}}
          chainOptions={chainOptions}
          ownedMap={ownedMap}
          total={total}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      </Container>
    </Box>
  );
}

