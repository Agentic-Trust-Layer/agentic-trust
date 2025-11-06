/**
 * Agents API for AgenticTrust Client
 */

import type { AgentData } from '@erc8004/agentic-trust-sdk';
import { Agent } from './agent';
import type { AgenticTrustClient } from './index';
import { getAgentsGraphQLClient } from './agentsGraphQLClient';

// Re-export AgentData for compatibility
export type { AgentData };

export interface ListAgentsResponse {
  agents: Agent[];
  total: number;
}

export class AgentsAPI {
  constructor(
    private client: AgenticTrustClient
  ) {}

  /**
   * List all agents
   * Query uses the actual schema fields from the API
   * Returns agents sorted by agentId in descending order
   * Fetches all agents using pagination if needed
   */
  async listAgents(): Promise<ListAgentsResponse> {
    const graphQLClient = await getAgentsGraphQLClient();
    const allAgents = await graphQLClient.listAgents();

    // Sort all agents by agentId in descending order
    const sortedAgents = allAgents.sort((a: AgentData, b: AgentData) => {
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
    const agentInstances = sortedAgents.map((data: AgentData) => new Agent(data, this.client));

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
    const graphQLClient = await getAgentsGraphQLClient();
    const agentData = await graphQLClient.getAgent(chainId, agentId);
    
    if (!agentData) {
      return null;
    }
    
    return new Agent(agentData, this.client);
  }

  /**
   * Search agents by name
   * @param query - Search query string to match against agent names
   * Fetches all matching agents using pagination if needed
   */
  async searchAgents(query: string): Promise<ListAgentsResponse> {
    const graphQLClient = await getAgentsGraphQLClient();
    const allAgents = await graphQLClient.searchAgents(query);

    // Sort all agents by agentId in descending order
    const sortedAgents = allAgents.sort((a: AgentData, b: AgentData) => {
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
    const agentInstances = sortedAgents.map((data: AgentData) => new Agent(data, this.client));

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
             description?: string;
             image?: string;
             agentUrl?: string;
             supportedTrust?: string[];
             endpoints?: Array<{
               name: string;
               endpoint: string;
               version?: string;
               capabilities?: Record<string, any>;
             }>;
           }): Promise<{ agentId: bigint; txHash: string }> => {
      const { getAdminApp } = await import('./adminApp');
      const { IdentityClient } = await import('@erc8004/sdk');

      const adminApp = await getAdminApp();
      if (!adminApp) {
        throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
      }
      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (!identityRegistry || typeof identityRegistry !== 'string') {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
      }
      
      // Ensure identityRegistry is a valid hex string
      const identityRegistryHex = identityRegistry.startsWith('0x') 
        ? identityRegistry 
        : `0x${identityRegistry}`;

      // Create write-capable IdentityClient using AdminApp adapter
      const identityClient = new IdentityClient(
        adminApp.adminAdapter as any,
        identityRegistryHex
      );

      // Build metadata array
      // Ensure all values are non-empty strings (required by IdentityClient.stringToBytes)
      // IdentityClient will convert these strings to bytes using TextEncoder
      const metadata = [
        { key: 'agentName', value: params.agentName ? String(params.agentName) : '' },
        { key: 'agentAccount', value: params.agentAccount ? String(params.agentAccount) : '' },
      ].filter(m => m.value !== ''); // Remove empty values

      // Always create registration JSON and upload to IPFS
      let tokenURI = '';
      // Get chain ID (default to Sepolia) - defined outside try block so it's accessible later
      const { sepolia } = await import('viem/chains');
      const chainId = sepolia.id;
      
      try {
        // Import registration utilities
        const { uploadRegistration, createRegistrationJSON } = await import('./registration');
        
        // Create registration JSON with ERC-8004 compliant structure
        // Note: agentId will be set after registration, so we'll update it later if needed
        const registrationJSON = createRegistrationJSON({
          name: params.agentName,
          agentAccount: params.agentAccount,
          description: params.description,
          image: params.image,
          agentUrl: params.agentUrl,
          chainId,
          identityRegistry: identityRegistryHex as `0x${string}`,
          supportedTrust: params.supportedTrust,
          endpoints: params.endpoints,
        });
        
        // Upload to IPFS and get tokenURI
        const uploadResult = await uploadRegistration(registrationJSON);
        tokenURI = uploadResult.tokenURI;
      } catch (error) {
        console.error('Failed to upload registration JSON to IPFS:', error);
        throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Register agent with metadata and tokenURI
      const result = await identityClient.registerWithMetadata(tokenURI, metadata);

      // Refresh the agent in the GraphQL indexer
      try {
        const graphQLClient = await getAgentsGraphQLClient();
        // Use the same chainId that was used for registration
        await graphQLClient.refreshAgent(result.agentId.toString(), chainId);
        console.log(`✅ Refreshed agent ${result.agentId} in GraphQL indexer`);
      } catch (refreshError) {
        // Log error but don't fail agent creation if refresh fails
        console.warn(`⚠️ Failed to refresh agent ${result.agentId} in GraphQL indexer:`, refreshError);
      }

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

