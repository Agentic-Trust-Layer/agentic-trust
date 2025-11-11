/**
 * Reusable API route handler for resolving agent account by name
 * Handles ENS resolution
 */

import { extractAgentAccountFromDiscovery } from './agentAccount';

// Use a function signature type to avoid circular dependency
type AgenticTrustClient = {
  getENSClient(): Promise<any>;
  getDiscoveryClient(): Promise<{
    getAgentByName(agentName: string): Promise<{
      agentAccount?: string | null;
      agentAccountEndpoint?: string | null;
      rawJson?: string | null;
      a2aEndpoint?: string | null;
    } | null>;
  }>;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function isValidAddress(value: unknown): value is `0x${string}` {
  return (
    typeof value === 'string' &&
    value.startsWith('0x') &&
    value.length === 42 &&
    value.toLowerCase() !== ZERO_ADDRESS
  );
}

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
  method: 'ens-identity' | 'ens-direct' | 'discovery' | 'deterministic' | null;
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

    console.log("*********** zzz handleResolveAccount agentName", agentName);
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
    const ensRegistryAddress = (ensClient as any)?.suilookeen_registrar ?? (ensClient as any)?.ensRegistryAddress;
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
      if (isValidAddress(account)) {
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
      if (isValidAddress(ensAgentAddress)) {
        return {
          account: ensAgentAddress,
          method: 'ens-direct',
        };
      }
    } catch (ensError) {
      console.warn('ENS direct resolution failed:', ensError);
    }

    // Try discovery client lookup
    try {
      const discoveryClient = await client.getDiscoveryClient();
      if (discoveryClient) {
        const discoveryAgent = await discoveryClient.getAgentByName(agentName.trim());
        console.log("*********** zzz handleResolveAccount discoveryAgent", discoveryAgent);
        const discoveryAccount = extractAgentAccountFromDiscovery(discoveryAgent);
        console.log("*********** zzz handleResolveAccount discoveryAccount", discoveryAccount);
        if (isValidAddress(discoveryAccount)) {
          return {
            account: discoveryAccount,
            method: 'discovery',
          };
        }

        const a2aEndpoint =
          typeof discoveryAgent?.a2aEndpoint === 'string'
            ? discoveryAgent.a2aEndpoint.trim()
            : '';

        if (a2aEndpoint) {
          try {
            const response = await fetch(a2aEndpoint, {
              headers: {
                Accept: 'application/json, text/plain;q=0.9',
              },
            });

            if (response.ok) {
              const json = await response.json();
              const endpointAccount =
                (json && typeof json === 'object'
                  ? (json.agentAccount || json.agent?.account || json.account || null)
                  : null) as string | null;
              const derivedAccount = isValidAddress(endpointAccount)
                ? (endpointAccount as `0x${string}`)
                : extractAgentAccountFromDiscovery(json);

              if (isValidAddress(derivedAccount)) {
                return {
                  account: derivedAccount,
                  method: 'discovery',
                };
              }
            }
          } catch (endpointError) {
            console.warn('Failed to fetch agent data from discovery endpoint:', endpointError);
          }
        }
      }
    } catch (discoveryError) {
      console.warn('Discovery lookup failed:', discoveryError);
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


