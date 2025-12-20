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

const DEFAULT_PAGE_SIZE = 10;

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
  const result = await discoverAgents(options, getAgenticTrustClient);
  
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
        return jsonResponse(mapAgentsResponse(response));
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
        return jsonResponse(mapAgentsResponse(response));
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

      const rawText =
        typeof body.text === 'string'
          ? (body.text as string)
          : typeof body.query === 'string'
            ? (body.query as string)
            : '';

      const text = rawText.trim();

      if (!text) {
        return jsonResponse({
          success: true,
          total: 0,
          matches: [],
        });
      }

      const discoveryClient = await getDiscoveryClient();
      const result = await (discoveryClient as any).semanticAgentSearch({ text });

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


