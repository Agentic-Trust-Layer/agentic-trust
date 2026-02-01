/**
 * Reusable API-layer helper for agent discovery suitable for Next.js route handlers.
 * Parses common search options and maps core Agent objects into a flat JSON
 * payload that UIs can consume directly.
 */

import type {
  ListAgentsResponse,
  DiscoverAgentsOptions,
  DiscoverParams,
} from './agents';
import type { AgentInfo } from '../models/agentInfo';
import { DEFAULT_CHAIN_ID } from './chainConfig';

// Lightweight interface for the server client to avoid heavy coupling here.
type AgenticTrustClient = {
  searchAgents: (options?: DiscoverAgentsOptions | string) => Promise<ListAgentsResponse>;
};

export type DiscoverRequest = {
  page?: number;
  pageSize?: number;
  query?: string;
  params?: DiscoverParams;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
};

// Alias the core AgentInfo model for discovery responses
export type Agent = AgentInfo;

export type DiscoverResponse = {
  agents: Agent[];
  total: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

/**
 * Execute an agents search via the core client and map to a flat API payload.
 *
 * @param req Parsed discovery parameters (page/pageSize/query/params/order*)
 * @param getClient Function returning an initialized AgenticTrustClient (app-specific)
 */
export async function discoverAgents(
  req: DiscoverRequest,
  getClient: () => Promise<AgenticTrustClient>,
): Promise<DiscoverResponse> {
  const client = await getClient();

  const options: DiscoverAgentsOptions = {
    page: typeof req.page === 'number' ? req.page : undefined,
    pageSize: typeof req.pageSize === 'number' ? req.pageSize : undefined,
    query: typeof req.query === 'string' && req.query.trim().length > 0 ? req.query.trim() : undefined,
    params: req.params,
    orderBy: req.orderBy,
    orderDirection: req.orderDirection,
  };

  const { agents, total, page, pageSize, totalPages }: ListAgentsResponse =
    await client.searchAgents(options);

  const mapped: DiscoverResponse = {
    agents: (agents || []).map((agent: any) => {
      const raw =
        agent && typeof (agent as any).data === 'object'
          ? ((agent as any).data as Record<string, unknown>)
          : (agent as Record<string, unknown>);

      const numeric = (value: unknown, fallback?: number | null): number | null => {
        if (value === undefined || value === null) return fallback ?? null;
        const converted = Number(value);
        return Number.isFinite(converted) ? converted : fallback ?? null;
      };

      const booleanish = (value: unknown): boolean | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return Boolean(value);
      };

      const stringOrNull = (value: unknown): string | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return String(value);
      };

      const chainId = numeric(raw?.chainId, DEFAULT_CHAIN_ID) ?? DEFAULT_CHAIN_ID;

      const feedbackCountRaw =
        (raw as any)?.feedbackCount ?? (raw as any)?.assertions?.reviewResponses?.total ?? undefined;

      const validationTotalRaw =
        (raw as any)?.validationCompletedCount ??
        (raw as any)?.validationRequestedCount ??
        (raw as any)?.assertions?.validationResponses?.total ??
        undefined;

      // Extract MCP endpoint from registration data
      let mcpEndpoint: string | null | undefined = undefined;
      try {
        // First try to extract from rawJson if available
        const rawJsonStr = stringOrNull(raw?.rawJson);
        if (rawJsonStr) {
          try {
            const registration = JSON.parse(rawJsonStr);
            if (registration?.endpoints && Array.isArray(registration.endpoints)) {
              const mcpEndpointEntry = registration.endpoints.find(
                (ep: any) => ep && typeof ep.name === 'string' && (ep.name === 'MCP' || ep.name === 'mcp')
              );
              if (mcpEndpointEntry && typeof mcpEndpointEntry.endpoint === 'string') {
                mcpEndpoint = mcpEndpointEntry.endpoint;
              }
            }
          } catch {
            // Ignore JSON parse errors
          }
        }
        // If not found in rawJson, try to extract from endpoints array if available
        if (!mcpEndpoint && raw?.endpoints && Array.isArray(raw.endpoints)) {
          const mcpEndpointEntry = raw.endpoints.find(
            (ep: any) => ep && typeof ep.name === 'string' && (ep.name === 'MCP' || ep.name === 'mcp')
          );
          if (mcpEndpointEntry && typeof mcpEndpointEntry.endpoint === 'string') {
            mcpEndpoint = mcpEndpointEntry.endpoint;
          }
        }
      } catch {
        // Ignore errors in MCP endpoint extraction
      }

      // Extract agentCategory from metadata if available
      let agentCategory: string | null | undefined = undefined;
      try {
        // Check if metadata is available as an object
        if (raw?.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
          agentCategory = stringOrNull((raw.metadata as Record<string, unknown>)?.agentCategory);
        }
        // Also check if agentCategory is directly on raw (from GraphQL normalization)
        if (!agentCategory) {
          agentCategory = stringOrNull(raw?.agentCategory);
        }
      } catch {
        // Ignore errors in agentCategory extraction
      }

      return {
        uaid:
          (() => {
            const v = stringOrNull(raw?.uaid);
            if (!v) {
              const agentId = stringOrNull(raw?.agentId) ?? '';
              const didIdentity = stringOrNull(raw?.didIdentity) ?? '';
              throw new Error(
                `[discoverAgents] Missing uaid in discovery response (agentId=${agentId || '?'}, didIdentity=${didIdentity || '?'}) from KB GraphQL. Ensure Query.kbAgents returns KbAgent.uaid.`,
              );
            }
            if (v.startsWith('uaid:')) return v;
            const agentId = stringOrNull(raw?.agentId) ?? '';
            const didIdentity = stringOrNull(raw?.didIdentity) ?? '';
            throw new Error(
              `[discoverAgents] Invalid uaid value in discovery response (agentId=${agentId || '?'}, didIdentity=${didIdentity || '?'}, uaid=${v}). Expected uaid to start with "uaid:". Your KB is currently returning a DID (e.g. "did:8004:...") in the uaid field.`,
            );
          })(),
        chainId,
        agentId: stringOrNull(raw?.agentId) ?? '',
        createdAtTime: numeric(raw?.createdAtTime, 0) ?? 0,
        agentAccount: String(raw?.agentAccount ?? ''),
        agentIdentityOwnerAccount: String(raw?.agentIdentityOwnerAccount ?? ''),
        eoaAgentIdentityOwnerAccount: stringOrNull(raw?.eoaAgentIdentityOwnerAccount) ?? undefined,
        eoaAgentAccount: stringOrNull(raw?.eoaAgentAccount) ?? undefined,
        contractAddress: stringOrNull(raw?.contractAddress) ?? undefined,
        agentName: String(raw?.agentName ?? ''),
        agentCategory: agentCategory, // Add extracted agentCategory
        didIdentity: stringOrNull(raw?.didIdentity) ?? undefined,
        didAccount: stringOrNull(raw?.didAccount) ?? undefined,
        didName: stringOrNull(raw?.didName) ?? undefined,
        agentUri: stringOrNull(raw?.agentUri) ?? undefined,
        createdAtBlock: numeric(raw?.createdAtBlock, 0) ?? 0,
        updatedAtTime: numeric(raw?.updatedAtTime, null),
        type: stringOrNull(raw?.type) ?? undefined,
        description: stringOrNull((raw as any)?.agentDescription) ?? undefined,
        image: stringOrNull((raw as any)?.agentImage) ?? undefined,
        a2aEndpoint: stringOrNull(raw?.a2aEndpoint) ?? undefined,
        mcpEndpoint: mcpEndpoint, // Add extracted MCP endpoint
        supportedTrust: stringOrNull(raw?.supportedTrust) ?? undefined,
        rawJson: stringOrNull(raw?.rawJson) ?? undefined,
        onchainMetadataJson: stringOrNull((raw as any)?.onchainMetadataJson) ?? undefined,
        agentCardJson: stringOrNull(raw?.agentCardJson) ?? undefined,
        agentCardReadAt: numeric(raw?.agentCardReadAt, null),
        did: stringOrNull(raw?.did) ?? undefined,
        mcp: booleanish(raw?.mcp) ?? undefined,
        x402support: booleanish(raw?.x402support) ?? undefined,
        active: booleanish(raw?.active) ?? undefined,

        // Aggregated metrics
        feedbackCount: numeric(feedbackCountRaw, 0),
        feedbackAverageScore: numeric(raw?.feedbackAverageScore, null),
        validationPendingCount: numeric(
          (raw as any)?.validationPendingCount,
          validationTotalRaw !== undefined ? 0 : 0,
        ),
        validationCompletedCount: numeric((raw as any)?.validationCompletedCount, numeric(validationTotalRaw, 0)),
        validationRequestedCount: numeric((raw as any)?.validationRequestedCount, numeric(validationTotalRaw, 0)),
        // Association counts come from the discovery indexer. Keep missing values as null
        // (do not default to 0) so callers can distinguish "unknown" from "zero".
        initiatedAssociationCount: numeric(raw?.initiatedAssociationCount, null),
        approvedAssociationCount: numeric(raw?.approvedAssociationCount, null),

        // ATI metrics (keep missing as null)
        atiOverallScore: numeric(raw?.atiOverallScore, null),
        atiOverallConfidence: numeric(raw?.atiOverallConfidence, null),
        atiVersion: stringOrNull(raw?.atiVersion) ?? undefined,
        atiComputedAt: numeric(raw?.atiComputedAt, null),
        atiBundleJson: stringOrNull(raw?.atiBundleJson) ?? undefined,

        // Trust Ledger metrics (keep missing as null)
        trustLedgerScore: numeric(raw?.trustLedgerScore, null),
        trustLedgerBadgeCount: numeric(raw?.trustLedgerBadgeCount, null),
        trustLedgerOverallRank: numeric(raw?.trustLedgerOverallRank, null),
        trustLedgerCapabilityRank: numeric(raw?.trustLedgerCapabilityRank, null),
      };
    }),
    total,
    page,
    pageSize,
    totalPages,
  };

  return mapped;
}


