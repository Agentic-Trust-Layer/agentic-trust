/**
 * Reusable API handler for getting comprehensive agent information
 * Aggregates data from contract, IPFS, and GraphQL
 */

// Import AgenticTrustClient type - we'll use a function signature instead
// to avoid circular dependency issues
type AgenticTrustClient = {
  agents: {
    getAgentFromGraphQL(chainId: number, agentId: string): Promise<any | null>;
  };
};

/**
 * Comprehensive agent information response
 */
export interface AgentInfoResponse {
  success: true;
  agentId: string;
  chainId?: number;
  contract: {
    tokenURI: string;
    metadata: Record<string, string>;
  };
  ipfs: {
    tokenURI: string;
    registration: any | null;
  } | null;
  graphql: any | null;
}

/**
 * Get comprehensive agent information
 * Retrieves data from contract, IPFS, and GraphQL in sequence
 * 
 * @param agentId - The agent ID
 * @param chainId - Optional chain ID (defaults to 11155111)
 * @param getClient - Function to get the AgenticTrustClient instance
 * @returns Aggregated agent information
 */
export async function handleGetAgentInfo(
  agentId: string,
  chainId: number = 11155111,
  getClient: () => Promise<AgenticTrustClient>
): Promise<AgentInfoResponse | { error: string; message?: string; details?: string }> {
  try {
    if (!agentId) {
      return {
        error: 'Missing required parameter: agentId',
      };
    }

    const client = await getClient();
    const agentIdBigInt = BigInt(agentId);

    // Step 1: Get contract information (tokenURI and metadata)
    const identityClient = await import('@agentic-trust/core').then(m => m.getIdentityClient());
    
    const tokenURI = await identityClient.getTokenURI(agentIdBigInt);
    
    // Get common metadata keys
    const metadataKeys = ['agentName', 'agentAccount'];
    const metadata: Record<string, string> = {};

    for (const key of metadataKeys) {
      try {
        const value = await identityClient.getMetadata(agentIdBigInt, key);
        if (value) {
          metadata[key] = value;
        }
      } catch (error) {
        // Metadata key might not exist, continue
        console.warn(`Failed to get metadata key ${key}:`, error);
      }
    }

    const contractData = {
      tokenURI,
      metadata,
    };

    // Step 2: Get IPFS registration data (if tokenURI is available)
    let ipfsData: { tokenURI: string; registration: any | null } | null = null;
    if (tokenURI) {
      try {
        const { getIPFSStorage } = await import('../../storage/ipfs');
        const ipfsStorage = getIPFSStorage();
        const registration = await ipfsStorage.getJson(tokenURI);
        ipfsData = {
          tokenURI,
          registration,
        };
      } catch (error) {
        console.warn('Failed to get IPFS registration:', error);
        ipfsData = {
          tokenURI,
          registration: null,
        };
      }
    }

    // Step 3: Get GraphQL data
    let graphqlData: any | null = null;
    try {
      graphqlData = await client.agents.getAgentFromGraphQL(chainId, agentId);
    } catch (error) {
      console.warn('Failed to get GraphQL agent data:', error);
      graphqlData = null;
    }

    return {
      success: true,
      agentId,
      chainId,
      contract: contractData,
      ipfs: ipfsData,
      graphql: graphqlData,
    };
  } catch (error: unknown) {
    console.error('Error getting agent info:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return {
      error: 'Failed to get agent information',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
    };
  }
}

