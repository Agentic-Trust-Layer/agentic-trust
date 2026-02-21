export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDiscoveryClient } from '@agentic-trust/core/server';

type Scope = 'honorRoll' | 'allAgents' | 'ens8004Subdomains' | 'myAgents';

type Filters = {
  chainId: string;
  address: string;
  name: string;
  agentIdentifierMatch: string;
  scope: Scope;
  protocol: 'all' | 'a2a' | 'mcp';
  path: string;
  minReviews: string;
  minValidations: string;
  minAssociations: string;
  minAtiOverallScore: string;
  minAvgRating: string;
  createdWithinDays: string;
};

function normalizeDiscoveryUrl(value: string | undefined | null): string | null {
  const raw = (value || '').toString().trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (/\/graphql-kb$/i.test(raw)) return raw;
  if (/\/graphql$/i.test(raw)) return raw.replace(/\/graphql$/i, '/graphql-kb');
  return `${raw}/graphql-kb`;
}

function resolveDiscoveryEndpoint(): { endpoint: string; source: string } | null {
  const candidates = [
    { key: 'AGENTIC_TRUST_DISCOVERY_URL', value: process.env.AGENTIC_TRUST_DISCOVERY_URL },
    { key: 'NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_URL', value: process.env.NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_URL },
  ];
  const picked = candidates.find((c) => typeof c.value === 'string' && c.value.trim().length > 0) ?? null;
  const endpoint = normalizeDiscoveryUrl(picked?.value ?? null);
  if (!endpoint || !picked) return null;
  return { endpoint, source: picked.key };
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isHexAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function pickLower(value: unknown): string {
  return getString(value).trim().toLowerCase();
}

function filterAgentsInProcess(agents: any[], filters: Filters, options?: { ensSubdomainsOnly?: boolean }) {
  const nameQuery = pickLower(filters.name);
  const addrQuery = getString(filters.address).trim();
  const idQuery = getString(filters.agentIdentifierMatch).trim().toLowerCase();
  const protocol = filters.protocol;

  const minReviews = asNumber(filters.minReviews);
  const minValidations = asNumber(filters.minValidations);
  const minAssociations = asNumber(filters.minAssociations);
  const minAti = asNumber(filters.minAtiOverallScore);
  const minAvg = asNumber(filters.minAvgRating);
  const createdWithinDays = asNumber(filters.createdWithinDays);
  const createdSinceSec =
    createdWithinDays && Number.isFinite(createdWithinDays) && createdWithinDays > 0
      ? Math.floor(Date.now() / 1000) - Math.floor(createdWithinDays * 24 * 60 * 60)
      : null;

  const pathQuery = pickLower(filters.path);

  return (Array.isArray(agents) ? agents : []).filter((a) => {
    const agentName = pickLower(a?.agentName);
    const uaid = pickLower(a?.uaid);
    const agentAccount = pickLower(a?.agentAccount);
    const agentUri = pickLower(a?.agentUri);
    const desc = pickLower(a?.description ?? a?.agentDescription);
    const a2aEndpoint = pickLower(a?.a2aEndpoint);
    const mcpEndpoint = pickLower(a?.mcpEndpoint);

    if (options?.ensSubdomainsOnly) {
      // subdomains only: *.8004-agent.eth (exclude exact 8004-agent.eth)
      if (!agentName.endsWith('.8004-agent.eth')) return false;
    }

    if (nameQuery && !agentName.includes(nameQuery)) return false;

    if (addrQuery) {
      if (!isHexAddress(addrQuery)) return false;
      const addrLower = addrQuery.toLowerCase();
      const hit =
        agentAccount === addrLower ||
        pickLower(a?.eoaAgentAccount) === addrLower ||
        pickLower(a?.eoaAgentIdentityOwnerAccount) === addrLower ||
        pickLower(a?.agentIdentityOwnerAccount) === addrLower;
      if (!hit) return false;
    }

    if (idQuery) {
      if (!(uaid.includes(idQuery) || agentName.includes(idQuery))) return false;
    }

    if (protocol === 'a2a' && !a2aEndpoint) return false;
    if (protocol === 'mcp' && !mcpEndpoint) return false;

    if (pathQuery) {
      const hay = [agentName, uaid, agentAccount, agentUri, desc, a2aEndpoint, mcpEndpoint].filter(Boolean).join(' ');
      if (!hay.includes(pathQuery)) return false;
    }

    const feedbackCount =
      typeof a?.feedbackCount === 'number'
        ? a.feedbackCount
        : typeof a?.assertions?.reviewResponses?.total === 'number'
          ? a.assertions.reviewResponses.total
          : 0;
    if (minReviews != null && minReviews > 0 && feedbackCount < minReviews) return false;

    const validationsCompleted =
      typeof a?.validationCompletedCount === 'number'
        ? a.validationCompletedCount
        : typeof a?.assertions?.validationResponses?.total === 'number'
          ? a.assertions.validationResponses.total
          : 0;
    if (minValidations != null && minValidations > 0 && validationsCompleted < minValidations) return false;

    const initiated = typeof a?.initiatedAssociationCount === 'number' ? a.initiatedAssociationCount : 0;
    const approved = typeof a?.approvedAssociationCount === 'number' ? a.approvedAssociationCount : 0;
    if (minAssociations != null && minAssociations > 0 && initiated + approved < minAssociations) return false;

    const atiOverall = typeof a?.atiOverallScore === 'number' ? a.atiOverallScore : null;
    if (minAti != null && minAti > 0 && (atiOverall == null || atiOverall < minAti)) return false;

    const avg = typeof a?.feedbackAverageScore === 'number' ? a.feedbackAverageScore : null;
    if (minAvg != null && minAvg > 0 && (avg == null || avg < minAvg)) return false;

    if (createdSinceSec != null) {
      const createdAt = typeof a?.createdAtTime === 'number' ? a.createdAtTime : null;
      if (!createdAt || createdAt < createdSinceSec) return false;
    }

    return true;
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const scope = getString(body.scope).trim() as Scope;
    const page = Math.max(1, Math.floor(asNumber(body.page) ?? 1));
    const pageSize = Math.max(1, Math.floor(asNumber(body.pageSize) ?? 18));
    const walletAddress = getString(body.walletAddress).trim();
    const filters = (body.filters ?? {}) as Partial<Filters>;
    const safeFilters: Filters = {
      chainId: getString(filters.chainId ?? 'all'),
      address: getString(filters.address ?? ''),
      name: getString(filters.name ?? ''),
      agentIdentifierMatch: getString(filters.agentIdentifierMatch ?? ''),
      scope: (getString(filters.scope ?? scope).trim() as Scope) || 'allAgents',
      protocol: (getString(filters.protocol ?? 'all') as any) === 'a2a' ? 'a2a' : (getString(filters.protocol ?? 'all') as any) === 'mcp' ? 'mcp' : 'all',
      path: getString(filters.path ?? ''),
      minReviews: getString(filters.minReviews ?? ''),
      minValidations: getString(filters.minValidations ?? ''),
      minAssociations: getString(filters.minAssociations ?? ''),
      minAtiOverallScore: getString(filters.minAtiOverallScore ?? ''),
      minAvgRating: getString(filters.minAvgRating ?? ''),
      createdWithinDays: getString(filters.createdWithinDays ?? ''),
    };

    if (
      scope !== 'honorRoll' &&
      scope !== 'allAgents' &&
      scope !== 'ens8004Subdomains' &&
      scope !== 'myAgents'
    ) {
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
    }

    if (scope === 'myAgents') {
      if (!walletAddress || !walletAddress.startsWith('0x')) {
        return NextResponse.json({ error: 'walletAddress is required for myAgents scope' }, { status: 400 });
      }

      // Pull a large owned set, then filter/paginate in-process for consistent advanced filtering.
      const discoveryClient = await getDiscoveryClient();
      const owned = await discoveryClient.getOwnedAgents(walletAddress, {
        limit: 2000,
        offset: 0,
        orderBy: 'createdAtTime',
        orderDirection: 'DESC',
      });

      const filtered = filterAgentsInProcess(owned, safeFilters);
      const start = Math.max(0, (page - 1) * pageSize);
      const end = start + pageSize;
      const paged = filtered.slice(start, end);
      return NextResponse.json({
        success: true,
        scope,
        agents: paged,
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      });
    }

    if (scope === 'honorRoll') {
      const chainIdRaw = getString(safeFilters.chainId).trim();
      const chainId = chainIdRaw && chainIdRaw !== 'all' ? Number(chainIdRaw) : Number.NaN;
      if (!Number.isFinite(chainId)) {
        return NextResponse.json({ error: 'Honor roll requires a specific chainId (not \"all\")' }, { status: 400 });
      }

      const resolved = resolveDiscoveryEndpoint();
      if (!resolved) {
        return NextResponse.json(
          {
            error:
              'Missing discovery URL. Set AGENTIC_TRUST_DISCOVERY_URL (preferred) or NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_URL.',
          },
          { status: 500 },
        );
      }
      const apiKey = (process.env.GRAPHQL_ACCESS_CODE || process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || '').trim();
      if (!apiKey) {
        return NextResponse.json(
          {
            error:
              'Missing discovery access code. Set GRAPHQL_ACCESS_CODE (preferred) or AGENTIC_TRUST_DISCOVERY_API_KEY on the server.',
            endpoint: resolved.endpoint,
            endpointSource: resolved.source,
          },
          { status: 500 },
        );
      }

      const agentIdentifierMatchRaw = getString(safeFilters.agentIdentifierMatch).trim();
      const minReviewAssertionCountParsed = asNumber(safeFilters.minReviews);
      const where: Record<string, unknown> = {
        chainId,
        ...(agentIdentifierMatchRaw ? { agentIdentifierMatch: agentIdentifierMatchRaw } : {}),
        ...(minReviewAssertionCountParsed && minReviewAssertionCountParsed > 0
          ? { minReviewAssertionCount: Math.floor(minReviewAssertionCountParsed) }
          : {}),
        ...(safeFilters.name.trim() ? { agentName_contains: safeFilters.name.trim() } : {}),
      };

      const query = `
        query KbRankedAgents($where: KbAgentWhereInput, $first: Int!, $skip: Int!) {
          kbAgents(
            where: $where
            first: $first
            skip: $skip
            orderBy: bestRank
            orderDirection: DESC
          ) {
            total
            hasMore
            agents {
              iri
              uaid
              agentName
              agentDescription
              agentImage
              agentTypes
              createdAtTime
              updatedAtTime
              assertions { reviewResponses { total } validationResponses { total } total }
              trustLedgerTotalPoints
              trustLedgerBadgeCount
              trustLedgerComputedAt
              trustLedgerBadges {
                iri
                awardedAt
                definition { badgeId name iconRef points }
              }
              atiOverallScore
              atiOverallConfidence
              atiVersion
              atiComputedAt
            }
          }
        }
      `;

      // Fetch a large window, then apply the remaining advanced filters in-process (protocol/path/etc).
      const first = 2000;
      const res = await fetch(resolved.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          query,
          variables: { where, first, skip: 0 },
        }),
      });

      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        return NextResponse.json(
          { error: json?.error || json?.message || `Ranked agents query failed (${res.status})` },
          { status: 502 },
        );
      }
      if (json?.errors?.length) {
        return NextResponse.json(
          { error: json.errors?.[0]?.message || 'Ranked agents query failed (GraphQL error)' },
          { status: 502 },
        );
      }

      const list = Array.isArray(json?.data?.kbAgents?.agents) ? (json.data.kbAgents.agents as any[]) : [];
      const mapped = list.map((a) => ({
        chainId,
        uaid: typeof a?.uaid === 'string' ? a.uaid : null,
        agentId: typeof a?.uaid === 'string' ? a.uaid : String(a?.iri ?? ''),
        agentName: typeof a?.agentName === 'string' ? a.agentName : null,
        description: typeof a?.agentDescription === 'string' ? a.agentDescription : null,
        image: typeof a?.agentImage === 'string' ? a.agentImage : null,
        agentTypes: Array.isArray(a?.agentTypes) ? a.agentTypes : null,
        createdAtTime: typeof a?.createdAtTime === 'number' ? a.createdAtTime : null,
        updatedAtTime: typeof a?.updatedAtTime === 'number' ? a.updatedAtTime : null,
        assertions: a?.assertions ?? null,
        trustLedgerScore:
          typeof a?.trustLedgerTotalPoints === 'number' && Number.isFinite(a.trustLedgerTotalPoints)
            ? a.trustLedgerTotalPoints
            : null,
        trustLedgerBadgeCount:
          typeof a?.trustLedgerBadgeCount === 'number' && Number.isFinite(a.trustLedgerBadgeCount)
            ? a.trustLedgerBadgeCount
            : null,
        trustLedgerComputedAt:
          typeof a?.trustLedgerComputedAt === 'number' && Number.isFinite(a.trustLedgerComputedAt)
            ? a.trustLedgerComputedAt
            : null,
        trustLedgerBadges: Array.isArray(a?.trustLedgerBadges) ? a.trustLedgerBadges : null,
        atiOverallScore:
          typeof a?.atiOverallScore === 'number' && Number.isFinite(a.atiOverallScore) ? a.atiOverallScore : null,
        atiOverallConfidence:
          typeof a?.atiOverallConfidence === 'number' && Number.isFinite(a.atiOverallConfidence) ? a.atiOverallConfidence : null,
        atiVersion: typeof a?.atiVersion === 'string' ? a.atiVersion : null,
        atiComputedAt:
          typeof a?.atiComputedAt === 'number' && Number.isFinite(a.atiComputedAt) ? a.atiComputedAt : null,
      }));

      const filtered = filterAgentsInProcess(mapped, safeFilters);
      const start = Math.max(0, (page - 1) * pageSize);
      const end = start + pageSize;
      const paged = filtered.slice(start, end);
      return NextResponse.json({
        success: true,
        scope,
        agents: paged,
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      });
    }

    // allAgents / ens8004Subdomains: use the core search route handler (KB GraphQL-backed) for consistent filtering.
    const { searchAgentsPostRouteHandler } = await import('@agentic-trust/core/server');
    const handler = searchAgentsPostRouteHandler();

    const chainIdRaw = getString(safeFilters.chainId).trim();
    const chainId = chainIdRaw && chainIdRaw !== 'all' ? Number(chainIdRaw) : null;

    const params: Record<string, unknown> = {};
    if (chainId && Number.isFinite(chainId)) params.chains = [Math.floor(chainId)];
    if (isHexAddress(safeFilters.address.trim())) params.agentAccount = safeFilters.address.trim();
    const agentNameFilter = scope === 'ens8004Subdomains' ? '8004-agent.eth' : safeFilters.name.trim();
    if (agentNameFilter) params.agentName = agentNameFilter;
    if (safeFilters.agentIdentifierMatch.trim()) params.agentIdentifierMatch = safeFilters.agentIdentifierMatch.trim();
    if (safeFilters.protocol === 'a2a') params.a2a = true;
    if (safeFilters.protocol === 'mcp') params.mcp = true;
    const minReviews = asNumber(safeFilters.minReviews);
    if (minReviews && minReviews > 0) params.minFeedbackCount = Math.floor(minReviews);
    const minValidations = asNumber(safeFilters.minValidations);
    if (minValidations && minValidations > 0) params.minValidationCompletedCount = Math.floor(minValidations);
    const minAssociations = asNumber(safeFilters.minAssociations);
    if (minAssociations && minAssociations > 0) params.minAssociations = Math.floor(minAssociations);
    const minAvg = asNumber(safeFilters.minAvgRating);
    if (minAvg && minAvg > 0) params.minFeedbackAverageScore = minAvg;
    const minAti = asNumber(safeFilters.minAtiOverallScore);
    if (minAti && minAti > 0) params.minAtiOverallScore = Math.floor(minAti);
    const createdWithinDays = asNumber(safeFilters.createdWithinDays);
    if (createdWithinDays && createdWithinDays > 0) params.createdWithinDays = Math.floor(createdWithinDays);

    const rawPath = getString(safeFilters.path).trim();
    const query = rawPath ? rawPath : undefined;

    // For ENS subdomains, fetch a large window then paginate after post-filter.
    const delegatePage = scope === 'ens8004Subdomains' ? 1 : page;
    const delegatePageSize = scope === 'ens8004Subdomains' ? Math.max(2000, pageSize * Math.max(1, page)) : pageSize;

    const delegateReq = new Request('http://localhost/api/agents/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        page: delegatePage,
        pageSize: delegatePageSize,
        orderBy: 'createdAtTime',
        orderDirection: 'DESC',
        query,
        params: Object.keys(params).length ? params : undefined,
      }),
    });

    const delegateRes = await handler(delegateReq);
    const delegateJson = (await (delegateRes as Response).json().catch(() => null)) as any;
    if (!(delegateRes as Response).ok) {
      return NextResponse.json(
        { error: delegateJson?.error || delegateJson?.message || `Search failed (${(delegateRes as Response).status})` },
        { status: 502 },
      );
    }

    if (scope !== 'ens8004Subdomains') {
      return NextResponse.json({
        success: true,
        scope,
        agents: Array.isArray(delegateJson?.agents) ? delegateJson.agents : [],
        total: delegateJson?.total ?? 0,
        page: delegateJson?.page ?? page,
        pageSize: delegateJson?.pageSize ?? pageSize,
        totalPages: delegateJson?.totalPages ?? 1,
      });
    }

    const list = Array.isArray(delegateJson?.agents) ? (delegateJson.agents as any[]) : [];
    const filtered = filterAgentsInProcess(list, safeFilters, { ensSubdomainsOnly: true });
    const start = Math.max(0, (page - 1) * pageSize);
    const end = start + pageSize;
    const paged = filtered.slice(start, end);
    return NextResponse.json({
      success: true,
      scope,
      agents: paged,
      total: filtered.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    });
  } catch (error) {
    console.error('[api/agents/list] Error:', error);
    return NextResponse.json(
      { error: 'Failed to list agents', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

