'use client';

import * as React from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  Button,
} from '@mui/material';
import { grayscalePalette as palette } from '@/styles/palette';
import { getChainDisplayMetadata } from '@agentic-trust/core';

type SemanticMetadataEntry = {
  key: string;
  valueText?: string | null;
};

type DiscoveryAgent = {
  agentId: string;
  agentName: string;
  chainId: number;
  agentAccount: string;
  agentOwner: string;
  agentCategory?: string | null;
  didName?: string | null;
  did?: string | null;
  description?: string | null;
  a2aEndpoint?: string | null;
  mcpEndpoint?: string | null;
  feedbackCount?: number | null;
  feedbackAverageScore?: number | null;
  createdAtTime: number | null;
  score?: number | null;
  matchReasons?: string[] | null;
  supportedTrust?: string | null;
  metadata?: SemanticMetadataEntry[] | null;
};

type SemanticMatch = {
  score?: number | null;
  matchReasons?: string[] | null;
  agent?: {
    chainId?: number | null;
    agentId?: string | number | null;
    agentName?: string | null;
    agentAccount?: string | null;
    agentOwner?: string | null;
    didName?: string | null;
    did?: string | null;
    description?: string | null;
    a2aEndpoint?: string | null;
    mcpEndpoint?: string | null;
    feedbackCount?: number | null;
    feedbackAverageScore?: number | null;
    createdAtTime?: number | string | null;
    supportedTrust?: string | null;
    metadata?: SemanticMetadataEntry[] | null;
  } | null;
};

type SemanticSearchResponse = {
  success?: boolean;
  total?: number;
  matches?: SemanticMatch[];
};

export function AgentDiscoveryPage() {
  const [query, setQuery] = React.useState('');
  const [agents, setAgents] = React.useState<DiscoveryAgent[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0); // zero-based for TablePagination
  const [rowsPerPage, setRowsPerPage] = React.useState(25);

  const fetchAgents = React.useCallback(
    async (queryOverride?: string) => {
      try {
        setLoading(true);
        setError(null);

        const effectiveQuery =
          typeof queryOverride === 'string' ? queryOverride : query;

        const trimmed = typeof effectiveQuery === 'string' ? effectiveQuery.trim() : '';

        if (!trimmed) {
          setAgents([]);
          setPage(0);
          return;
        }

        const payload = {
          text: trimmed,
        };

        const response = await fetch('/api/agents/semantic-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || errorData.error || 'Failed to run semantic search',
          );
        }

        const data = (await response.json()) as SemanticSearchResponse;
        const matches = Array.isArray(data.matches) ? data.matches : [];

        const nextAgents: DiscoveryAgent[] = [];

        for (const match of matches) {
          if (!match || !match.agent) continue;
          const agent = match.agent;

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

          nextAgents.push({
            chainId,
            agentId,
            agentName: agent.agentName ?? 'Unnamed Agent',
            agentAccount: agent.agentAccount ?? '',
            agentOwner: agent.agentOwner ?? '',
            agentCategory: null,
            didName: agent.didName ?? null,
            did: agent.did ?? null,
            description: agent.description ?? null,
            a2aEndpoint: agent.a2aEndpoint ?? null,
            mcpEndpoint: agent.mcpEndpoint ?? null,
            feedbackCount: agent.feedbackCount ?? null,
            feedbackAverageScore: agent.feedbackAverageScore ?? null,
            createdAtTime:
              createdAt !== null && Number.isFinite(createdAt) ? createdAt : null,
            score:
              typeof match.score === 'number' && Number.isFinite(match.score)
                ? match.score
                : null,
            matchReasons: Array.isArray(match.matchReasons)
              ? match.matchReasons.map((reason) => String(reason))
              : null,
            supportedTrust: agent.supportedTrust ?? null,
            metadata: agent.metadata ?? null,
          });
        }

        setAgents(nextAgents);
        setPage(0);
      } catch (err) {
        console.error('[AgentDiscoveryPage] Failed to run semantic search:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to run semantic search',
        );
      } finally {
        setLoading(false);
      }
    },
    [query],
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    fetchAgents(query);
  };

  const handleChangePage = (
    _event: unknown,
    newPage: number,
  ) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const value = parseInt(event.target.value, 10);
    const next = Number.isFinite(value) && value > 0 ? value : rowsPerPage;
    setRowsPerPage(next);
    setPage(0);
  };

  const formatDateTime = (timestamp: number | null | undefined) => {
    if (timestamp === null || timestamp === undefined) {
      return '';
    }
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      return '';
    }
    try {
      const date = new Date(timestamp * 1000);
      return date.toLocaleString();
    } catch {
      return String(timestamp);
    }
  };

  const getChainLabel = (chainId: number) => {
    const metadata = getChainDisplayMetadata(chainId);
    return (
      metadata?.displayName ||
      metadata?.chainName ||
      `Chain ${Number.isFinite(chainId) ? chainId : 'N/A'}`
    );
  };

  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: 3,
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.surface,
      }}
    >
      <Box
        sx={{
          mb: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        <Box>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ letterSpacing: '0.08em' }}
          >
            Discovery
          </Typography>
          <Typography variant="h4" fontWeight={700}>
            Semantic Agent Search
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Search the discovery indexer using a single free-text query. Results are
            powered by the DiscoveryClient&apos;s semanticAgentSearch and return
            semantically ranked ERC-8004 agents.
          </Typography>
        </Box>

        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 1.5,
            alignItems: { xs: 'stretch', sm: 'center' },
          }}
        >
          <TextField
            label="Search agents"
            placeholder="Name, ENS, address, description, endpoints, capabilities..."
            size="small"
            fullWidth
            value={query}
            onChange={event => setQuery(event.target.value)}
            InputProps={{
              sx: { backgroundColor: palette.surfaceMuted },
            }}
          />
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={loading}
            sx={{
              minWidth: { xs: '100%', sm: 140 },
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer
        sx={{
          borderRadius: 2,
          border: `1px solid ${palette.border}`,
          backgroundColor: palette.surfaceMuted,
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Agent</TableCell>
              <TableCell>Chain</TableCell>
              <TableCell>Agent ID</TableCell>
              <TableCell align="right">Score</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell>A2A</TableCell>
              <TableCell>MCP</TableCell>
              <TableCell align="right">Feedback</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && agents.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Box
                    sx={{
                      py: 3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1.5,
                    }}
                  >
                    <CircularProgress size={20} />
                    <Typography variant="body2" color="text.secondary">
                      Searching agents…
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}

            {!loading && agents.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Box sx={{ py: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                      No agents found. Try adjusting your query.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}

            {agents
              .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
              .map(agent => {
              const chainLabel = getChainLabel(agent.chainId);

              const feedbackLabel =
                agent.feedbackCount == null
                  ? '—'
                  : agent.feedbackAverageScore == null
                    ? agent.feedbackCount.toString()
                    : `${agent.feedbackCount.toString()} • ${
                        Math.round(agent.feedbackAverageScore * 10) / 10
                      }★`;

              return (
                <TableRow key={`${agent.chainId}:${agent.agentId}`}>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {agent.agentName || 'Unnamed Agent'}
                      </Typography>
                      {agent.agentCategory && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontWeight: 500 }}
                        >
                          {agent.agentCategory}
                        </Typography>
                      )}
                      {agent.didName && (
                        <Typography variant="caption" color="text.secondary">
                          {agent.didName}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">
                      {agent.score !== null && agent.score !== undefined
                        ? agent.score.toFixed(3)
                        : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{chainLabel}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{agent.agentId}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      sx={{
                        maxWidth: 220,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                      }}
                      title={agent.agentOwner}
                    >
                      {agent.agentOwner}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      sx={{
                        maxWidth: 220,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                      }}
                      title={agent.a2aEndpoint || undefined}
                    >
                      {agent.a2aEndpoint || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      sx={{
                        maxWidth: 220,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                      }}
                      title={agent.mcpEndpoint || undefined}
                    >
                      {agent.mcpEndpoint || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">{feedbackLabel}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {formatDateTime(agent.createdAtTime)}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={agents.length}
        page={page}
        onPageChange={handleChangePage}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        rowsPerPageOptions={[10, 25, 50]}
      />
    </Paper>
  );
}


