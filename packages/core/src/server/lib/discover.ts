/**
 * Reusable API-layer helper for agent discovery suitable for Next.js route handlers.
 * Parses common search options and maps core Agent objects into a flat JSON
 * payload that UIs can consume directly.
 */

import type {
  AgentsAPI,
  ListAgentsResponse,
  DiscoverAgentsOptions,
  DiscoverParams,
} from './agents';
import type { AgentInfo } from '../models/agentInfo';
import { DEFAULT_CHAIN_ID } from './chainConfig';

// Lightweight interface for the server client to avoid heavy coupling here.
type AgenticTrustClient = {
  agents: Pick<AgentsAPI, 'searchAgents'>;
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

  const { agents, total, page, pageSize, totalPages }: ListAgentsResponse = await (client.agents as any).searchAgents(
    options,
  );

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

      return {
        chainId,
        agentId: stringOrNull(raw?.agentId) ?? '',
        agentAccount: String(raw?.agentAccount ?? ''),
        agentOwner: String(raw?.agentOwner ?? ''),
        contractAddress: stringOrNull(raw?.contractAddress) ?? undefined,
        agentName: String(raw?.agentName ?? ''),
        didIdentity: stringOrNull(raw?.didIdentity) ?? undefined,
        didAccount: stringOrNull(raw?.didAccount) ?? undefined,
        didName: stringOrNull(raw?.didName) ?? undefined,
        metadataURI: stringOrNull(raw?.metadataURI) ?? undefined,
        createdAtBlock: numeric(raw?.createdAtBlock, 0) ?? 0,
        createdAtTime: numeric(raw?.createdAtTime, 0) ?? 0,
        updatedAtTime: numeric(raw?.updatedAtTime, null),
        type: stringOrNull(raw?.type) ?? undefined,
        description: stringOrNull(raw?.description) ?? undefined,
        image: stringOrNull(raw?.image) ?? undefined,
        a2aEndpoint: stringOrNull(raw?.a2aEndpoint) ?? undefined,
        ensEndpoint: stringOrNull(raw?.ensEndpoint) ?? undefined,
        agentAccountEndpoint: stringOrNull(raw?.agentAccountEndpoint) ?? undefined,
        supportedTrust: stringOrNull(raw?.supportedTrust) ?? undefined,
        rawJson: stringOrNull(raw?.rawJson) ?? undefined,
        did: stringOrNull(raw?.did) ?? undefined,
        mcp: booleanish(raw?.mcp) ?? undefined,
        x402support: booleanish(raw?.x402support) ?? undefined,
        active: booleanish(raw?.active) ?? undefined,
      };
    }),
    total,
    page,
    pageSize,
    totalPages,
  };

  return mapped;
}


