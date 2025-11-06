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
  // Structured data by source
  identityMetadata: {
    tokenURI: string;
    metadata: Record<string, string>;
  };
  identityRegistration: {
    tokenURI: string;
    registration: any | null;
  } | null;
  discovery: any | null;
  // Flattened aggregated fields (prioritized from identityRegistration > identityMetadata > discovery)
  name?: string;
  description?: string;
  image?: string;
  agentAccount?: string;
  agentName?: string;
  a2aEndpoint?: string;
  endpoints?: Array<{
    name: string;
    endpoint: string;
    version?: string;
    capabilities?: Record<string, any>;
  }>;
  supportedTrust?: string[];
  createdAt?: string;
  updatedAt?: string;
  createdAtTime?: string;
  updatedAtTime?: string;
  [key: string]: any; // Allow additional flattened fields
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

    const identityMetadata = {
      tokenURI,
      metadata,
    };

    // Step 2: Get IPFS registration data (if tokenURI is available)
    let identityRegistration: { tokenURI: string; registration: any | null } | null = null;
    if (tokenURI) {
      try {
        const { getIPFSStorage } = await import('../../storage/ipfs');
        const ipfsStorage = getIPFSStorage();
        const registration = await ipfsStorage.getJson(tokenURI);
        identityRegistration = {
          tokenURI,
          registration,
        };
      } catch (error) {
        console.warn('Failed to get IPFS registration:', error);
        identityRegistration = {
          tokenURI,
          registration: null,
        };
      }
    }

    // Step 3: Get GraphQL data
    let discovery: any | null = null;
    try {
      discovery = await client.agents.getAgentFromGraphQL(chainId, agentId);
    } catch (error) {
      console.warn('Failed to get GraphQL agent data:', error);
      discovery = null;
    }

    // Step 4: Aggregate flattened fields from all sources
    // Priority: identityRegistration > identityMetadata > discovery
    const flattened: Record<string, any> = {};

    // From identityRegistration (IPFS) - highest priority
    if (identityRegistration?.registration) {
      const reg = identityRegistration.registration;
      if (reg.name) flattened.name = reg.name;
      if (reg.description) flattened.description = reg.description;
      if (reg.image) flattened.image = reg.image;
      if (reg.agentAccount) flattened.agentAccount = reg.agentAccount;
      if (reg.endpoints) flattened.endpoints = reg.endpoints;
      if (reg.supportedTrust) flattened.supportedTrust = reg.supportedTrust;
      if (reg.createdAt) flattened.createdAt = reg.createdAt;
      if (reg.updatedAt) flattened.updatedAt = reg.updatedAt;
    }

    // From identityMetadata (contract) - medium priority (only if not already set)
    if (metadata.agentName && !flattened.name) flattened.name = metadata.agentName;
    if (metadata.agentName) flattened.agentName = metadata.agentName;
    if (metadata.agentAccount) flattened.agentAccount = metadata.agentAccount;

    // From discovery (GraphQL) - lowest priority (only if not already set)
    if (discovery) {
      if (discovery.agentName && !flattened.name) flattened.name = discovery.agentName;
      if (discovery.agentName && !flattened.agentName) flattened.agentName = discovery.agentName;
      if (discovery.a2aEndpoint) flattened.a2aEndpoint = discovery.a2aEndpoint;
      if (discovery.createdAtTime) flattened.createdAtTime = discovery.createdAtTime;
      if (discovery.updatedAtTime) flattened.updatedAtTime = discovery.updatedAtTime;
      // Copy any other discovery fields
      Object.keys(discovery).forEach(key => {
        if (!flattened[key] && key !== 'agentId') {
          flattened[key] = discovery[key];
        }
      });
    }

    return {
      success: true,
      agentId,
      chainId,
      identityMetadata,
      identityRegistration,
      discovery,
      ...flattened,
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

