/**
 * Reusable API-layer helper for agent discovery suitable for Next.js route handlers.
 * Parses common search options and maps core Agent objects into a flat JSON
 * payload that UIs can consume directly.
 */
import { DEFAULT_CHAIN_ID } from './chainConfig';
/**
 * Execute an agents search via the core client and map to a flat API payload.
 *
 * @param req Parsed discovery parameters (page/pageSize/query/params/order*)
 * @param getClient Function returning an initialized AgenticTrustClient (app-specific)
 */
export async function discoverAgents(req, getClient) {
    const client = await getClient();
    const options = {
        page: typeof req.page === 'number' ? req.page : undefined,
        pageSize: typeof req.pageSize === 'number' ? req.pageSize : undefined,
        query: typeof req.query === 'string' && req.query.trim().length > 0 ? req.query.trim() : undefined,
        params: req.params,
        orderBy: req.orderBy,
        orderDirection: req.orderDirection,
    };
    const { agents, total, page, pageSize, totalPages } = await client.searchAgents(options);
    const mapped = {
        agents: (agents || []).map((agent) => {
            const raw = agent && typeof agent.data === 'object'
                ? agent.data
                : agent;
            const numeric = (value, fallback) => {
                if (value === undefined || value === null)
                    return fallback ?? null;
                const converted = Number(value);
                return Number.isFinite(converted) ? converted : fallback ?? null;
            };
            const booleanish = (value) => {
                if (value === undefined)
                    return undefined;
                if (value === null)
                    return null;
                return Boolean(value);
            };
            const stringOrNull = (value) => {
                if (value === undefined)
                    return undefined;
                if (value === null)
                    return null;
                return String(value);
            };
            const chainId = numeric(raw?.chainId, DEFAULT_CHAIN_ID) ?? DEFAULT_CHAIN_ID;
            // Extract MCP endpoint from registration data
            let mcpEndpoint = undefined;
            try {
                // First try to extract from rawJson if available
                const rawJsonStr = stringOrNull(raw?.rawJson);
                if (rawJsonStr) {
                    try {
                        const registration = JSON.parse(rawJsonStr);
                        if (registration?.endpoints && Array.isArray(registration.endpoints)) {
                            const mcpEndpointEntry = registration.endpoints.find((ep) => ep && typeof ep.name === 'string' && (ep.name === 'MCP' || ep.name === 'mcp'));
                            if (mcpEndpointEntry && typeof mcpEndpointEntry.endpoint === 'string') {
                                mcpEndpoint = mcpEndpointEntry.endpoint;
                            }
                        }
                    }
                    catch {
                        // Ignore JSON parse errors
                    }
                }
                // If not found in rawJson, try to extract from endpoints array if available
                if (!mcpEndpoint && raw?.endpoints && Array.isArray(raw.endpoints)) {
                    const mcpEndpointEntry = raw.endpoints.find((ep) => ep && typeof ep.name === 'string' && (ep.name === 'MCP' || ep.name === 'mcp'));
                    if (mcpEndpointEntry && typeof mcpEndpointEntry.endpoint === 'string') {
                        mcpEndpoint = mcpEndpointEntry.endpoint;
                    }
                }
            }
            catch {
                // Ignore errors in MCP endpoint extraction
            }
            // Extract agentCategory from metadata if available
            let agentCategory = undefined;
            try {
                // Check if metadata is available as an object
                if (raw?.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
                    agentCategory = stringOrNull(raw.metadata?.agentCategory);
                }
                // Also check if agentCategory is directly on raw (from GraphQL normalization)
                if (!agentCategory) {
                    agentCategory = stringOrNull(raw?.agentCategory);
                }
            }
            catch {
                // Ignore errors in agentCategory extraction
            }
            return {
                chainId,
                agentId: stringOrNull(raw?.agentId) ?? '',
                createdAtTime: numeric(raw?.createdAtTime, 0) ?? 0,
                agentAccount: String(raw?.agentAccount ?? ''),
                agentOwner: String(raw?.agentOwner ?? ''),
                eoaOwner: stringOrNull(raw?.eoaOwner ??
                    raw?.eoa_owner ??
                    raw?.eoaAddress ??
                    raw?.eoa_address) ?? undefined,
                contractAddress: stringOrNull(raw?.contractAddress) ?? undefined,
                agentName: String(raw?.agentName ?? ''),
                agentCategory: agentCategory, // Add extracted agentCategory
                didIdentity: stringOrNull(raw?.didIdentity) ?? undefined,
                didAccount: stringOrNull(raw?.didAccount) ?? undefined,
                didName: stringOrNull(raw?.didName) ?? undefined,
                tokenUri: stringOrNull(raw?.tokenUri) ?? undefined,
                createdAtBlock: numeric(raw?.createdAtBlock, 0) ?? 0,
                updatedAtTime: numeric(raw?.updatedAtTime, null),
                type: stringOrNull(raw?.type) ?? undefined,
                description: stringOrNull(raw?.description) ?? undefined,
                image: stringOrNull(raw?.image) ?? undefined,
                a2aEndpoint: stringOrNull(raw?.a2aEndpoint) ?? undefined,
                ensEndpoint: stringOrNull(raw?.ensEndpoint) ?? undefined,
                agentAccountEndpoint: stringOrNull(raw?.agentAccountEndpoint) ?? undefined,
                mcpEndpoint: mcpEndpoint, // Add extracted MCP endpoint
                supportedTrust: stringOrNull(raw?.supportedTrust) ?? undefined,
                rawJson: stringOrNull(raw?.rawJson) ?? undefined,
                did: stringOrNull(raw?.did) ?? undefined,
                mcp: booleanish(raw?.mcp) ?? undefined,
                x402support: booleanish(raw?.x402support) ?? undefined,
                active: booleanish(raw?.active) ?? undefined,
                // Aggregated metrics
                feedbackCount: numeric(raw?.feedbackCount, 0),
                feedbackAverageScore: numeric(raw?.feedbackAverageScore, null),
                validationPendingCount: numeric(raw?.validationPendingCount, 0),
                validationCompletedCount: numeric(raw?.validationCompletedCount, 0),
                validationRequestedCount: numeric(raw?.validationRequestedCount, 0),
            };
        }),
        total,
        page,
        pageSize,
        totalPages,
    };
    return mapped;
}
//# sourceMappingURL=discover.js.map