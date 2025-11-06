/**
 * Reusable API route handler for creating agents
 * Can be imported and used by any Next.js app
 */

// Import AgenticTrustClient type - we'll use a function signature instead
// to avoid circular dependency issues
type AgenticTrustClient = {
  agents: {
    createAgent(params: {
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
    }): Promise<
      | { agentId: bigint; txHash: string }
      | {
          requiresClientSigning: true;
          transaction: {
            to: `0x${string}`;
            data: `0x${string}`;
            value: string;
            gas?: string;
            gasPrice?: string;
            maxFeePerGas?: string;
            maxPriorityFeePerGas?: string;
            nonce?: number;
            chainId: number;
          };
          tokenURI: string;
          metadata: Array<{ key: string; value: string }>;
        }
    >;
  };
};

/**
 * Request body type for create agent
 */
export interface CreateAgentRequestBody {
  agentName: string;
  agentAccount: string;
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
}

/**
 * Create agent API route handler
 * 
 * @param body - Request body with agent creation parameters
 * @param getClient - Function to get the AgenticTrustClient instance (app-specific)
 * @returns Response data (can be wrapped in NextResponse by the calling app)
 */
export async function handleCreateAgent(
  body: CreateAgentRequestBody,
  getClient: () => Promise<AgenticTrustClient>
): Promise<
  | { success: true; agentId: string; txHash: string }
  | {
      success: true;
      requiresClientSigning: true;
      transaction: {
        to: `0x${string}`;
        data: `0x${string}`;
        value: string;
        gas?: string;
        gasPrice?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
        nonce?: number;
        chainId: number;
      };
      tokenURI: string;
      metadata: Array<{ key: string; value: string }>;
    }
  | { error: string; message?: string; details?: string }
> {
  try {
    const { agentName, agentAccount, description, image, agentUrl, supportedTrust, endpoints } = body;

    // Validate required fields
    if (!agentName || !agentAccount) {
      return {
        error: 'Missing required fields: agentName and agentAccount are required',
      };
    }

    // Validate agentAccount format
    if (!/^0x[a-fA-F0-9]{40}$/.test(agentAccount)) {
      return {
        error: 'Invalid agentAccount format. Must be a valid Ethereum address (0x...)',
      };
    }

    const client = await getClient();

    // Create agent - Registration JSON will be automatically created and uploaded to IPFS per ERC-8004
    const result = await client.agents.createAgent({
      agentName,
      agentAccount: agentAccount as `0x${string}`,
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
    });

    // Check if result requires client-side signing
    if ('requiresClientSigning' in result && result.requiresClientSigning === true) {
      // Return prepared transaction for client-side signing
      return {
        success: true,
        requiresClientSigning: true,
        transaction: result.transaction,
        tokenURI: result.tokenURI,
        metadata: result.metadata,
      };
    }

    // Server-side signed transaction (result has agentId and txHash)
    if ('agentId' in result && 'txHash' in result) {
      return {
        success: true,
        agentId: result.agentId.toString(),
        txHash: result.txHash,
      };
    }

    // Fallback (should not happen)
    throw new Error('Unexpected result type from createAgent');
  } catch (error: unknown) {
    console.error('Error creating agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return {
      error: 'Failed to create agent',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
    };
  }
}

