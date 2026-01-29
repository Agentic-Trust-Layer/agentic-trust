/**
 * Identity Client Singleton
 * 
 * Manages a singleton instance of AIAgentIdentityClient
 * Initialized from environment variables using AccountProvider
 */

import { AIAgentIdentityClient } from '@agentic-trust/8004-ext-sdk';
import { ViemAccountProvider } from '@agentic-trust/8004-sdk';
import { requireChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';
import { DomainClient } from './domainClient';

class IdentityDomainClient extends DomainClient<AIAgentIdentityClient, number> {
  constructor() {
    super('identity');
  }

  protected async buildClient(targetChainId: number): Promise<AIAgentIdentityClient> {
    const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', targetChainId);
    const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);

    // Create AccountProvider using ViemAccountProvider (read-only, no wallet)
    const { createPublicClient, http } = await import('viem');
    const { sepolia, baseSepolia, optimismSepolia } = await import('viem/chains');
    
    // Get chain by ID
    let chain: typeof sepolia | typeof baseSepolia | typeof optimismSepolia = sepolia;
    if (targetChainId === 84532) {
      chain = baseSepolia;
    } else if (targetChainId === 11155420) {
      chain = optimismSepolia;
    }
    
    const publicClient = createPublicClient({
      chain: chain as any,
      // viem http transport defaults to a relatively short timeout; the abort error often shows up as
      // "signal is aborted without reason" during slower RPC responses. Increase timeout for
      // agent detail pages that may perform many reads (e.g., getAllMetadata).
      transport: http(rpcUrl, { timeout: 60_000 }),
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

    return identityClient;
  }
}

const identityDomainClient = new IdentityDomainClient();

/**
 * Get or create the AIAgentIdentityClient singleton
 * Initializes from environment variables using AccountProvider
 */
export async function getIdentityRegistryClient(chainId?: number): Promise<AIAgentIdentityClient> {
  // Default to configured chain if no chainId provided
  const targetChainId: number = chainId || DEFAULT_CHAIN_ID;
  return identityDomainClient.get(targetChainId);
}

/**
 * Check if identity client is initialized for a specific chain
 */
export function isIdentityClientInitialized(chainId?: number): boolean {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  return identityDomainClient.isInitialized(targetChainId);
}

/**
 * Reset the identity client instance for a specific chain (useful for testing)
 */
export function resetIdentityClient(chainId?: number): void {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  identityDomainClient.reset(targetChainId);
}
