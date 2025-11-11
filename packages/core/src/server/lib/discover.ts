/**
 * Reusable API-layer helper for agent discovery suitable for Next.js route handlers.
 * Parses common search options and maps core Agent objects into a flat JSON
 * payload that UIs can consume directly.
 */

import type { AgentsAPI, ListAgentsResponse, DiscoverAgentsOptions, DiscoverParams } from './agents';

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

export type DiscoverAgent = {
  agentId?: number;
  agentName?: string;
  a2aEndpoint?: string;
  data?: {
    createdAtTime?: string | number;
    updatedAtTime?: string | number;
    type?: string | null;
    agentOwner?: string;
  };
};

export type DiscoverResponse = {
  agents: DiscoverAgent[];
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
    agents: (agents || []).map((agent: any) => ({
      agentId: agent?.agentId as number | undefined,
      agentName: agent?.agentName as string | undefined,
      a2aEndpoint: agent?.a2aEndpoint as string | undefined,
      data: {
        createdAtTime: (agent?.createdAtTime as any) ?? undefined,
        updatedAtTime: (agent?.updatedAtTime as any) ?? undefined,
        type: (agent?.type as any) ?? undefined,
        agentOwner: (agent?.agentOwner as any) ?? undefined,
      },
    })),
    total,
    page,
    pageSize,
    totalPages,
  };

  return mapped;
}


