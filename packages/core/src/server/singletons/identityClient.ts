/**
 * Identity Client Singleton
 * 
 * Manages a singleton instance of AIAgentIdentityClient
 * Initialized from environment variables using AccountProvider
 */

import { AIAgentIdentityClient } from '@erc8004/agentic-trust-sdk';
import { ViemAccountProvider } from '@erc8004/sdk';
import { getChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';

// Singleton instances by chainId
let identityClientInstances: Map<number, AIAgentIdentityClient> = new Map();
let initializationPromises: Map<number, Promise<AIAgentIdentityClient>> = new Map();

/**
 * Get or create the AIAgentIdentityClient singleton
 * Initializes from environment variables using AccountProvider
 */
export async function getIdentityClient(chainId?: number): Promise<AIAgentIdentityClient> {
  // Default to configured chain if no chainId provided
  const targetChainId: number = chainId || DEFAULT_CHAIN_ID;

  // If already initialized for this chain, return immediately
  if (identityClientInstances.has(targetChainId)) {
    return identityClientInstances.get(targetChainId)!;
  }

  // If initialization is in progress for this chain, wait for it
  if (initializationPromises.has(targetChainId)) {
    return initializationPromises.get(targetChainId)!;
  }

  // Start initialization
  let initPromise: Promise<AIAgentIdentityClient>;

  const executeInit = async (): Promise<AIAgentIdentityClient> => {
    try {
      const identityRegistry = getChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', targetChainId);
      const rpcUrl = getChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);

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
          id: targetChainId,
          rpcUrl,
          name: chain.name,
          chain: chain as any,
        },
      });

      // Create identity client using AccountProvider
      const identityClient = new AIAgentIdentityClient({
        accountProvider,
        identityRegistryAddress: identityRegistry as `0x${string}`,
      });

      console.log('✅ IdentityClient singleton initialized');
      return identityClient;
    } catch (error) {
      console.error('❌ Failed to initialize identity client singleton:', error);
      throw error;
    }
  };

  initPromise = executeInit().then((client) => {
    // Store in map and clean up initialization promise
    identityClientInstances.set(targetChainId, client);
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
 * Check if identity client is initialized for a specific chain
 */
export function isIdentityClientInitialized(chainId?: number): boolean {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  return identityClientInstances.has(targetChainId);
}

/**
 * Reset the identity client instance for a specific chain (useful for testing)
 */
export function resetIdentityClient(chainId?: number): void {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  identityClientInstances.delete(targetChainId);
  initializationPromises.delete(targetChainId);
}

