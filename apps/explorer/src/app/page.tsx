import type { ReactNode } from 'react';
import { type Agent, type ListAgentsResponse } from '@agentic-trust/core/server';
import { getExplorerClient } from '@/lib/server-client';
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
} from '@mui/material';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type NormalizedAgent = {
  id: string;
  name: string;
  address: string | null;
  owner: string | null;
  chainId: number | null;
  type: string | null;
  description: string | null;
  createdAt: string | null;
  endpoint: string | null;
  metadataUri: string | null;
};

const PAGE_SIZE = 10;

async function fetchAgentsServer(params: {
  page: number;
  query: string;
}): Promise<{ agents: NormalizedAgent[]; total: number; page: number; pageSize: number; totalPages: number; error?: string }> {
  try {
    const client = await getExplorerClient();
    const { agents, total, page, pageSize, totalPages }: ListAgentsResponse = await client.agents.searchAgents({
      page: params.page,
      pageSize: PAGE_SIZE,
      query: params.query,
      orderBy: 'agentName',
      orderDirection: 'ASC',
    });

    const normalized = agents.map(normalizeAgent);
    return { agents: normalized, total, page, pageSize, totalPages };
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

function normalizeAgent(agent: Agent): NormalizedAgent {
  const data = agent.data ?? {};
  const idFromAgentClass = agent.agentId;
  const idRaw = typeof data.agentId === 'string' ? data.agentId : String(data.agentId ?? '');

  const id =
    typeof idFromAgentClass === 'number'
      ? idFromAgentClass.toString()
      : idRaw || cryptoRandomId();

  return {
    id,
    name: (agent.agentName ?? data.agentName ?? 'Unnamed Agent').trim() || 'Unnamed Agent',
    address: (data.agentAddress as string | undefined) ?? null,
    owner: (data.agentOwner as string | undefined) ?? null,
    chainId: typeof data.chainId === 'number' ? data.chainId : null,
    type:
      typeof data.type === 'string' && data.type.trim().length > 0 ? data.type.trim() : null,
    description:
      typeof data.description === 'string' && data.description.trim().length > 0
        ? data.description.trim()
        : null,
    createdAt: normalizeTimestamp(data.createdAtTime),
    endpoint:
      typeof data.a2aEndpoint === 'string' && data.a2aEndpoint.trim().length > 0
        ? data.a2aEndpoint
        : null,
    metadataUri:
      typeof data.metadataURI === 'string' && data.metadataURI.trim().length > 0
        ? data.metadataURI.trim()
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
  const queryRaw = searchParams?.query;
  const currentPageRaw = searchParams?.page;

  const queryInput =
    typeof queryRaw === 'string'
      ? queryRaw.trim()
      : Array.isArray(queryRaw)
        ? queryRaw[0]?.trim() ?? ''
        : '';
  const normalizedQuery = queryInput; // send raw trimmed query to backend advanced search

  const requestedPage =
    typeof currentPageRaw === 'string'
      ? Number.parseInt(currentPageRaw, 10)
      : Array.isArray(currentPageRaw)
        ? Number.parseInt(currentPageRaw[0] ?? '1', 10)
        : 1;

  const { agents, total, page, totalPages, error } = await fetchAgentsServer({
    page: requestedPage,
    query: queryInput,
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
  if (totalAgents === 0) {
    return (
      <Box component="section">
        <SearchBar initialQuery={queryInput} />
        <Box sx={{ py: 6 }}>
          <Alert severity="info" variant="outlined">
            {normalizedQuery
              ? 'No agents match your search yet. Try a different keyword or capability.'
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
      <SearchBar initialQuery={queryInput} />
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
          query={queryInput}
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
                  {agent.address && (
                    <MetaBlock
                      label="Account"
                      value={formatHash(agent.address)}
                      title={agent.address}
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

function SearchBar({ initialQuery }: { initialQuery: string }) {
  return (
    <Box
      component="form"
      action="/"
      method="get"
      sx={{
        mb: 3,
      }}
    >
      <input type="hidden" name="page" value="1" />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', sm: 'center' }}
      >
        <TextField
          name="query"
          placeholder="Search agents by name, capability, or address..."
          fullWidth
          defaultValue={initialQuery || ''}
          variant="outlined"
        />
        <Button
          type="submit"
          variant="contained"
          sx={{ px: 4, whiteSpace: 'nowrap', alignSelf: { xs: 'stretch', sm: 'flex-end' } }}
        >
          Search
        </Button>
      </Stack>
    </Box>
  );
}

type PaginationLinksProps = {
  totalPages: number;
  currentPage: number;
  query: string;
  totalAgents: number;
};

function PaginationLinks({ totalPages, currentPage, query, totalAgents }: PaginationLinksProps) {
  if (totalPages <= 1) {
    return (
      <Typography variant="body2" color="text.secondary">
        Showing {totalAgents} agents
      </Typography>
    );
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  const createHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set('query', query.trim());
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
        {pages.map((page) => (
          <Button
            key={page}
            component={Link}
            href={createHref(page)}
            variant={page === currentPage ? 'contained' : 'outlined'}
            size="small"
          >
            {page}
          </Button>
        ))}
      </Stack>
    </Stack>
  );
}

