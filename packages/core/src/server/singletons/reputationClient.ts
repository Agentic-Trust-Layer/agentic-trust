/**
 * Reputation Client Singleton
 * 
 * Manages a singleton instance of AIAgentReputationClient
 * Initialized from session package or environment variables
 */


import { AIAgentReputationClient } from '@agentic-trust/8004-ext-sdk';
import { ViemAccountProvider, type AccountProvider } from '@agentic-trust/8004-sdk';
import { getClientApp } from '../userApps/clientApp';
import { getProviderApp } from '../userApps/providerApp';
import { getAdminApp } from '../userApps/adminApp';
import { getChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';

// Singleton instances by chainId
let reputationClientInstances: Map<number, AIAgentReputationClient> = new Map();
let initializationPromises: Map<number, Promise<AIAgentReputationClient>> = new Map();

/**
 * Get or create the AIAgentReputationClient singleton
 * Initializes from session package if available, otherwise uses environment variables
 */
export async function getReputationClient(chainId?: number): Promise<AIAgentReputationClient> {
  // Default to configured chain if no chainId provided
  const targetChainId: number = chainId || DEFAULT_CHAIN_ID;

  // If already initialized for this chain, return immediately
  if (reputationClientInstances.has(targetChainId)) {
    return reputationClientInstances.get(targetChainId)!;
  }

  // If initialization is in progress for this chain, wait for it
  if (initializationPromises.has(targetChainId)) {
    return initializationPromises.get(targetChainId)!;
  }

  // Start initialization
  let initPromise: Promise<AIAgentReputationClient>;

  const executeInit = async (): Promise<AIAgentReputationClient> => {
    try {
      const identityRegistry = getChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', targetChainId);
      const reputationRegistry = getChainEnvVar('AGENTIC_TRUST_REPUTATION_REGISTRY', targetChainId);
      const ensRegistry = getChainEnvVar('AGENTIC_TRUST_ENS_REGISTRY', targetChainId);
      const rpcUrl = getChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);


      if (!identityRegistry || !reputationRegistry) {
        throw new Error(
          'Missing required environment variables: AGENTIC_TRUST_IDENTITY_REGISTRY and AGENTIC_TRUST_REPUTATION_REGISTRY'
        );
      }

      if (!rpcUrl) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_RPC_URL');
      }

      // Determine if this is a client app, provider app, or admin app
      const isClientApp = process.env.AGENTIC_TRUST_IS_CLIENT_APP === '1' || 
                          process.env.AGENTIC_TRUST_IS_CLIENT_APP?.trim() === 'true';
      const isProviderApp = process.env.AGENTIC_TRUST_IS_PROVIDER_APP === '1' || 
                            process.env.AGENTIC_TRUST_IS_PROVIDER_APP?.trim() === 'true';
      const isAdminApp = process.env.AGENTIC_TRUST_IS_ADMIN_APP === '1' || 
                         process.env.AGENTIC_TRUST_IS_ADMIN_APP?.trim() === 'true';

      let agentAccountProvider: AccountProvider | undefined;
      let clientAccountProvider: AccountProvider | undefined;

      if (isAdminApp) {
        // Admin app: use AdminApp AccountProvider (supports wallet providers and private key)
        const adminApp = await getAdminApp();
        if (adminApp && adminApp.accountProvider) {
          agentAccountProvider = adminApp.accountProvider;
          clientAccountProvider = adminApp.accountProvider; // For admin, agent and client are the same
        } else {
          throw new Error('AdminApp not initialized. Connect wallet or set AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
        }
      } else if (isProviderApp) {
        // Provider app: use ProviderApp for agent, try ClientApp for client, or create from session package
        const providerApp = await getProviderApp();
        if (providerApp) {
          agentAccountProvider = providerApp.accountProvider;
          
          // Try to get ClientApp for client operations
          try {
            const { getClientApp } = await import('../userApps/clientApp');
            const clientApp = await getClientApp();
            if (clientApp && clientApp.accountProvider) {
              clientAccountProvider = clientApp.accountProvider;
            }
          } catch (error) {
            // ClientApp not available, create read-only clientAccountProvider from session package
            // The client is the session key owner (EOA that controls the smart account)
            const sessionKeyAddress = providerApp.sessionPackage.sessionKey.address as `0x${string}`;
            const { createPublicClient, http } = await import('viem');
            const { sepolia } = await import('viem/chains');
            
            const clientPublicClient = createPublicClient({
              chain: sepolia,
              transport: http(rpcUrl),
            });
            
            // Create read-only AccountProvider for client (no wallet client, no signing)
            // For provider apps, client operations that require signing should be handled differently
            clientAccountProvider = new ViemAccountProvider({
              publicClient: clientPublicClient as any,
              walletClient: null,
              account: sessionKeyAddress, // Use address as account for read-only operations
              chainConfig: {
                id: sepolia.id,
                rpcUrl,
                name: sepolia.name,
                chain: sepolia,
              },
            });
          }
        }
      } else if (isClientApp) {
        // Client app: use ClientApp for both agent and client (same account)
        const clientApp = await getClientApp();
        if (clientApp) {
          clientAccountProvider = clientApp.accountProvider;
          // Create AccountProvider for agent (same as client)
          agentAccountProvider = new ViemAccountProvider({
            publicClient: clientApp.publicClient,
            walletClient: clientApp.walletClient as any,
            account: clientApp.account,
            chainConfig: {
              id: clientApp.publicClient.chain?.id || 11155111,
              rpcUrl: (clientApp.publicClient.transport as any)?.url || '',
              name: clientApp.publicClient.chain?.name || 'Unknown',
              chain: clientApp.publicClient.chain || undefined,
            },
          });
        }
      } else {
        throw new Error(
          'Cannot initialize reputation client: Set AGENTIC_TRUST_IS_CLIENT_APP, AGENTIC_TRUST_IS_PROVIDER_APP, or AGENTIC_TRUST_IS_ADMIN_APP to true/1'
        );
      }

      if (!agentAccountProvider || !clientAccountProvider) {
        throw new Error('Failed to initialize AccountProviders for reputation client');
      }

      const reputationClient = await AIAgentReputationClient.create(
        agentAccountProvider,
        clientAccountProvider,
        identityRegistry as `0x${string}`,
        reputationRegistry as `0x${string}`,
        (ensRegistry || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as `0x${string}` // Default ENS registry on Sepolia
      );

      return reputationClient;
    } catch (error) {
      console.error('❌ Failed to initialize reputation client singleton:', error);
      throw error;
    }
  };

  initPromise = executeInit().then((client) => {
    // Store in map and clean up initialization promise
    reputationClientInstances.set(targetChainId, client);
    initializationPromises.delete(targetChainId);
    return client;
  }).catch((error) => {
    // Clean up on error
    initializationPromises.delete(targetChainId);
    throw error;
  });

  initializationPromises.set(targetChainId, initPromise);

  return initPromise;
}

/**
 * Check if reputation client is initialized for a specific chain
 */
export function isReputationClientInitialized(chainId?: number): boolean {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  return reputationClientInstances.has(targetChainId);
}

/**
 * Reset the reputation client instance for a specific chain (useful for testing)
 */
export function resetReputationClient(chainId?: number): void {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  reputationClientInstances.delete(targetChainId);
  initializationPromises.delete(targetChainId);
}

