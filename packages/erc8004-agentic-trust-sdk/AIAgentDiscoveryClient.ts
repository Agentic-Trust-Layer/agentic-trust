/**
 * AI Agent Discovery Client
 * 
 * Fronts for discovery-index GraphQL requests to the indexer
 * Provides a clean interface for querying agent data
 */

import { GraphQLClient } from 'graphql-request';

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

/**
 * Discovery query response types
 */
export interface ListAgentsResponse {
  agents: AgentData[];
}

export interface GetAgentResponse {
  agent: AgentData;
}

export interface SearchAgentsResponse {
  agents: AgentData[];
}

export interface RefreshAgentResponse {
  indexAgent: {
    success: boolean;
    message: string;
    processedChains: number[];
  };
}

/**
 * Configuration for AIAgentDiscoveryClient
 */
export interface AIAgentDiscoveryClientConfig {
  /**
   * GraphQL endpoint URL
   */
  endpoint: string;
  
  /**
   * Optional API key for authentication
   */
  apiKey?: string;
  
  /**
   * Request timeout in milliseconds
   */
  timeout?: number;
  
  /**
   * Additional headers to include in requests
   */
  headers?: Record<string, string>;
}

/**
 * AI Agent Discovery Client
 * 
 * Provides methods for querying agent data from the indexer
 */
export class AIAgentDiscoveryClient {
  private client: GraphQLClient;
  private config: AIAgentDiscoveryClientConfig;

  constructor(config: AIAgentDiscoveryClientConfig) {
    this.config = config;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.headers || {}),
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
      // Also support API key in header
      headers['X-API-Key'] = config.apiKey;
    }

    this.client = new GraphQLClient(config.endpoint, {
      headers,
    });
  }

  /**
   * List all agents
   * @param limit - Maximum number of agents to return per page
   * @param offset - Number of agents to skip
   * @returns List of agents
   */
  async listAgents(limit?: number, offset?: number): Promise<AgentData[]> {
    let allAgents: AgentData[] = [];
    let hasMore = true;
    let currentOffset = offset || 0;
    const pageLimit = limit || 100;

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
        const data = await this.client.request<ListAgentsResponse>(query, {
          limit: pageLimit,
          offset: currentOffset,
        });

        const pageAgents = data.agents || [];
        allAgents = allAgents.concat(pageAgents);

        // If we got fewer agents than the limit, we've reached the end
        if (pageAgents.length < pageLimit) {
          hasMore = false;
        } else {
          currentOffset += pageLimit;
          // Safety limit: prevent infinite loops
          if (currentOffset > 10000) {
            console.warn('[AIAgentDiscoveryClient.listAgents] Reached safety limit of 10000 agents');
            hasMore = false;
          }
        }
      } catch (error) {
        // If pagination parameters aren't supported, try without them
        if (currentOffset === 0) {
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
          const data = await this.client.request<ListAgentsResponse>(fallbackQuery);
          allAgents = data.agents || [];
        } else {
          console.warn('[AIAgentDiscoveryClient.listAgents] Pagination error, using fetched agents so far:', error);
        }
        hasMore = false;
      }
    }

    return allAgents;
  }

  /**
   * Get a single agent by ID
   * @param chainId - Chain ID (required by schema)
   * @param agentId - Agent ID to fetch
   * @returns Agent data or null if not found
   */
  async getAgent(chainId: number, agentId: number | string): Promise<AgentData | null> {
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
      const data = await this.client.request<GetAgentResponse>(query, {
        chainId,
        agentId: String(agentId),
      });

      return data.agent || null;
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.getAgent] Error fetching agent:', error);
      return null;
    }
  }

  /**
   * Search agents by name
   * @param searchTerm - Search term to match against agent names
   * @param limit - Maximum number of results
   * @returns List of matching agents
   */
  async searchAgents(searchTerm: string, limit?: number): Promise<AgentData[]> {
    const query = `
      query SearchAgents($searchTerm: String!, $limit: Int) {
        agents(searchTerm: $searchTerm, limit: $limit) {
          agentId
          agentName
          createdAtTime
          updatedAtTime
          a2aEndpoint
        }
      }
    `;

    try {
      const data = await this.client.request<SearchAgentsResponse>(query, {
        searchTerm,
        limit: limit || 100,
      });

      return data.agents || [];
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.searchAgents] Error searching agents:', error);
      // Fallback to client-side filtering if search isn't supported
      const allAgents = await this.listAgents();
      const searchLower = searchTerm.toLowerCase();
      return allAgents.filter(agent => 
        agent.agentName?.toLowerCase().includes(searchLower)
      );
    }
  }

  /**
   * Refresh/Index an agent in the indexer
   * Triggers the indexer to re-index the specified agent
   * @param agentId - Agent ID to refresh (required)
   * @param chainId - Optional chain ID (if not provided, indexer may use default)
   * @param apiKey - Optional API key override (uses config API key if not provided)
   * @returns Refresh result with success status and processed chains
   */
  async refreshAgent(
    agentId: string | number,
    chainId?: number,
    apiKey?: string
  ): Promise<RefreshAgentResponse['indexAgent']> {
    const mutation = `
      mutation IndexAgent($agentId: String!, $chainId: Int) {
        indexAgent(agentId: $agentId, chainId: $chainId) {
          success
          message
          processedChains
        }
      }
    `;

    const variables: { agentId: string; chainId?: number } = {
      agentId: String(agentId),
    };

    if (chainId !== undefined) {
      variables.chainId = chainId;
    }

    // If API key override is provided, create a temporary client with that key
    let clientToUse = this.client;
    if (apiKey) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(this.config.headers || {}),
        'Authorization': `Bearer ${apiKey}`,
      };
      clientToUse = new GraphQLClient(this.config.endpoint, {
        headers,
      });
    }

    try {
      const data = await clientToUse.request<RefreshAgentResponse>(mutation, variables);
      return data.indexAgent;
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.refreshAgent] Error refreshing agent:', error);
      throw new Error(
        `Failed to refresh agent: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Execute a raw GraphQL query
   * @param query - GraphQL query string
   * @param variables - Query variables
   * @returns Query response
   */
  async request<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
    return this.client.request<T>(query, variables);
  }

  /**
   * Execute a raw GraphQL mutation
   * @param mutation - GraphQL mutation string
   * @param variables - Mutation variables
   * @returns Mutation response
   */
  async mutate<T = any>(mutation: string, variables?: Record<string, any>): Promise<T> {
    return this.client.request<T>(mutation, variables);
  }

  /**
   * Get the underlying GraphQLClient instance
   * @returns The GraphQLClient instance
   */
  getClient(): GraphQLClient {
    return this.client;
  }
}

