/**
 * Reputation Client Singleton
 * 
 * Manages a singleton instance of AIAgentReputationClient
 * Initialized from session package or environment variables
 */


import { AIAgentReputationClient } from '@erc8004/agentic-trust-sdk';
import { ViemAdapter } from '@erc8004/sdk';
import { getClientApp } from './clientApp';
import { getProviderApp } from './providerApp';

// Singleton instance
let reputationClientInstance: AIAgentReputationClient | null = null;
let initializationPromise: Promise<AIAgentReputationClient> | null = null;

/**
 * Get or create the AIAgentReputationClient singleton
 * Initializes from session package if available, otherwise uses environment variables
 */
export async function getReputationClient(): Promise<AIAgentReputationClient> {
  // If already initialized, return immediately
  if (reputationClientInstance) {
    return reputationClientInstance;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      


      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      const reputationRegistry = process.env.AGENTIC_TRUST_REPUTATION_REGISTRY;
      const ensRegistry = process.env.AGENTIC_TRUST_ENS_REGISTRY;
      const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;


      if (!identityRegistry || !reputationRegistry) {
        throw new Error(
          'Missing required environment variables: AGENTIC_TRUST_IDENTITY_REGISTRY and AGENTIC_TRUST_REPUTATION_REGISTRY'
        );
      }

      if (!rpcUrl) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_RPC_URL');
      }

      // Determine if this is a client app or provider app
      const isClientApp = process.env.AGENTIC_TRUST_IS_CLIENT_APP === '1' || 
                          process.env.AGENTIC_TRUST_IS_CLIENT_APP?.trim() === 'true';
      const isProviderApp = process.env.AGENTIC_TRUST_IS_PROVIDER_APP === '1' || 
                            process.env.AGENTIC_TRUST_IS_PROVIDER_APP?.trim() === 'true';

      let agentAdapter: any;
      let clientAdapter: any;

      if (isProviderApp) {
        // Provider app: use ProviderApp for agent, ClientApp for client
        const providerApp = await getProviderApp();
        if (providerApp) {
          agentAdapter = providerApp.agentAdapter;
        }
      } else if (isClientApp) {
        // Client app: use ClientApp for both agent and client (same account)
        const clientApp = await getClientApp();
        if (clientApp) {
          clientAdapter = clientApp.clientAdapter;
          agentAdapter = new ViemAdapter(
            clientApp.publicClient as any,
            clientApp.walletClient as any,
            clientApp.account
          );
        }
        
        
      } else {
        throw new Error(
          'Cannot initialize reputation client: Either AGENTIC_TRUST_IS_CLIENT_APP or AGENTIC_TRUST_IS_PROVIDER_APP must be set to true/1'
        );
      }

      reputationClientInstance = await AIAgentReputationClient.create(
        agentAdapter,
        clientAdapter,
        identityRegistry as `0x${string}`,
        reputationRegistry as `0x${string}`,
        (ensRegistry || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as `0x${string}` // Default ENS registry on Sepolia
      );


      return reputationClientInstance;
    } catch (error) {
      console.error('❌ Failed to initialize reputation client singleton:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Check if reputation client is initialized
 */
export function isReputationClientInitialized(): boolean {
  return reputationClientInstance !== null;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetReputationClient(): void {
  reputationClientInstance = null;
  initializationPromise = null;
}

