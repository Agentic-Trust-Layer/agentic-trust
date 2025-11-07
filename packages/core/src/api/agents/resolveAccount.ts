/**
 * Reusable API route handler for resolving agent account by name
 * Handles ENS resolution server-side
 */

// Use a function signature type to avoid circular dependency
type AgenticTrustClient = {
  getENSClient(): Promise<any>;
};

/**
 * Request body type for resolve account
 */
export interface ResolveAccountRequestBody {
  agentName: string;
}

/**
 * Response type for resolve account
 */
export interface ResolveAccountResponse {
  account: string | null;
  method: 'ens-identity' | 'ens-direct' | 'deterministic' | null;
  error?: string;
}

/**
 * Resolve agent account by name
 * Tries ENS resolution first, then returns null (client should compute deterministically)
 * 
 * @param body - Request body with agent name
 * @param getClient - Function to get the AgenticTrustClient instance (app-specific)
 * @returns Response with resolved account address or null
 */
export async function handleResolveAccount(
  body: ResolveAccountRequestBody,
  getClient: () => Promise<AgenticTrustClient>
): Promise<ResolveAccountResponse> {
  try {
    const { agentName } = body;

    if (!agentName || !agentName.trim()) {
      return {
        account: null,
        method: null,
        error: 'agentName is required',
      };
    }

    const client = await getClient();
    const ensClient = await client.getENSClient();

    if (!ensClient) {
      return {
        account: null,
        method: null,
        error: 'ENS client not available',
      };
    }

    // Check if ENS client is properly configured
    const ensRegistryAddress = (ensClient as any)?.ensRegistryAddress;
    if (!ensRegistryAddress || ensRegistryAddress === '' || ensRegistryAddress === '0x0000000000000000000000000000000000000000') {
      return {
        account: null,
        method: null,
        error: 'ENS client not properly configured',
      };
    }

    // Try to resolve via ENS -> agent-identity -> agentId -> on-chain account
    try {
      const { agentId, account } = await ensClient.getAgentIdentityByName(agentName.trim());
      if (account && account !== '0x0000000000000000000000000000000000000000') {
        return {
          account: account,
          method: 'ens-identity',
        };
      }
    } catch (ensError) {
      console.warn('ENS identity resolution failed:', ensError);
    }

    // Try to get agent account via ENS name directly
    try {
      const ensAgentAddress = await ensClient.getAgentAccountByName(agentName);
      if (ensAgentAddress && ensAgentAddress !== '0x0000000000000000000000000000000000000000') {
        return {
          account: ensAgentAddress,
          method: 'ens-direct',
        };
      }
    } catch (ensError) {
      console.warn('ENS direct resolution failed:', ensError);
    }

    // No ENS resolution found - client should compute deterministically
    return {
      account: null,
      method: 'deterministic',
    };
  } catch (error: unknown) {
    console.error('Error resolving account:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      account: null,
      method: null,
      error: errorMessage,
    };
  }
}

