import { discoverAgents } from '../../server/lib/discover';
import { getAgenticTrustClient } from '../../server/lib/agenticTrust';
import { getDiscoveryClient } from '../../server/singletons/discoveryClient';
const hasNativeResponse = typeof globalThis !== 'undefined' &&
    typeof globalThis.Response === 'function';
function jsonResponse(body, status = 200) {
    if (hasNativeResponse) {
        const ResponseCtor = globalThis.Response;
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
    };
}
function handleError(error) {
    // eslint-disable-next-line no-console
    console.error('[AgenticTrust][Search][Next] Unexpected error:', error);
    return jsonResponse({
        error: 'Failed to search agents',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
    }, 500);
}
const DEFAULT_PAGE_SIZE = 10;
function toNumber(value) {
    if (!value)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function mapAgentsResponse(data) {
    const { agents = [], total, page, pageSize, totalPages } = data;
    return {
        success: true,
        agents,
        total,
        page: page ?? 1,
        pageSize: pageSize ?? agents.length,
        totalPages: totalPages ??
            Math.max(1, Math.ceil((total ?? agents.length) / (pageSize ?? Math.max(agents.length, 1)))),
    };
}
function parseParamsParam(raw) {
    if (!raw)
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
async function executeSearch(options) {
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
        }
    }
    return result;
}
export function searchAgentsGetRouteHandler() {
    return async (req) => {
        try {
            const url = new URL(req.url);
            const urlParams = url.searchParams;
            const page = toNumber(urlParams.get('page'));
            const pageSize = toNumber(urlParams.get('pageSize')) ?? DEFAULT_PAGE_SIZE;
            const query = urlParams.get('query')?.trim();
            const params = parseParamsParam(urlParams.get('params'));
            const orderBy = urlParams.get('orderBy')?.trim() || undefined;
            const orderDirectionRaw = urlParams.get('orderDirection')?.trim().toUpperCase();
            const orderDirection = orderDirectionRaw === 'ASC' || orderDirectionRaw === 'DESC'
                ? orderDirectionRaw
                : undefined;
            const response = await executeSearch({
                page,
                pageSize,
                query: query && query.length > 0 ? query : undefined,
                params,
                orderBy,
                orderDirection,
            });
            return jsonResponse(mapAgentsResponse(response));
        }
        catch (error) {
            return handleError(error);
        }
    };
}
export function searchAgentsPostRouteHandler() {
    return async (req) => {
        try {
            const body = (await req.json().catch(() => ({})));
            const page = typeof body.page === 'number' && Number.isFinite(body.page)
                ? body.page
                : undefined;
            const pageSize = typeof body.pageSize === 'number' && Number.isFinite(body.pageSize)
                ? body.pageSize
                : DEFAULT_PAGE_SIZE;
            const query = typeof body.query === 'string' && body.query.trim().length > 0
                ? body.query.trim()
                : undefined;
            const params = body.params && typeof body.params === 'object'
                ? body.params
                : undefined;
            const orderBy = typeof body.orderBy === 'string' && body.orderBy.trim().length > 0
                ? body.orderBy.trim()
                : undefined;
            const orderDirectionRaw = typeof body.orderDirection === 'string'
                ? body.orderDirection.toUpperCase()
                : undefined;
            const orderDirection = orderDirectionRaw === 'ASC' || orderDirectionRaw === 'DESC'
                ? orderDirectionRaw
                : undefined;
            const response = await executeSearch({
                page,
                pageSize,
                query,
                params,
                orderBy,
                orderDirection,
            });
            return jsonResponse(mapAgentsResponse(response));
        }
        catch (error) {
            return handleError(error);
        }
    };
}
export function semanticAgentSearchPostRouteHandler() {
    return async (req) => {
        try {
            const body = (await req.json().catch(() => ({})));
            const rawText = typeof body.text === 'string'
                ? body.text
                : typeof body.query === 'string'
                    ? body.query
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
            const result = await discoveryClient.semanticAgentSearch({ text });
            const total = result && typeof result.total === 'number' && Number.isFinite(result.total)
                ? result.total
                : 0;
            const matches = Array.isArray(result?.matches) ? result.matches : [];
            return jsonResponse({
                success: true,
                total,
                matches,
            });
        }
        catch (error) {
            return handleError(error);
        }
    };
}
//# sourceMappingURL=next.js.map