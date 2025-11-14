import type { ReactNode } from 'react';
import type { DiscoverParams, DiscoverResponse } from '@agentic-trust/core/server';
import { discoverAgents, type DiscoverRequest, getAgenticTrustClient } from '@agentic-trust/core/server';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  Grid,
  Button,
  Link as MuiLink,
  Stack,
  Typography,
  TextField,
  Paper,
} from '@mui/material';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type NormalizedAgent = {
  id: string;
  name: string;
  account: string | null;
  owner: string | null;
  chainId: number | null;
  type: string | null;
  description: string | null;
  createdAt: string | null;
  endpoint: string | null;
  metadataUri: string | null;
  didIdentity: string | null;
  didAccount: string | null;
  didName: string | null;
};

const PAGE_SIZE = 10;

type SearchFilters = {
  name?: string;
  agentId?: string;
  account?: string;
};

type CoreAgent = DiscoverResponse['agents'][number];

async function fetchAgentsServer(params: {
  page: number;
  filters: SearchFilters;
}): Promise<{ agents: NormalizedAgent[]; total: number; page: number; pageSize: number; totalPages: number; error?: string }> {
  try {
    const { name, agentId, account } = params.filters;

    // Build params for specific field searches
    const queryParts: string[] = [];
    const discoverParams: DiscoverParams & { agentId?: string; agentName?: string; agentAccount?: `0x${string}` } = {};

    // agentId participates in both free-text query and structured filters
    if (agentId?.trim()) {
      const agentIdTrimmed = agentId.trim();
      queryParts.push(agentIdTrimmed);
      // Also send as a structured filter so the indexer can use AgentWhereInput.agentId
      // when searchAgentsGraph is available.
      discoverParams.agentId = agentIdTrimmed;
    }
    if (name?.trim()) {
      const nameTrimmed = name.trim();
      discoverParams.agentName = nameTrimmed;
      // Also include name in the free-text query so it works even if the
      // remote indexer doesn't support structured name filtering yet.
      queryParts.push(nameTrimmed);
    }
    if (account?.trim()) {
      const accountTrimmed = account.trim();
      // Validate account address format (0x followed by 40 hex chars)
      // Also accept partial addresses (0x followed by at least 2 hex chars)
      if (/^0x[a-fA-F0-9]{2,}$/i.test(accountTrimmed)) {
        // If it's a full address (40 hex chars), use walletAddress param for exact match
        if (/^0x[a-fA-F0-9]{40}$/i.test(accountTrimmed)) {
          discoverParams.agentAccount = accountTrimmed as `0x${string}`;
        } else {
          // For partial addresses, add to query for text search
          queryParts.push(accountTrimmed);
        }
      } else {
        // Invalid format, but still try to search it
        queryParts.push(accountTrimmed);
      }
    }

    const query = queryParts.length > 0 ? queryParts.join(' ') : undefined;

    const request: DiscoverRequest = {
      page: params.page,
      pageSize: PAGE_SIZE,
      query,
      params: Object.keys(discoverParams).length > 0 ? discoverParams : undefined,
      orderBy: 'agentId',
      orderDirection: 'DESC',
    };

    const response = await discoverAgents(request, getAgenticTrustClient);

    const normalized = response.agents.map(normalizeAgent);
    return {
      agents: normalized,
      total: response.total ?? 0,
      page: response.page ?? params.page,
      pageSize: response.pageSize ?? PAGE_SIZE,
      totalPages: response.totalPages ?? 1,
    };
  } catch (error) {
    const message = extractErrorMessage(error);
    console.error('[Explorer] Failed to load agents:', error);
    return { agents: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1, error: message };
  }
}

function extractErrorMessage(error: unknown): string {
  if (!error) {
    return 'Unknown error when loading agents.';
  }

  type GraphQLErrorLike = { message?: unknown };
  type GraphQLResponseLike = { errors?: GraphQLErrorLike[] };
  type GraphQLRequestError = { response?: GraphQLResponseLike; message?: unknown };

  const accessCodeMessage = (() => {
    if (typeof error === 'object' && error !== null) {
      const { response } = error as GraphQLRequestError;
      if (response?.errors && Array.isArray(response.errors)) {
        for (const item of response.errors) {
          if (typeof item?.message === 'string' && item.message.trim().length > 0) {
            return item.message;
          }
        }
      }
    }
    return null;
  })();

  const baseMessage =
    accessCodeMessage ||
    (error instanceof Error && typeof error.message === 'string' && error.message.trim()
      ? error.message
      : null);

  if (!baseMessage) {
    return 'Unknown error when loading agents.';
  }

  if (/access code required/i.test(baseMessage)) {
    return 'Access code required. Set AGENTIC_TRUST_DISCOVERY_API_KEY (or NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_API_KEY) with your discovery access code.';
  }

  if (/401/.test(baseMessage) || /unauthoriz/i.test(baseMessage)) {
    return 'Unauthorized. Verify your AGENTIC_TRUST_DISCOVERY_API_KEY environment variable.';
  }

  return baseMessage;
}

function normalizeAgent(agent: CoreAgent): NormalizedAgent {
  const id = typeof agent.agentId === 'string' ? agent.agentId : String(agent.agentId ?? '');

  return {
    id: id || cryptoRandomId(),
    name: (agent.agentName ?? 'Unnamed Agent').trim() || 'Unnamed Agent',
    account:
      typeof agent.agentAccount === 'string' && agent.agentAccount.trim().length > 0
        ? agent.agentAccount
        : null,
    owner:
      typeof agent.agentOwner === 'string' && agent.agentOwner.trim().length > 0
        ? agent.agentOwner
        : null,
    chainId: typeof agent.chainId === 'number' ? agent.chainId : null,
    type:
      typeof agent.type === 'string' && agent.type.trim().length > 0 ? agent.type.trim() : null,
    description:
      typeof agent.description === 'string' && agent.description.trim().length > 0
        ? agent.description.trim()
        : null,
    createdAt: normalizeTimestamp(agent.createdAtTime),
    endpoint:
      typeof agent.a2aEndpoint === 'string' && agent.a2aEndpoint.trim().length > 0
        ? agent.a2aEndpoint
        : null,
    metadataUri:
      typeof agent.metadataURI === 'string' && agent.metadataURI.trim().length > 0
        ? agent.metadataURI.trim()
        : null,
    didIdentity:
      typeof agent.didIdentity === 'string' && agent.didIdentity.trim().length > 0
        ? agent.didIdentity.trim()
        : null,
    didAccount:
      typeof agent.didAccount === 'string' && agent.didAccount.trim().length > 0
        ? agent.didAccount.trim()
        : null,
    didName:
      typeof agent.didName === 'string' && agent.didName.trim().length > 0
        ? agent.didName.trim()
        : null,
  };
}

function normalizeTimestamp(value: unknown): string | null {
  if (!value) return null;

  const iso =
    typeof value === 'number'
      ? new Date(value * (value > 1_000_000_000_000 ? 1 : 1000))
      : new Date(value as string);

  if (Number.isNaN(iso.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(iso);
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

type PageParams = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function ExplorerPage({ searchParams }: PageParams) {
  const nameRaw = searchParams?.name;
  const agentIdRaw = searchParams?.agentId;
  const accountRaw = searchParams?.account;
  const currentPageRaw = searchParams?.page;

  const nameInput =
    typeof nameRaw === 'string'
      ? nameRaw.trim()
      : Array.isArray(nameRaw)
        ? nameRaw[0]?.trim() ?? ''
        : '';

  const agentIdInput =
    typeof agentIdRaw === 'string'
      ? agentIdRaw.trim()
      : Array.isArray(agentIdRaw)
        ? agentIdRaw[0]?.trim() ?? ''
        : '';

  const accountInput =
    typeof accountRaw === 'string'
      ? accountRaw.trim()
      : Array.isArray(accountRaw)
        ? accountRaw[0]?.trim() ?? ''
        : '';

  const requestedPage =
    typeof currentPageRaw === 'string'
      ? Number.parseInt(currentPageRaw, 10)
      : Array.isArray(currentPageRaw)
        ? Number.parseInt(currentPageRaw[0] ?? '1', 10)
        : 1;

  const { agents, total, page, totalPages, error } = await fetchAgentsServer({
    page: requestedPage,
    filters: {
      name: nameInput || undefined,
      agentId: agentIdInput || undefined,
      account: accountInput || undefined,
    },
  });

  if (error) {
    return (
      <Box sx={{ py: 6 }}>
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      </Box>
    );
  }

  const filteredAgents = agents;
  const totalAgents = total;
  const hasFilters = nameInput || agentIdInput || accountInput;

  if (totalAgents === 0) {
    return (
      <Box component="section">
        <SearchBar initialFilters={{ name: nameInput, agentId: agentIdInput, account: accountInput }} />
        <Box sx={{ py: 6 }}>
          <Alert severity="info" variant="outlined">
            {hasFilters
              ? 'No agents match your search filters. Try adjusting your search criteria.'
              : 'No agents discovered yet. Once agents are registered with the Agentic Trust network, they will appear here.'}
          </Alert>
        </Box>
      </Box>
    );
  }

  const safePage = Number.isFinite(page) && page > 0 ? Math.min(page, totalPages) : 1;
  const pageAgents = filteredAgents;

  return (
    <Box component="section">
      <SearchBar initialFilters={{ name: nameInput, agentId: agentIdInput, account: accountInput }} />
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <PaginationLinks
          totalPages={totalPages}
          currentPage={safePage}
          filters={{ name: nameInput, agentId: agentIdInput, account: accountInput }}
          totalAgents={totalAgents}
        />
      </Box>
      <Grid container spacing={3}>
        {pageAgents.map((agent) => (
          <Grid key={agent.id} item xs={12} sm={6} lg={4}>
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0px 24px 60px rgba(67, 56, 202, 0.08)',
                borderColor: 'rgba(67, 56, 202, 0.12)',
              }}
            >
              <CardHeader
                title={
                  <Typography variant="h6" component="span">
                    {agent.name}
                  </Typography>
                }
                subheader={
                  <Stack
                    direction="row"
                    spacing={1}
                    flexWrap="wrap"
                    sx={{ mt: 1 }}
                    useFlexGap
                  >
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={getChainLabel(agent.chainId)}
                    />
                    {agent.type && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={agent.type}
                        sx={{ textTransform: 'capitalize' }}
                      />
                    )}
                  </Stack>
                }
                sx={{ pb: 0 }}
              />
              <CardContent
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  flexGrow: 1,
                }}
              >
                {agent.description && (
                  <>
                    <Typography variant="body1" color="text.primary">
                      {agent.description}
                    </Typography>
                    <Divider sx={{ borderStyle: 'dashed' }} />
                  </>
                )}

                <Stack spacing={2.5} sx={{ flexGrow: 1 }}>
                  {agent.account && (
                    <MetaBlock
                      label="Account"
                      value={formatHash(agent.account)}
                      title={agent.account}
                      monospace
                    />
                  )}
                  {agent.owner && (
                    <MetaBlock
                      label="Owner"
                      value={formatHash(agent.owner)}
                      title={agent.owner}
                      monospace
                    />
                  )}
                  {agent.didIdentity && (
                    <MetaBlock
                      label="Identity DID"
                      value={formatDid(agent.didIdentity)}
                      title={agent.didIdentity}
                      monospace
                    />
                  )}
                  {agent.didAccount && (
                    <MetaBlock
                      label="Account DID"
                      value={formatDid(agent.didAccount)}
                      title={agent.didAccount}
                      monospace
                    />
                  )}
                  {agent.didName && (
                    <MetaBlock
                      label="Name DID"
                      value={formatDid(agent.didName)}
                      title={agent.didName}
                      monospace
                    />
                  )}
                  <MetaBlock
                    label="Chain ID"
                    value={agent.chainId ? agent.chainId.toString() : 'Unknown'}
                  />
                  {agent.endpoint && (
                    <MetaBlock
                      label="Endpoint"
                      value={
                        <MuiLink
                          href={agent.endpoint}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="body2"
                          underline="hover"
                        >
                          {formatEndpoint(agent.endpoint)}
                        </MuiLink>
                      }
                      title={agent.endpoint}
                    />
                  )}
                  {agent.metadataUri && (
                    <MetaBlock
                      label="Metadata"
                      value={
                        <MuiLink
                          href={agent.metadataUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="body2"
                          underline="hover"
                        >
                          {formatEndpoint(agent.metadataUri)}
                        </MuiLink>
                      }
                      title={agent.metadataUri}
                    />
                  )}
                  {agent.createdAt && (
                    <MetaBlock label="Created" value={agent.createdAt} />
                  )}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

const CHAIN_LABELS: Record<number, string> = {
  1: 'Ethereum Mainnet',
  11155111: 'Ethereum Sepolia',
  8453: 'Base Mainnet',
  84532: 'Base Sepolia',
  42161: 'Arbitrum One',
  421614: 'Arbitrum Sepolia',
  10: 'Optimism',
  11155420: 'Optimism Sepolia',
  5000: 'Mantle',
  5001: 'Mantle Testnet',
};

function getChainLabel(chainId: number | null): string {
  if (!chainId) {
    return 'Unknown chain';
  }
  return CHAIN_LABELS[chainId] ?? `Chain ${chainId}`;
}

function formatHash(value: string | null): string {
  if (!value) return '—';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatDid(value: string | null): string {
  if (!value) return '—';
  if (value.length <= 32) return value;
  return `${value.slice(0, 20)}…${value.slice(-10)}`;
}

function formatEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname + (url.pathname !== '/' ? url.pathname : '');
  } catch {
    return value;
  }
}

type MetaBlockProps = {
  label: string;
  value: ReactNode;
  monospace?: boolean;
  title?: string;
};

function MetaBlock({ label, value, monospace = false, title }: MetaBlockProps) {
  return (
    <Stack spacing={0.5}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: '.08em', fontSize: 11 }}
      >
        {label}
      </Typography>
      <Typography
        component="div"
        variant="body2"
        title={title}
        sx={{
          fontFamily: monospace
            ? 'JetBrains Mono, Fira Code, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
            : undefined,
          wordBreak: 'break-all',
          color: 'text.primary',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function SearchBar({ initialFilters }: { initialFilters: SearchFilters }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        mb: 3,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
      }}
    >
      <Box
        component="form"
        action="/"
        method="get"
      >
        <input type="hidden" name="page" value="1" />
        <Stack spacing={2}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Search Agents
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField
                name="name"
                label="Agent Name"
                placeholder="Enter agent name"
                fullWidth
                defaultValue={initialFilters.name || ''}
                variant="outlined"
                size="small"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                name="agentId"
                label="Agent ID"
                placeholder="Enter agent ID"
                fullWidth
                defaultValue={initialFilters.agentId || ''}
                variant="outlined"
                size="small"
                type="text"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                name="account"
                label="Account Address"
                placeholder="0x..."
                fullWidth
                defaultValue={initialFilters.account || ''}
                variant="outlined"
                size="small"
                helperText="Enter full or partial Ethereum address"
                sx={{
                  '& .MuiInputBase-input': {
                    fontFamily: 'monospace',
                  },
                }}
              />
            </Grid>
          </Grid>
          <Stack direction="row" spacing={2} justifyContent="flex-end">
            <Button
              type="submit"
              variant="contained"
              sx={{ px: 4 }}
            >
              Search
            </Button>
            <Button
              type="button"
              variant="outlined"
              component={Link}
              href="/"
              sx={{ px: 4 }}
            >
              Clear
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Paper>
  );
}

type PaginationLinksProps = {
  totalPages: number;
  currentPage: number;
  filters: SearchFilters;
  totalAgents: number;
};

function PaginationLinks({ totalPages, currentPage, filters, totalAgents }: PaginationLinksProps) {
  if (totalPages <= 1) {
    return (
      <Typography variant="body2" color="text.secondary">
        Showing {totalAgents} agents
      </Typography>
    );
  }

  const createHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.name?.trim()) {
      params.set('name', filters.name.trim());
    }
    if (filters.agentId?.trim()) {
      params.set('agentId', filters.agentId.trim());
    }
    if (filters.account?.trim()) {
      params.set('account', filters.account.trim());
    }
    if (page > 1) {
      params.set('page', String(page));
    }
    const queryString = params.toString();
    return queryString ? `?${queryString}` : '/';
  };

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2" color="text.secondary">
        Page {currentPage} of {totalPages}
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button
          component={Link}
          href={createHref(Math.max(1, currentPage - 1))}
          variant="outlined"
          size="small"
          aria-disabled={currentPage <= 1}
          sx={{ pointerEvents: currentPage <= 1 ? 'none' : 'auto', opacity: currentPage <= 1 ? 0.5 : 1 }}
        >
          Previous
        </Button>
        <Button
          component={Link}
          href={createHref(Math.min(totalPages, currentPage + 1))}
          variant="contained"
          size="small"
          aria-disabled={currentPage >= totalPages}
          sx={{ pointerEvents: currentPage >= totalPages ? 'none' : 'auto', opacity: currentPage >= totalPages ? 0.5 : 1 }}
        >
          Next
        </Button>
      </Stack>
    </Stack>
  );
}

