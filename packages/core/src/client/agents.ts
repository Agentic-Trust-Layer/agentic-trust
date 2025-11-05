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

  /**
   * Admin API for agent management
   * These methods require AdminApp to be initialized
   */
  admin = {
    /**
     * Create a new agent
     * @param params - Agent creation parameters
     * @returns Created agent ID and transaction hash
     */
    createAgent: async (params: {
      agentName: string;
      agentAccount: `0x${string}`;
      tokenURI?: string;
      metadata?: Array<{ key: string; value: string }>;
    }): Promise<{ agentId: bigint; txHash: string }> => {
      const { getAdminApp } = await import('./adminApp');
      const { IdentityClient } = await import('@erc8004/sdk');

      const adminApp = await getAdminApp();
      if (!adminApp) {
        throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
      }
      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }

      // Create write-capable IdentityClient using AdminApp adapter
      const identityClient = new IdentityClient(
        adminApp.adminAdapter as any,
        identityRegistry
      );

      // Build metadata array
      const metadata = [
        { key: 'agentName', value: params.agentName },
        { key: 'agentAccount', value: params.agentAccount },
        ...(params.metadata || [])
      ];

      // Use tokenURI if provided, otherwise empty string (can be set later)
      const tokenURI = params.tokenURI || '';

      // Register agent with metadata
      const result = await identityClient.registerWithMetadata(tokenURI, metadata);

      return result;
    },

    /**
     * Update an agent's token URI
     * @param agentId - The agent ID to update
     * @param tokenURI - New token URI
     * @returns Transaction hash
     */
    updateAgent: async (params: {
      agentId: bigint | string;
      tokenURI?: string;
      metadata?: Array<{ key: string; value: string }>;
    }): Promise<{ txHash: string }> => {
      const { getAdminApp } = await import('./adminApp');
      const { getIdentityClient } = await import('./identityClient');
      const { IdentityClient } = await import('@erc8004/sdk');

      const adminApp = await getAdminApp();
      if (!adminApp) {
        throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
      }

      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }

      // Create write-capable IdentityClient using AdminApp adapter
      const identityClient = new IdentityClient(
        adminApp.adminAdapter as any,
        identityRegistry
      );

      const agentId = BigInt(params.agentId);
      const results: Array<{ txHash: string }> = [];

      // Update token URI if provided
      if (params.tokenURI !== undefined) {
        const uriResult = await identityClient.setAgentUri(agentId, params.tokenURI);
        results.push(uriResult);
      }

      // Update metadata if provided
      if (params.metadata && params.metadata.length > 0) {
        for (const entry of params.metadata) {
          const metadataResult = await identityClient.setMetadata(agentId, entry.key, entry.value);
          results.push(metadataResult);
        }
      }

      if (results.length === 0) {
        throw new Error('No updates provided. Specify tokenURI and/or metadata.');
      }

      // Return the last transaction hash (most recent update)
      const lastResult = results[results.length - 1];
      if (!lastResult) {
        throw new Error('Failed to get transaction hash from update operation');
      }
      return { txHash: lastResult.txHash };
    },

    /**
     * Delete an agent by transferring it to the zero address (burn)
     * Note: This requires the contract to support transfers to address(0)
     * @param agentId - The agent ID to delete
     * @returns Transaction hash
     */
    deleteAgent: async (params: {
      agentId: bigint | string;
    }): Promise<{ txHash: string }> => {
      const { getAdminApp } = await import('./adminApp');

      const adminApp = await getAdminApp();
      if (!adminApp) {
        throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
      }

      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }

      // Import IdentityRegistry ABI for transferFrom
      const IdentityRegistryABI = await import('@erc8004/agentic-trust-sdk/abis/IdentityRegistry.json');
      
      const agentId = BigInt(params.agentId);
      const from = adminApp.address;
      const to = '0x0000000000000000000000000000000000000000' as `0x${string}`;

      // Transfer to zero address (burn)
      const result = await adminApp.adminAdapter.send(
        identityRegistry,
        IdentityRegistryABI.default || IdentityRegistryABI,
        'transferFrom',
        [from, to, agentId]
      );

      return { txHash: result.txHash };
    },

    /**
     * Transfer an agent to a new owner
     * @param agentId - The agent ID to transfer
     * @param to - The new owner address
     * @returns Transaction hash
     */
    transferAgent: async (params: {
      agentId: bigint | string;
      to: `0x${string}`;
    }): Promise<{ txHash: string }> => {
      const { getAdminApp } = await import('./adminApp');

      const adminApp = await getAdminApp();
      if (!adminApp) {
        throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
      }

      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }

      // Import IdentityRegistry ABI for transferFrom
      const IdentityRegistryABI = await import('@erc8004/agentic-trust-sdk/abis/IdentityRegistry.json');
      
      const agentId = BigInt(params.agentId);
      const from = adminApp.address;

      // Transfer to new owner
      const result = await adminApp.adminAdapter.send(
        identityRegistry,
        IdentityRegistryABI.default || IdentityRegistryABI,
        'transferFrom',
        [from, params.to, agentId]
      );

      return { txHash: result.txHash };
    },
  };
}

