/**
 * Identity Client Singleton
 * 
 * Manages a singleton instance of AIAgentIdentityClient
 * Initialized from environment variables using AccountProvider
 */

import { AIAgentIdentityClient } from '@erc8004/agentic-trust-sdk';
import { ViemAccountProvider } from '@erc8004/sdk';

// Singleton instance
let identityClientInstance: AIAgentIdentityClient | null = null;
let initializationPromise: Promise<AIAgentIdentityClient> | null = null;

/**
 * Get or create the AIAgentIdentityClient singleton
 * Initializes from environment variables using AccountProvider
 */
export async function getIdentityClient(): Promise<AIAgentIdentityClient> {
  // If already initialized, return immediately
  if (identityClientInstance) {
    return identityClientInstance;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;
      const chainId = process.env.AGENTIC_TRUST_CHAIN_ID 
        ? parseInt(process.env.AGENTIC_TRUST_CHAIN_ID, 10)
        : 11155111; // Default to Sepolia

      if (!identityRegistry) {
        throw new Error(
          'Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY'
        );
      }

      if (!rpcUrl) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_RPC_URL');
      }

      // Create AccountProvider using ViemAccountProvider (read-only, no wallet)
      const { createPublicClient, http } = await import('viem');
      const { sepolia, baseSepolia, optimismSepolia } = await import('viem/chains');
      
      // Get chain by ID
      let chain: typeof sepolia | typeof baseSepolia | typeof optimismSepolia = sepolia;
      if (chainId === 84532) {
        chain = baseSepolia;
      } else if (chainId === 11155420) {
        chain = optimismSepolia;
      }
      
      const publicClient = createPublicClient({
        chain: chain as any,
        transport: http(rpcUrl),
      });

      const accountProvider = new ViemAccountProvider({
        publicClient: publicClient as any,
        walletClient: null, // Read-only, no wallet
        chainConfig: {
          id: chainId,
          rpcUrl,
          name: chain.name,
          chain: chain as any,
        },
      });

      // Create identity client using AccountProvider
      identityClientInstance = new AIAgentIdentityClient({
        accountProvider,
        identityRegistryAddress: identityRegistry as `0x${string}`,
      });

      console.log('✅ IdentityClient singleton initialized');
      return identityClientInstance;
    } catch (error) {
      console.error('❌ Failed to initialize identity client singleton:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Check if identity client is initialized
 */
export function isIdentityClientInitialized(): boolean {
  return identityClientInstance !== null;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetIdentityClient(): void {
  identityClientInstance = null;
  initializationPromise = null;
}

