'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Box,
  Paper,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
  Stack,
  LinearProgress,
  Divider,
} from '@mui/material';
import { TrendingUp, Storage, Language } from '@mui/icons-material';
import { grayscalePalette as palette } from '@/styles/palette';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface StatsData {
  summary: {
    totalAgents: number;
    totalChains: number;
    chains: Array<{
      chainId: number;
      chainName: string;
      agentCount: number;
    }>;
  };
  metadata: {
    chains: Array<{
      chainId: number;
      chainName: string;
      withMetadata: number;
      withoutMetadata: number;
      metadataPercentage: number;
    }>;
  };
  ens: {
    chains: Array<{
      chainId: number;
      chainName: string;
      withENS: number;
      withoutENS: number;
      ensPercentage: number;
    }>;
  };
  activity: {
    recent24h: Array<{
      chainId: number;
      chainName: string;
      recentCount: number;
    }>;
  };
  topAgents: Array<{
    chainId: number;
    chainName: string;
    agentId: string;
    agentName: string;
    ensName: string | null;
  }>;
}

interface TrendsData {
  dailyMembers: Array<{ day: string; newMembers: number; cumulativeMembers: number }>;
  dailyAgents: Array<{ day: string; newAgents: number; cumulativeAgents: number }>;
  dailyEvents: Array<{ day: string; title: string; description: string | null; kind: string; link: string | null }>;
  dailySdkApps?: Array<{ day: string; newSdkApps: number; cumulativeSdkApps: number }>;
  sdkApps?: Array<{ day: string; name: string; kind: string; homepageUrl: string | null; description: string }>;
}

export function StatsPage() {
  const searchParams = useSearchParams();
  const refresh = searchParams?.get('refresh') === '1';

  const [stats, setStats] = React.useState<StatsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [trends, setTrends] = React.useState<TrendsData | null>(null);
  const [trendsError, setTrendsError] = React.useState<string | null>(null);
  const [trendsLoading, setTrendsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      try {
        if (!cancelled) {
          setLoading(true);
          setError(null);
        }
        const response = await fetch('/api/stats');
        if (!response.ok) {
          throw new Error('Failed to fetch stats');
        }
        const data = (await response.json()) as StatsData;
        if (!cancelled) {
          setStats(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load statistics');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const fetchTrends = async () => {
      try {
        if (!cancelled) {
          setTrendsLoading(true);
          setTrendsError(null);
        }
        const response = await fetch(`/api/stats/trends${refresh ? '?refresh=1' : ''}`);
        if (!response.ok) {
          throw new Error('Failed to fetch trends');
        }
        const data = await response.json();
        if (!cancelled) {
          setTrends(data.trends || null);
        }
      } catch (err) {
        if (!cancelled) {
          setTrendsError(err instanceof Error ? err.message : 'Failed to load trends');
        }
      } finally {
        if (!cancelled) {
          setTrendsLoading(false);
        }
      }
    };
    fetchTrends();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const renderBar = (value: number, max: number, label: string) => {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return (
      <Box sx={{ mb: 1 }}>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {value.toLocaleString()}
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={pct}
          sx={{ height: 6, borderRadius: 999, backgroundColor: palette.surfaceMuted }}
        />
      </Box>
    );
  };

  const eventIcon = (kind: string) => {
    switch (kind) {
      case 'talk':
      case 'meetup':
      case 'community_call':
        return '📢';
      case 'social_post':
        return '📰';
      case 'ama':
        return '❓';
      case 'article':
        return '✍️';
      case 'event':
      default:
        return '📅';
    }
  };

  // (Event icon chart markers removed; events are shown in list only)

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
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
          Network Analytics
        </Typography>
        <Typography variant="h4" fontWeight={700}>
          ERC-8004 Agent Statistics
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Real-time insights across the discovery indexer: agent registrations, metadata coverage,
          ENS adoption, and recent network activity.
        </Typography>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} sx={{ mr: 2 }} />
          <Typography variant="body2" color="text.secondary">
            Loading statistics...
          </Typography>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load statistics: {error}
        </Alert>
      )}

      {trendsError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load trends: {trendsError}
        </Alert>
      )}

      {stats && !loading && !error && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
                <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Storage sx={{ mr: 1, color: palette.textSecondary }} />
                    <Typography variant="body2" color="text.secondary">
                      Total Agents
                    </Typography>
                  </Box>
                  <Typography variant="h4" fontWeight={600}>
                    {stats.summary.totalAgents.toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
                <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <TrendingUp sx={{ mr: 1, color: palette.textSecondary }} />
                    <Typography variant="body2" color="text.secondary">
                      Active Chains
                    </Typography>
                  </Box>
                  <Typography variant="h4" fontWeight={600}>
                    {stats.summary.totalChains}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
                <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Language sx={{ mr: 1, color: palette.textSecondary }} />
                    <Typography variant="body2" color="text.secondary">
                      With ENS
                    </Typography>
                  </Box>
                  <Typography variant="h4" fontWeight={600}>
                    {stats.ens.chains
                      .reduce((sum, chain) => sum + chain.withENS, 0)
                      .toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Grid container spacing={2}>
            {stats.summary.chains.map(chain => {
              const metadataStats = stats.metadata.chains.find(m => m.chainId === chain.chainId);
              const ensStats = stats.ens.chains.find(e => e.chainId === chain.chainId);
              const activityStats = stats.activity.recent24h.find(
                a => a.chainId === chain.chainId,
              );
              return (
                <Grid item xs={12} md={6} key={chain.chainId}>
                  <Card elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          mb: 2,
                        }}
                      >
                        <Typography variant="h6" fontWeight={600}>
                          {chain.chainName}
                        </Typography>
                    <Chip
                      label={`${chain.agentCount} agents`}
                      size="small"
                      color="default"
                      sx={{
                        borderRadius: '999px',
                        backgroundColor: palette.surfaceMuted,
                        border: `1px solid ${palette.border}`,
                        color: palette.textPrimary,
                      }}
                    />
                      </Box>

                      <Box sx={{ mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          Metadata: {metadataStats?.withMetadata ?? 0} / {chain.agentCount} (
                          {metadataStats?.metadataPercentage ?? 0}%)
                        </Typography>
                      </Box>
                      <Box sx={{ mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          ENS Names: {ensStats?.withENS ?? 0} / {chain.agentCount} (
                          {ensStats?.ensPercentage ?? 0}%)
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          Recent (24h): {activityStats?.recentCount ?? 0} new agents
                        </Typography>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          {stats.topAgents.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                Recent Agents
              </Typography>
              <Grid container spacing={1}>
                {stats.topAgents.slice(0, 6).map(agent => (
                  <Grid item xs={12} sm={6} md={4} key={`${agent.chainId}-${agent.agentId}`}>
                    <Card elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
                      <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            mb: 1,
                          }}
                        >
                          <Typography variant="body2" fontWeight={600} noWrap>
                            Agent #{agent.agentId}
                          </Typography>
                      <Chip
                        label={agent.chainName}
                        size="small"
                        color="default"
                        sx={{
                          fontSize: '0.7rem',
                          borderRadius: '999px',
                          backgroundColor: palette.surfaceMuted,
                          border: `1px solid ${palette.border}`,
                          color: palette.textPrimary,
                        }}
                      />
                        </Box>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {agent.agentName}
                        </Typography>
                        {agent.ensName && (
                          <Typography variant="caption" color="primary.main" noWrap>
                            {agent.ensName}
                          </Typography>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
              Trends
            </Typography>
            {trendsLoading && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={20} sx={{ mr: 1 }} /> <Typography variant="body2">Loading trends...</Typography>
              </Box>
            )}
            {!trendsLoading && trends && (() => {
              const members = Array.isArray(trends.dailyMembers) ? trends.dailyMembers : [];
              const agents = Array.isArray(trends.dailyAgents) ? trends.dailyAgents : [];
              const events = Array.isArray(trends.dailyEvents) ? trends.dailyEvents : [];
              const sdkDaily = Array.isArray(trends.dailySdkApps) ? trends.dailySdkApps : [];
              const sdkAppsList = Array.isArray(trends.sdkApps) ? trends.sdkApps : [];
              
              const hasTimeSeriesData = members.length > 0 || agents.length > 0;
              const hasTechData = sdkAppsList.length > 0;
              if (!hasTimeSeriesData && !hasTechData) {
                return <Typography variant="body2" color="text.secondary">No data</Typography>;
              }

              // Merge all data by date
              const dateMap = new Map<string, {
                date: string;
                newMembers: number;
                newAgents: number;
                newSdkApps: number;
                cumulativeMembers: number;
                cumulativeAgents: number;
                cumulativeSdkApps: number;
                events: typeof events;
              }>();

              // Add members data
              members.forEach(m => {
                dateMap.set(m.day, {
                  date: m.day,
                  newMembers: m.newMembers || 0,
                  newAgents: 0,
                  newSdkApps: 0,
                  cumulativeMembers: m.cumulativeMembers || 0,
                  cumulativeAgents: 0,
                  cumulativeSdkApps: 0,
                  events: [],
                });
              });

              // Add agents data
              agents.forEach(a => {
                const existing = dateMap.get(a.day);
                if (existing) {
                  existing.newAgents = a.newAgents || 0;
                  existing.cumulativeAgents = a.cumulativeAgents || 0;
                } else {
                  dateMap.set(a.day, {
                    date: a.day,
                    newMembers: 0,
                    newAgents: a.newAgents || 0,
                    newSdkApps: 0,
                    cumulativeMembers: 0,
                    cumulativeAgents: a.cumulativeAgents || 0,
                    cumulativeSdkApps: 0,
                    events: [],
                  });
                }
              });

              // Add SDKs/Apps daily counts (do NOT create new x-axis dates from this;
              // x-axis is controlled by members + agents only)
              sdkDaily.forEach(s => {
                const existing = dateMap.get(s.day);
                if (!existing) return;
                existing.newSdkApps = s.newSdkApps || 0;
                existing.cumulativeSdkApps = s.cumulativeSdkApps || 0;
              });

              // Add events data
              events.forEach(ev => {
                const existing = dateMap.get(ev.day);
                // Do NOT create new x-axis dates from events; only attach events to existing days
                if (!existing) return;
                existing.events.push(ev);
              });

              // Convert to array and sort by date
              // For cumulative values, ensure they're non-zero and properly calculated
              let lastCumulativeMembers = 0;
              let lastCumulativeAgents = 0;
              let lastCumulativeSdkApps = 0;
              
              const chartData = Array.from(dateMap.values())
                .sort((a, b) => a.date.localeCompare(b.date))
                .map(item => {
                  // Ensure cumulative values are non-decreasing
                  if (item.cumulativeMembers > 0) {
                    lastCumulativeMembers = Math.max(lastCumulativeMembers, item.cumulativeMembers);
                  } else if (lastCumulativeMembers > 0) {
                    item.cumulativeMembers = lastCumulativeMembers;
                  }
                  
                  if (item.cumulativeAgents > 0) {
                    lastCumulativeAgents = Math.max(lastCumulativeAgents, item.cumulativeAgents);
                  } else if (lastCumulativeAgents > 0) {
                    item.cumulativeAgents = lastCumulativeAgents;
                  }

                  if (item.cumulativeSdkApps > 0) {
                    lastCumulativeSdkApps = Math.max(lastCumulativeSdkApps, item.cumulativeSdkApps);
                  } else if (lastCumulativeSdkApps > 0) {
                    item.cumulativeSdkApps = lastCumulativeSdkApps;
                  }
                  
                  return {
                    ...item,
                    // Format date for display (e.g., "2025-10-13" -> "Oct 13")
                    dateLabel: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                  };
                })
                .filter(item =>
                  item.cumulativeMembers > 0 ||
                  item.cumulativeAgents > 0 ||
                  item.cumulativeSdkApps > 0 ||
                  item.newMembers > 0 ||
                  item.newAgents > 0 ||
                  item.newSdkApps > 0
                );

              // Calculate max values for y-axis (separate scales)
              const maxNewMembers = Math.max(...chartData.map(d => d.newMembers), 1);
              const maxNewAgents = Math.max(...chartData.map(d => d.newAgents), 1);
              const maxValue = Math.max(maxNewMembers, maxNewAgents);
              
              // Filter major events (award, milestone, integration, proposal)
              const majorEventKinds = ['award', 'milestone', 'integration', 'proposal'];
              const majorEvents = events.filter(ev => majorEventKinds.includes(ev.kind));

              // Custom tooltip for data points (daily)
              const CustomTooltip = ({ active, payload }: any) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <Box
                      sx={{
                        backgroundColor: palette.surface,
                        border: `1px solid ${palette.border}`,
                        borderRadius: 1,
                        p: 1.5,
                        boxShadow: 2,
                      }}
                    >
                      <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                        {data.date}
                      </Typography>
                      {data.newMembers > 0 && (
                        <Typography variant="body2" color="text.secondary">
                          New Members: {data.newMembers.toLocaleString()}
                        </Typography>
                      )}
                      {data.newAgents > 0 && (
                        <Typography variant="body2" color="text.secondary">
                          New Agents: {data.newAgents.toLocaleString()}
                        </Typography>
                      )}
                      {data.newSdkApps > 0 && (
                        <Typography variant="body2" color="text.secondary">
                          New SDKs/Apps: {data.newSdkApps.toLocaleString()}
                        </Typography>
                      )}
                      {data.events && data.events.length > 0 && (
                        <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${palette.border}` }}>
                          {data.events.map((ev: any, idx: number) => (
                            <Typography key={idx} variant="caption" color="text.secondary">
                              {eventIcon(ev.kind)} {ev.title}
                            </Typography>
                          ))}
                        </Box>
                      )}
                    </Box>
                  );
                }
                return null;
              };

              // Custom tooltip for cumulative data
              const CumulativeTooltip = ({ active, payload }: any) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <Box
                      sx={{
                        backgroundColor: palette.surface,
                        border: `1px solid ${palette.border}`,
                        borderRadius: 1,
                        p: 1.5,
                        boxShadow: 2,
                      }}
                    >
                      <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                        {data.date}
                      </Typography>
                      {data.cumulativeMembers > 0 && (
                        <Typography variant="body2" color="text.secondary">
                          Cumulative Members: {data.cumulativeMembers.toLocaleString()}
                        </Typography>
                      )}
                      {data.cumulativeAgents > 0 && (
                        <Typography variant="body2" color="text.secondary">
                          Cumulative Agents: {data.cumulativeAgents.toLocaleString()}
                        </Typography>
                      )}
                    </Box>
                  );
                }
                return null;
              };

              return (
                <>
                <Card elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', position: 'relative' }}>
                  <CardContent>
                    <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                      Daily Trends
                    </Typography>
                    {!hasTimeSeriesData && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        No daily member/agent data available (events do not drive the x-axis).
                      </Typography>
                    )}
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={chartData} margin={{ top: 80, right: 50, left: 20, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={palette.border} />
                        <XAxis
                          dataKey="date"
                          stroke={palette.textSecondary}
                          style={{ fontSize: '12px' }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                          interval={0}
                          minTickGap={0}
                          tickFormatter={(value) =>
                            new Date(String(value)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          }
                        />
                        <YAxis
                          yAxisId="members"
                          stroke="#8884d8"
                          style={{ fontSize: '12px' }}
                          label={{ value: 'New Members', angle: -90, position: 'insideLeft', style: { fill: '#8884d8' } }}
                          domain={[0, maxNewMembers * 1.1]}
                          tickFormatter={(value) => Math.round(value).toString()}
                        />
                        <YAxis
                          yAxisId="agents"
                          orientation="right"
                          stroke="#82ca9d"
                          style={{ fontSize: '12px' }}
                          label={{ value: 'New Agents', angle: 90, position: 'insideRight', style: { fill: '#82ca9d' } }}
                          domain={[0, maxNewAgents * 1.1]}
                          tickFormatter={(value) => Math.round(value).toString()}
                        />
                        {/* Disable generic hover tooltip on the daily chart; keep only event hover overlays */}
                        <Legend />
                        <Line
                          yAxisId="members"
                          type="monotone"
                          dataKey="newMembers"
                          stroke="#8884d8"
                          strokeWidth={2}
                          name="New Members"
                          dot={{ r: 3 }}
                        />
                        <Line
                          yAxisId="agents"
                          type="monotone"
                          dataKey="newAgents"
                          stroke="#82ca9d"
                          strokeWidth={2}
                          name="New Agents"
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Cumulative Trends Chart */}
                <Card elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', mt: 3, position: 'relative' }}>
                  <CardContent>
                    <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                      Cumulative Trends
                    </Typography>
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={chartData} margin={{ top: 80, right: 50, left: 20, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={palette.border} />
                        <XAxis
                          dataKey="date"
                          stroke={palette.textSecondary}
                          style={{ fontSize: '12px' }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                          interval={0}
                          minTickGap={0}
                          tickFormatter={(value) =>
                            new Date(String(value)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          }
                        />
                        <YAxis
                          stroke={palette.textSecondary}
                          style={{ fontSize: '12px' }}
                          label={{ value: 'Cumulative Count', angle: -90, position: 'insideLeft', style: { fill: palette.textSecondary } }}
                          domain={[0, Math.max(
                            ...chartData.map(d => d.cumulativeMembers || 0),
                            ...chartData.map(d => d.cumulativeAgents || 0),
                            1
                          ) * 1.1]}
                          tickFormatter={(value) => Math.round(value).toString()}
                        />
                        <Tooltip content={<CumulativeTooltip />} />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="cumulativeMembers"
                          stroke="#8884d8"
                          strokeWidth={2}
                          name="Cumulative Members"
                          dot={{ r: 3 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="cumulativeAgents"
                          stroke="#82ca9d"
                          strokeWidth={2}
                          name="Cumulative Agents"
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* SDKs/Apps/Infra list */}
                <Card elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', mt: 3 }}>
                  <CardContent>
                    <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                      SDKs / Apps / Infra (First seen)
                    </Typography>
                    {sdkAppsList.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No SDK/app data
                      </Typography>
                    ) : (
                      <Stack spacing={1} divider={<Divider flexItem />}>
                        {sdkAppsList.map((item, idx) => (
                          <Box key={`${item.day}-${item.name}-${idx}`} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                            <Box sx={{ minWidth: 110 }}>
                              <Typography variant="body2" fontWeight={600}>
                                {item.day}
                              </Typography>
                              <Chip size="small" label={item.kind} sx={{ mt: 0.5 }} />
                            </Box>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
                                {item.name}
                              </Typography>
                              {item.homepageUrl && (
                                <Typography
                                  variant="caption"
                                  component="a"
                                  href={item.homepageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  sx={{
                                    display: 'inline-block',
                                    mb: 0.5,
                                    color: 'primary.main',
                                    textDecoration: 'none',
                                    '&:hover': { textDecoration: 'underline' },
                                  }}
                                >
                                  {item.homepageUrl}
                                </Typography>
                              )}
                              <Typography variant="body2" color="text.secondary">
                                {item.description}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </CardContent>
                </Card>

                {/* All events list */}
                <Card elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', mt: 3 }}>
                  <CardContent>
                    <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                      Events (All)
                    </Typography>
                    {events.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No events
                      </Typography>
                    ) : (
                      <Stack spacing={1} divider={<Divider flexItem />}>
                        {[...events]
                          // Most recent first
                          .sort((a, b) => (a.day < b.day ? 1 : -1))
                          .map((ev, idx) => (
                            <Box key={`${ev.day}-${ev.title}-${idx}`} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                              <Box sx={{ minWidth: 110 }}>
                                <Typography variant="body2" fontWeight={600}>
                                  {ev.day}
                                </Typography>
                                <Chip size="small" label={ev.kind} sx={{ mt: 0.5 }} />
                              </Box>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
                                  {eventIcon(ev.kind)} {ev.title}
                                </Typography>
                                {ev.link && (
                                  <Typography
                                    variant="caption"
                                    component="a"
                                    href={ev.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    sx={{
                                      display: 'inline-block',
                                      mb: 0.5,
                                      color: 'primary.main',
                                      textDecoration: 'none',
                                      '&:hover': { textDecoration: 'underline' },
                                    }}
                                  >
                                    {ev.link}
                                  </Typography>
                                )}
                                {ev.description && (
                                  <Typography variant="body2" color="text.secondary">
                                    {ev.description}
                                  </Typography>
                                )}
                              </Box>
                            </Box>
                          ))}
                      </Stack>
                    )}
                  </CardContent>
                </Card>
                </>
              );
            })()}
          </Box>
        </>
      )}
    </Paper>
  );
}
