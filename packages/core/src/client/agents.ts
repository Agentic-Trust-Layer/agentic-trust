/**
 * Agents API for AgenticTrust Client
 */

import type { GraphQLClient } from 'graphql-request';
import { Agent } from './agent';
import type { AgenticTrustClient } from './index';

/**
 * Agent data interface (raw data from GraphQL)
 */
export interface AgentData {
  agentId?: number;
  agentName?: string;
  createdAtTime?: string;
  updatedAtTime?: string;
  a2aEndpoint?: string; // URL to agent-card.json
  [key: string]: unknown; // Allow for additional fields that may exist
}

export interface ListAgentsResponse {
  agents: Agent[];
  total: number;
}

export class AgentsAPI {
  constructor(
    private graphQLClient: GraphQLClient,
    private client: AgenticTrustClient
  ) {}

  /**
   * List all agents
   * Query uses the actual schema fields from the API
   * Returns agents sorted by agentId in descending order
   * Fetches all agents using pagination if needed
   */
  async listAgents(): Promise<ListAgentsResponse> {
    let allAgents: AgentData[] = [];
    let hasMore = true;
    let offset = 0;
    const limit = 100; // Default limit per page

    // Fetch all agents using pagination
    while (hasMore) {
      const query = `
        query ListAgents($limit: Int, $offset: Int) {
          agents(limit: $limit, offset: $offset) {
            agentId
            agentName
            createdAtTime
            updatedAtTime
            a2aEndpoint
          }
        }
      `;

      try {
        const data = await this.graphQLClient.request<{ agents: AgentData[] }>(query, {
          limit,
          offset,
        });

        const pageAgents = data.agents || [];
        allAgents = allAgents.concat(pageAgents);

        // If we got fewer agents than the limit, we've reached the end
        if (pageAgents.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
          // Safety limit: prevent infinite loops
          if (offset > 10000) {
            console.warn('[listAgents] Reached safety limit of 10000 agents');
            hasMore = false;
          }
        }
      } catch (error) {
        // If pagination parameters aren't supported, try without them
        if (offset === 0) {
          const fallbackQuery = `
            query ListAgents {
              agents {
                agentId
                agentName
                createdAtTime
                updatedAtTime
                a2aEndpoint
              }
            }
          `;
          const data = await this.graphQLClient.request<{ agents: AgentData[] }>(fallbackQuery);
          allAgents = data.agents || [];
        } else {
          console.warn('[listAgents] Pagination error, using fetched agents so far:', error);
        }
        hasMore = false;
      }
    }

    // Sort all agents by agentId in descending order
    const sortedAgents = allAgents.sort((a, b) => {
      // Sort by agentId in descending order (highest first)
      const idA = typeof a.agentId === 'number' ? a.agentId : Number(a.agentId) || 0;
      const idB = typeof b.agentId === 'number' ? b.agentId : Number(b.agentId) || 0;
      return idB - idA;
    });

    // Debug: Log the response data
    if (typeof window !== 'undefined') {
      console.log('[listAgents] total agents 123:', sortedAgents.length);
    }

    // Convert AgentData to Agent instances
    const agentInstances = sortedAgents.map(data => new Agent(data, this.client));

    return {
      agents: agentInstances,
      total: agentInstances.length,
    };
  }

  /**
   * Get a single agent by ID
   * @param agentId - The agent ID as a string
   * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
   */
  async getAgent(agentId: string, chainId: number = 11155111): Promise<Agent | null> {
    const query = `
      query GetAgent($chainId: Int!, $agentId: String!) {
        agent(chainId: $chainId, agentId: $agentId) {
          agentId
          agentName
          createdAtTime
          updatedAtTime
          a2aEndpoint
        }
      }
    `;

    try {
      const data = await this.graphQLClient.request<{ agent: AgentData | null }>(query, { 
        chainId,
        agentId 
      });
      if (!data.agent) {
        return null;
      }
      return new Agent(data.agent, this.client);
    } catch (error) {
      console.warn('Failed to get agent from GraphQL:', error);
      return null;
    }
  }

  /**
   * Search agents by name
   * @param query - Search query string to match against agent names
   * Fetches all matching agents using pagination if needed
   */
  async searchAgents(query: string): Promise<ListAgentsResponse> {
    let allAgents: AgentData[] = [];
    let hasMore = true;
    let offset = 0;
    const limit = 100; // Default limit per page

    // Try GraphQL search with pagination first
    while (hasMore) {
      const graphqlQuery = `
        query SearchAgents($query: String!, $limit: Int, $offset: Int) {
          agents(filter: { agentName: { contains: $query } }, limit: $limit, offset: $offset) {
            agentId
            agentName
            createdAtTime
            updatedAtTime
            a2aEndpoint
          }
        }
      `;

      try {
        const data = await this.graphQLClient.request<{ agents: AgentData[] }>(graphqlQuery, {
          query,
          limit,
          offset,
        });

        const pageAgents = data.agents || [];
        allAgents = allAgents.concat(pageAgents);

        // If we got fewer agents than the limit, we've reached the end
        if (pageAgents.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
          // Safety limit: prevent infinite loops
          if (offset > 10000) {
            console.warn('[searchAgents] Reached safety limit of 10000 agents');
            hasMore = false;
          }
        }
      } catch (error) {
        // If pagination with filter isn't supported, try without pagination first
        if (offset === 0) {
          try {
            const simpleQuery = `
              query SearchAgents($query: String!) {
                agents(filter: { agentName: { contains: $query } }) {
                  agentId
                  agentName
                  createdAtTime
                  updatedAtTime
                  a2aEndpoint
                }
              }
            `;
            const data = await this.graphQLClient.request<{ agents: AgentData[] }>(simpleQuery, {
              query,
            });
            allAgents = data.agents || [];
          } catch (filterError) {
            // If GraphQL filter doesn't work, fall back to client-side filtering
            const allAgentsList = await this.listAgents();
            const searchLower = query.toLowerCase();
            // Extract AgentData from Agent instances for filtering
            allAgents = allAgentsList.agents
              .map(agent => agent.data)
              .filter((agentData) => agentData.agentName?.toLowerCase().includes(searchLower));
          }
        } else {
          console.warn('[searchAgents] Pagination error, using fetched agents so far:', error);
        }
        hasMore = false;
      }
    }

    // Sort all agents by agentId in descending order
    const sortedAgents = allAgents.sort((a, b) => {
      // Sort by agentId in descending order (highest first)
      const idA = typeof a.agentId === 'number' ? a.agentId : Number(a.agentId) || 0;
      const idB = typeof b.agentId === 'number' ? b.agentId : Number(b.agentId) || 0;
      return idB - idA;
    });

    // Debug: Log the response data
    if (typeof window !== 'undefined') {
      console.log('[searchAgents] total matching agents:', sortedAgents.length);
    }

    // Convert AgentData to Agent instances
    const agentInstances = sortedAgents.map(data => new Agent(data, this.client));

    return {
      agents: agentInstances,
      total: agentInstances.length,
    };
  }
}

