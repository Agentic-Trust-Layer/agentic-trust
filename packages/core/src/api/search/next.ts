import { discoverAgents, type DiscoverRequest, type DiscoverResponse } from '../../server/lib/discover';
import { getAgenticTrustClient } from '../../server/lib/agenticTrust';
import { getDiscoveryClient } from '../../server/singletons/discoveryClient';

const hasNativeResponse =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as Record<string, unknown>).Response === 'function';

function jsonResponse(body: unknown, status = 200) {
  if (hasNativeResponse) {
    const ResponseCtor = (globalThis as Record<string, any>).Response;
    return new ResponseCtor(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  return {
    status,
    body,
    headers: { 'content-type': 'application/json' },
  } as unknown;
}

function handleError(error: unknown) {
  // eslint-disable-next-line no-console
  console.error('[AgenticTrust][Search][Next] Unexpected error:', error);
  return jsonResponse(
    {
      error: 'Failed to search agents',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
    },
    500,
  );
}

const DEFAULT_PAGE_SIZE = 18;

function normalizeDiscoveryUrl(value: string | undefined | null): string | null {
  const raw = (value || '').toString().trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (/\/graphql-kb$/i.test(raw)) return raw;
  if (/\/graphql$/i.test(raw)) return raw.replace(/\/graphql$/i, '/graphql-kb');
  return `${raw}/graphql-kb`;
}

function parseDid8004(did8004: string): { chainId: number; agentId8004: number } | null {
  const m = /^did:8004:(\d+):(\d+)$/.exec(did8004.trim());
  if (!m) return null;
  const chainId = Number(m[1]);
  const agentId8004 = Number(m[2]);
  if (!Number.isFinite(chainId) || !Number.isFinite(agentId8004)) return null;
  return { chainId, agentId8004 };
}

type KbAgentsResponse = {
  kbAgents?: {
    total?: number | null;
    hasMore?: boolean | null;
    agents?: Array<{
      uaid?: string | null;
      agentName?: string | null;
      agentDescription?: string | null;
      agentImage?: string | null;
      createdAtTime?: number | null;
      createdAtBlock?: number | null;
      updatedAtTime?: number | null;
      identity8004?: { did?: string | null } | null;
      assertions?: {
        reviewResponses?: { total?: number | null } | null;
        validationResponses?: { total?: number | null } | null;
        total?: number | null;
      } | null;
    }> | null;
  } | null;
};

async function executeKbSearch(options: DiscoverRequest): Promise<SearchResultPayload> {
  const endpoint = normalizeDiscoveryUrl(process.env.AGENTIC_TRUST_DISCOVERY_URL);
  if (!endpoint) {
    throw new Error('Missing required configuration: AGENTIC_TRUST_DISCOVERY_URL (expected KB endpoint)');
  }

  const apiKey =
    (process.env.GRAPHQL_ACCESS_CODE || process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || '').trim();

  const page = typeof options.page === 'number' && Number.isFinite(options.page) ? options.page : 1;
  const pageSize =
    typeof options.pageSize === 'number' && Number.isFinite(options.pageSize) && options.pageSize > 0
      ? options.pageSize
      : DEFAULT_PAGE_SIZE;
  const skip = Math.max(0, (Math.max(page, 1) - 1) * pageSize);

  const params = (options.params ?? {}) as Record<string, unknown>;
  const where: Record<string, unknown> = {};

  // chains => chainId (only support a single chain filter; otherwise search across all chains)
  if (Array.isArray((params as any).chains) && (params as any).chains.length === 1) {
    const v = Number((params as any).chains[0]);
    if (Number.isFinite(v)) where.chainId = Math.floor(v);
  }

  // agentIdentifierMatch => KB-native matching (preferred over agentId8004)
  const agentIdentifierMatchRaw =
    typeof (params as any).agentIdentifierMatch === 'string' ? (params as any).agentIdentifierMatch.trim() : '';
  if (agentIdentifierMatchRaw) {
    where.agentIdentifierMatch = agentIdentifierMatchRaw;
    // KB convention: chainId=295 represents "Hashgraph Online".
    // When agentIdentifierMatch is used without an explicit chain selection, default to chainId=295
    // so agent-id searches work without requiring the user to pick a chain.
    if (typeof where.chainId !== 'number') {
      where.chainId = 295;
    }
  }

  // agentName => agentName_contains
  const agentNameRaw = typeof (params as any).agentName === 'string' ? (params as any).agentName.trim() : '';
  if (agentNameRaw) where.agentName_contains = agentNameRaw;

  // Numeric assertion minimums (KB v2: review/validation, no 8004 suffix)
  const minFeedbackCount = (params as any).minFeedbackCount;
  if (typeof minFeedbackCount === 'number' && Number.isFinite(minFeedbackCount) && minFeedbackCount > 0) {
    where.minReviewAssertionCount = Math.floor(minFeedbackCount);
    where.hasReviews = true;
  }
  const minValidationCompletedCount = (params as any).minValidationCompletedCount;
  if (
    typeof minValidationCompletedCount === 'number' &&
    Number.isFinite(minValidationCompletedCount) &&
    minValidationCompletedCount > 0
  ) {
    where.minValidationAssertionCount = Math.floor(minValidationCompletedCount);
    where.hasValidations = true;
  }

  // KB ordering (stable): default newest agents first.
  const rawOrderBy = typeof (options as any).orderBy === 'string' ? String((options as any).orderBy).trim() : '';
  const orderBy = (
    rawOrderBy === 'createdAtTime' ||
    rawOrderBy === 'updatedAtTime' ||
    rawOrderBy === 'uaid' ||
    rawOrderBy === 'agentName' ||
    rawOrderBy === 'agentId8004'
      ? rawOrderBy
      : 'createdAtTime'
  ) as 'createdAtTime' | 'updatedAtTime' | 'uaid' | 'agentName' | 'agentId8004';

  const rawOrderDirection =
    typeof (options as any).orderDirection === 'string' ? String((options as any).orderDirection).trim().toUpperCase() : '';
  const orderDirection = rawOrderDirection === 'ASC' ? 'ASC' : 'DESC';

  if (process.env.NODE_ENV === 'development') {
    console.log('[AgenticTrust][Search][KB] where:', JSON.stringify(where, null, 2));
  }

  const query = `
    query SearchKbAgents($where: KbAgentWhereInput, $first: Int, $skip: Int, $orderBy: KbAgentOrderBy, $orderDirection: OrderDirection) {
      kbAgents(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
        total
        hasMore
        agents {
          uaid
          agentName
          agentDescription
          agentImage
          createdAtTime
          createdAtBlock
          updatedAtTime
          identity8004 { did }
          assertions { reviewResponses { total } validationResponses { total } total }
        }
      }
    }
  `;

  if (process.env.NODE_ENV === 'development') {
    console.log('[AgenticTrust][Search][KB] endpoint:', endpoint);
    console.log('[AgenticTrust][Search][KB] variables:', JSON.stringify({
      where: Object.keys(where).length ? where : undefined,
      first: pageSize,
      skip,
      orderBy,
      orderDirection,
    }, null, 2));
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      query,
      variables: {
        where: Object.keys(where).length ? where : undefined,
        first: pageSize,
        skip,
        orderBy,
        orderDirection,
      },
    }),
  });

  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    throw new Error(json?.error || json?.message || `KB search failed (${res.status})`);
  }
  if (json?.errors?.length) {
    throw new Error(json.errors?.[0]?.message || 'KB search failed (GraphQL error)');
  }

  const data = (json?.data ?? {}) as KbAgentsResponse;
  const payload = data.kbAgents;
  const list = Array.isArray(payload?.agents) ? payload?.agents : [];
  const total =
    typeof payload?.total === 'number' && Number.isFinite(payload.total) ? payload.total : list.length;

  if (process.env.NODE_ENV === 'development') {
    const counts = new Map<string, number>();
    for (const a of list) {
      const u = typeof (a as any)?.uaid === 'string' ? String((a as any).uaid).trim() : '';
      if (!u) continue;
      counts.set(u, (counts.get(u) ?? 0) + 1);
    }
    const dupes = Array.from(counts.entries())
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([uaid, count]) => ({ uaid, count }));
    if (dupes.length > 0) {
      console.log('[AgenticTrust][Search][KB] duplicate uaid values (raw KB page):', {
        duplicates: dupes,
        uniqueUaidCount: counts.size,
        returnedAgentsCount: list.length,
      });
    }
  }

  const agents = list.map((a) => {
    const did8004Raw = typeof (a as any)?.identity8004?.did === 'string' ? (a as any).identity8004.did : '';
    const did8004 = did8004Raw ? did8004Raw : '';
    const parsed = did8004 ? parseDid8004(did8004) : null;
    const chainIdFromWhere = typeof where.chainId === 'number' ? where.chainId : null;
    const chainId = parsed?.chainId ?? chainIdFromWhere;

    const agentIdFromUaid = (() => {
      const uaid = typeof a?.uaid === 'string' ? a.uaid : '';
      if (!uaid) return null;
      // Prefer nativeId=... if present (more human-readable than full UAID)
      const marker = ';nativeId=';
      const idx = uaid.indexOf(marker);
      if (idx === -1) return uaid;
      const start = idx + marker.length;
      const tail = uaid.slice(start);
      const end = tail.indexOf(';');
      const nativeId = (end === -1 ? tail : tail.slice(0, end)).trim();
      return nativeId || uaid;
    })();

    const feedbackCountRaw = a?.assertions?.reviewResponses?.total;
    const validationCountRaw = a?.assertions?.validationResponses?.total;
    const feedbackCount =
      typeof feedbackCountRaw === 'number' && Number.isFinite(feedbackCountRaw) ? Math.max(0, feedbackCountRaw) : 0;
    const validationCompletedCount =
      typeof validationCountRaw === 'number' && Number.isFinite(validationCountRaw)
        ? Math.max(0, validationCountRaw)
        : 0;

    return {
      uaid: typeof a?.uaid === 'string' ? a.uaid : null,
      chainId,
      agentId: parsed
        ? String(parsed.agentId8004)
        : agentIdFromUaid,
      createdAtTime: typeof a?.createdAtTime === 'number' ? a.createdAtTime : null,
      agentAccount: '',
      agentIdentityOwnerAccount: '',
      agentName: typeof a?.agentName === 'string' ? a.agentName : null,
      description: typeof a?.agentDescription === 'string' ? a.agentDescription : null,
      image: typeof a?.agentImage === 'string' ? a.agentImage : null,
      didIdentity: did8004 || null,
      createdAtBlock: typeof a?.createdAtBlock === 'number' ? a.createdAtBlock : 0,
      updatedAtTime: typeof a?.updatedAtTime === 'number' ? a.updatedAtTime : null,
      agentCardReadAt: null,
      did: did8004 || null,
      mcp: false,
      active: true,
      feedbackCount,
      feedbackAverageScore: null,
      validationPendingCount: 0,
      validationCompletedCount,
      validationRequestedCount: 0,
      initiatedAssociationCount: null,
      approvedAssociationCount: null,
      atiOverallScore: null,
      atiOverallConfidence: null,
      atiComputedAt: null,
      trustLedgerScore: null,
      trustLedgerBadgeCount: null,
      trustLedgerOverallRank: null,
      trustLedgerCapabilityRank: null,
    };
  });

  return {
    agents,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize))),
  } as any;
}

function toNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type SearchResultPayload = DiscoverResponse;

function mapAgentsResponse(data: SearchResultPayload) {
  const { agents = [], total, page, pageSize, totalPages } = data;

  return {
    success: true,
    agents,
    total,
    page: page ?? 1,
    pageSize: pageSize ?? agents.length,
    totalPages:
      totalPages ??
      Math.max(
        1,
        Math.ceil((total ?? agents.length) / (pageSize ?? Math.max(agents.length, 1))),
      ),
  };
}

function parseParamsParam(raw: string | null): DiscoverRequest['params'] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as DiscoverRequest['params']) : undefined;
  } catch {
    return undefined;
  }
}

async function executeSearch(options: DiscoverRequest): Promise<SearchResultPayload> {
  console.log('[AgenticTrust][Search] Executing search with options:', JSON.stringify(options, null, 2));
  // Root cause fix:
  // The UI's "Min reviews / Min validations" are KB-native (kbAgents) filters.
  // The legacy discoverAgents() path is D1-backed and returns different totals/counts.
  const params = (options.params ?? {}) as Record<string, unknown>;
  const hasTextQuery = typeof options.query === 'string' && options.query.trim().length > 0;
  const requestsUnsupported =
    hasTextQuery ||
    typeof (params as any).agentAccount === 'string' ||
    typeof (params as any).minAssociations === 'number' ||
    typeof (params as any).minFeedbackAverageScore === 'number' ||
    typeof (params as any).minAtiOverallScore === 'number' ||
    typeof (params as any).createdWithinDays === 'number' ||
    typeof (params as any).a2a === 'boolean' ||
    typeof (params as any).mcp === 'boolean';

  const result =
    !requestsUnsupported
      ? await executeKbSearch(options)
      : await discoverAgents(options, getAgenticTrustClient);

  console.log('[AgenticTrust][Search] Result summary:', {
    agentsLength: Array.isArray(result.agents) ? result.agents.length : 0,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    agentUaidSample: Array.isArray(result.agents)
      ? result.agents.slice(0, 25).map((a: any) => a?.uaid).filter(Boolean)
      : [],
  });
  
  // Log sample validation counts if agents found
  if (result.agents && result.agents.length > 0) {
    const sample = result.agents[0];
    if (sample) {
      console.log('[AgenticTrust][Search] First agent result validation stats:', {
        id: sample.agentId,
        pending: sample.validationPendingCount,
        completed: sample.validationCompletedCount,
        requested: sample.validationRequestedCount
      });
      console.log('[AgenticTrust][Search] First agent result association stats:', {
        id: sample.agentId,
        initiated: (sample as any).initiatedAssociationCount,
        approved: (sample as any).approvedAssociationCount,
      });
    }
  }
  
  return result;
}

export function searchAgentsGetRouteHandler() {
  return async (req: Request) => {
    try {
      const url = new URL(req.url);
      const urlParams = url.searchParams;

      const page = toNumber(urlParams.get('page'));
      const pageSize = toNumber(urlParams.get('pageSize')) ?? DEFAULT_PAGE_SIZE;
      const query = urlParams.get('query')?.trim();
      const params = parseParamsParam(urlParams.get('params'));
      const orderBy = urlParams.get('orderBy')?.trim() || undefined;
      const orderDirectionRaw = urlParams.get('orderDirection')?.trim().toUpperCase();
      const orderDirection =
        orderDirectionRaw === 'ASC' || orderDirectionRaw === 'DESC'
          ? (orderDirectionRaw as 'ASC' | 'DESC')
          : undefined;

      const requestedPage = page ?? 1;
      const requestedPageSize = pageSize;

      const minAssociations =
        params && typeof (params as any).minAssociations === 'number' && Number.isFinite((params as any).minAssociations)
          ? (params as any).minAssociations
          : undefined;

      const needsAssocFilter = typeof minAssociations === 'number' && minAssociations > 0;

      const response = await executeSearch({
        page: needsAssocFilter ? 1 : requestedPage,
        pageSize: needsAssocFilter ? Math.max(2000, requestedPageSize) : requestedPageSize,
        query: query && query.length > 0 ? query : undefined,
        params,
        orderBy,
        orderDirection,
      });

      if (!needsAssocFilter) {
        const payload = mapAgentsResponse(response);
        if (process.env.NODE_ENV === 'development') {
          return jsonResponse({
            ...payload,
            debug: {
              request: {
                page: requestedPage,
                pageSize: requestedPageSize,
                query: query && query.length > 0 ? query : undefined,
                params: params ?? undefined,
                orderBy,
                orderDirection,
              },
              response: {
                agentsLength: Array.isArray(payload.agents) ? payload.agents.length : 0,
                total: payload.total,
                page: payload.page,
                pageSize: payload.pageSize,
                totalPages: payload.totalPages,
              },
            },
          });
        }
        return jsonResponse(payload);
      }

      const agents = Array.isArray(response.agents) ? response.agents : [];
      const filtered = agents.filter((a: any) => {
        const initiated = typeof a?.initiatedAssociationCount === 'number' ? a.initiatedAssociationCount : 0;
        const approved = typeof a?.approvedAssociationCount === 'number' ? a.approvedAssociationCount : 0;
        return initiated + approved >= (minAssociations as number);
      });

      const start = Math.max(0, (requestedPage - 1) * requestedPageSize);
      const end = start + requestedPageSize;
      const paged = filtered.slice(start, end);

      return jsonResponse({
        success: true,
        agents: paged,
        total: filtered.length,
        page: requestedPage,
        pageSize: requestedPageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / Math.max(1, requestedPageSize))),
      });
    } catch (error) {
      return handleError(error);
    }
  };
}

export function searchAgentsPostRouteHandler() {
  return async (req: Request) => {
    try {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

      const page =
        typeof body.page === 'number' && Number.isFinite(body.page)
          ? (body.page as number)
          : undefined;
      const pageSize =
        typeof body.pageSize === 'number' && Number.isFinite(body.pageSize as number)
          ? (body.pageSize as number)
          : DEFAULT_PAGE_SIZE;
      const query =
        typeof body.query === 'string' && (body.query as string).trim().length > 0
          ? (body.query as string).trim()
          : undefined;
      const params =
        body.params && typeof body.params === 'object'
          ? (body.params as DiscoverRequest['params'])
          : undefined;
      const orderBy =
        typeof body.orderBy === 'string' && (body.orderBy as string).trim().length > 0
          ? (body.orderBy as string).trim()
          : undefined;
      const orderDirectionRaw =
        typeof body.orderDirection === 'string'
          ? (body.orderDirection as string).toUpperCase()
          : undefined;
      const orderDirection =
        orderDirectionRaw === 'ASC' || orderDirectionRaw === 'DESC'
          ? (orderDirectionRaw as 'ASC' | 'DESC')
          : undefined;

      const requestedPage = page ?? 1;
      const requestedPageSize = pageSize;

      const minAssociations =
        params && typeof (params as any).minAssociations === 'number' && Number.isFinite((params as any).minAssociations)
          ? (params as any).minAssociations
          : undefined;
      const needsAssocFilter = typeof minAssociations === 'number' && minAssociations > 0;

      const response = await executeSearch({
        page: needsAssocFilter ? 1 : requestedPage,
        pageSize: needsAssocFilter ? Math.max(2000, requestedPageSize) : requestedPageSize,
        query,
        params,
        orderBy,
        orderDirection,
      });

      if (!needsAssocFilter) {
        const payload = mapAgentsResponse(response);
        if (process.env.NODE_ENV === 'development') {
          return jsonResponse({
            ...payload,
            debug: {
              request: {
                page: requestedPage,
                pageSize: requestedPageSize,
                query,
                params: params ?? undefined,
                orderBy,
                orderDirection,
              },
              response: {
                agentsLength: Array.isArray(payload.agents) ? payload.agents.length : 0,
                total: payload.total,
                page: payload.page,
                pageSize: payload.pageSize,
                totalPages: payload.totalPages,
              },
            },
          });
        }
        return jsonResponse(payload);
      }

      const agents = Array.isArray(response.agents) ? response.agents : [];
      const filtered = agents.filter((a: any) => {
        const initiated = typeof a?.initiatedAssociationCount === 'number' ? a.initiatedAssociationCount : 0;
        const approved = typeof a?.approvedAssociationCount === 'number' ? a.approvedAssociationCount : 0;
        return initiated + approved >= (minAssociations as number);
      });

      const start = Math.max(0, (requestedPage - 1) * requestedPageSize);
      const end = start + requestedPageSize;
      const paged = filtered.slice(start, end);

      return jsonResponse({
        success: true,
        agents: paged,
        total: filtered.length,
        page: requestedPage,
        pageSize: requestedPageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / Math.max(1, requestedPageSize))),
      });
    } catch (error) {
      return handleError(error);
    }
  };
}

export function semanticAgentSearchPostRouteHandler() {
  return async (req: Request) => {
    try {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

      const rawIntentJson =
        typeof body.intentJson === 'string'
          ? (body.intentJson as string)
          : typeof body.intent === 'string'
            ? (body.intent as string)
            : '';

      const intentJson = rawIntentJson.trim();

      const topKRaw = body.topK;
      const topK =
        typeof topKRaw === 'number' && Number.isFinite(topKRaw) && topKRaw > 0
          ? Math.floor(topKRaw)
          : typeof topKRaw === 'string' && topKRaw.trim()
            ? Math.max(1, Math.floor(Number(topKRaw)))
            : undefined;

      const rawText =
        typeof body.text === 'string'
          ? (body.text as string)
          : typeof body.query === 'string'
            ? (body.query as string)
            : '';

      const text = rawText.trim();

      // Extract optional skill filters (for backend to use in filtering)
      const requiredSkills =
        Array.isArray(body.requiredSkills) && body.requiredSkills.length > 0
          ? (body.requiredSkills as string[])
          : undefined;
      const intentType =
        typeof body.intentType === 'string' && body.intentType.trim()
          ? (body.intentType as string).trim()
          : undefined;

      if (!text && !intentJson) {
        return jsonResponse({
          success: true,
          total: 0,
          matches: [],
        });
      }

      const searchParams = intentJson
        ? { intentJson, topK, requiredSkills, intentType }
        : { text, topK };
      
      console.log('[semantic-search] Request params:', JSON.stringify(searchParams, null, 2));
      
      const discoveryClient = await getDiscoveryClient();
      const result = await (discoveryClient as any).semanticAgentSearch(searchParams);

      const total =
        result && typeof result.total === 'number' && Number.isFinite(result.total)
          ? result.total
          : 0;

      const matches = Array.isArray(result?.matches) ? result.matches : [];

      return jsonResponse({
        success: true,
        total,
        matches,
      });
    } catch (error) {
      return handleError(error);
    }
  };
}


