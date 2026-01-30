import { discoverAgents } from '../../server/lib/discover';
import { getAgenticTrustClient } from '../../server/lib/agenticTrust';
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
const DEFAULT_PAGE_SIZE = 18;

function normalizeDiscoveryUrl(value) {
    const raw = (value || '').toString().trim().replace(/\/+$/, '');
    if (!raw)
        return null;
    if (/\/graphql-kb$/i.test(raw))
        return raw;
    if (/\/graphql$/i.test(raw))
        return raw.replace(/\/graphql$/i, '/graphql-kb');
    return `${raw}/graphql-kb`;
}
function parseDid8004(did8004) {
    const m = /^did:8004:(\d+):(\d+)$/.exec(did8004.trim());
    if (!m)
        return null;
    const chainId = Number(m[1]);
    const agentId8004 = Number(m[2]);
    if (!Number.isFinite(chainId) || !Number.isFinite(agentId8004))
        return null;
    return { chainId, agentId8004 };
}
async function executeKbSearch(options) {
    const endpoint = normalizeDiscoveryUrl(process.env.AGENTIC_TRUST_DISCOVERY_URL);
    if (!endpoint) {
        throw new Error('Missing required configuration: AGENTIC_TRUST_DISCOVERY_URL (expected KB endpoint)');
    }
    const apiKey = (process.env.GRAPHQL_ACCESS_CODE || process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || '').trim();
    const page = typeof options.page === 'number' && Number.isFinite(options.page) ? options.page : 1;
    const pageSize = typeof options.pageSize === 'number' && Number.isFinite(options.pageSize) && options.pageSize > 0
        ? options.pageSize
        : DEFAULT_PAGE_SIZE;
    const skip = Math.max(0, (Math.max(page, 1) - 1) * pageSize);
    const params = options.params ?? {};
    const where = {};
    if (Array.isArray(params.chains) && params.chains.length === 1) {
        const v = Number(params.chains[0]);
        if (Number.isFinite(v))
            where.chainId = Math.floor(v);
    }
    const agentIdRaw = typeof params.agentId === 'string' ? params.agentId.trim() : '';
    if (agentIdRaw && typeof where.chainId === 'number') {
        const n = Number(agentIdRaw);
        if (Number.isFinite(n))
            where.agentId8004 = Math.floor(n);
    }
    const agentNameRaw = typeof params.agentName === 'string' ? params.agentName.trim() : '';
    if (agentNameRaw)
        where.agentName_contains = agentNameRaw;
    const minFeedbackCount = params.minFeedbackCount;
    if (typeof minFeedbackCount === 'number' && Number.isFinite(minFeedbackCount) && minFeedbackCount > 0) {
        where.minFeedbackAssertionCount8004 = Math.floor(minFeedbackCount);
        where.hasFeedback8004 = true;
    }
    const minValidationCompletedCount = params.minValidationCompletedCount;
    if (typeof minValidationCompletedCount === 'number' &&
        Number.isFinite(minValidationCompletedCount) &&
        minValidationCompletedCount > 0) {
        where.minValidationAssertionCount8004 = Math.floor(minValidationCompletedCount);
        where.hasValidation8004 = true;
    }
    const orderBy = 'agentId8004';
    const orderDirection = 'DESC';
    const query = `
    query SearchKbAgents($where: KbAgentWhereInput, $first: Int, $skip: Int, $orderBy: KbAgentOrderBy, $orderDirection: OrderDirection) {
      kbAgents(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
        total
        hasMore
        agents {
          uaid
          did8004
          agentId8004
          agentName
          createdAtTime
          createdAtBlock
          updatedAtTime
          assertionsFeedback8004 { total }
          assertionsValidation8004 { total }
        }
      }
    }
  `;
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
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(json?.error || json?.message || `KB search failed (${res.status})`);
    }
    if (json?.errors?.length) {
        throw new Error(json.errors?.[0]?.message || 'KB search failed (GraphQL error)');
    }
    const data = json?.data ?? {};
    const payload = data.kbAgents;
    const list = Array.isArray(payload?.agents) ? payload?.agents : [];
    const total = typeof payload?.total === 'number' && Number.isFinite(payload.total) ? payload.total : list.length;
    const agents = list.map((a) => {
        const did8004 = typeof a?.did8004 === 'string' ? a.did8004 : '';
        const parsed = did8004 ? parseDid8004(did8004) : null;
        const feedbackCountRaw = a?.assertionsFeedback8004?.total;
        const validationCountRaw = a?.assertionsValidation8004?.total;
        const feedbackCount = typeof feedbackCountRaw === 'number' && Number.isFinite(feedbackCountRaw)
            ? Math.max(0, feedbackCountRaw)
            : 0;
        const validationCompletedCount = typeof validationCountRaw === 'number' && Number.isFinite(validationCountRaw)
            ? Math.max(0, validationCountRaw)
            : 0;
        return {
            uaid: typeof a?.uaid === 'string' ? a.uaid : null,
            chainId: parsed?.chainId ?? null,
            agentId: parsed ? String(parsed.agentId8004) : (a?.agentId8004 != null ? String(a.agentId8004) : null),
            createdAtTime: typeof a?.createdAtTime === 'number' ? a.createdAtTime : null,
            agentAccount: '',
            agentIdentityOwnerAccount: '',
            agentName: typeof a?.agentName === 'string' ? a.agentName : null,
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
    };
}
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
    const params = options.params ?? {};
    const hasTextQuery = typeof options.query === 'string' && options.query.trim().length > 0;
    const requestsUnsupported = hasTextQuery ||
        typeof params.agentAccount === 'string' ||
        typeof params.minAssociations === 'number' ||
        typeof params.minFeedbackAverageScore === 'number' ||
        typeof params.minAtiOverallScore === 'number' ||
        typeof params.createdWithinDays === 'number' ||
        typeof params.a2a === 'boolean' ||
        typeof params.mcp === 'boolean';
    const result = !requestsUnsupported
        ? await executeKbSearch(options)
        : await discoverAgents(options, getAgenticTrustClient);
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
                initiated: sample.initiatedAssociationCount,
                approved: sample.approvedAssociationCount,
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
            const requestedPage = page ?? 1;
            const requestedPageSize = pageSize;
            const minAssociations = params && typeof params.minAssociations === 'number' && Number.isFinite(params.minAssociations)
                ? params.minAssociations
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
            const filtered = agents.filter((a) => {
                const initiated = typeof a?.initiatedAssociationCount === 'number' ? a.initiatedAssociationCount : 0;
                const approved = typeof a?.approvedAssociationCount === 'number' ? a.approvedAssociationCount : 0;
                return initiated + approved >= minAssociations;
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
            const requestedPage = page ?? 1;
            const requestedPageSize = pageSize;
            const minAssociations = params && typeof params.minAssociations === 'number' && Number.isFinite(params.minAssociations)
                ? params.minAssociations
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
            const filtered = agents.filter((a) => {
                const initiated = typeof a?.initiatedAssociationCount === 'number' ? a.initiatedAssociationCount : 0;
                const approved = typeof a?.approvedAssociationCount === 'number' ? a.approvedAssociationCount : 0;
                return initiated + approved >= minAssociations;
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
            const rawIntentJson = typeof body.intentJson === 'string'
                ? body.intentJson
                : typeof body.intent === 'string'
                    ? body.intent
                    : '';
            const intentJson = rawIntentJson.trim();
            const topKRaw = body.topK;
            const topK = typeof topKRaw === 'number' && Number.isFinite(topKRaw) && topKRaw > 0
                ? Math.floor(topKRaw)
                : typeof topKRaw === 'string' && topKRaw.trim()
                    ? Math.max(1, Math.floor(Number(topKRaw)))
                    : undefined;
            const rawText = typeof body.text === 'string'
                ? body.text
                : typeof body.query === 'string'
                    ? body.query
                    : '';
            const text = rawText.trim();
            if (!text && !intentJson) {
                return jsonResponse({
                    success: true,
                    total: 0,
                    matches: [],
                });
            }
            const discoveryClient = await getDiscoveryClient();
            const result = await discoveryClient.semanticAgentSearch(intentJson ? { intentJson, topK } : { text });
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