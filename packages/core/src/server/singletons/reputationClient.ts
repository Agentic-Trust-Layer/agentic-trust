/**
 * Reputation Client Singleton
 * 
 * Manages a singleton instance of AIAgentReputationClient
 * Initialized from session package or environment variables
 */


import { AIAgentReputationClient } from '@agentic-trust/8004-ext-sdk';
import { type AccountProvider } from '@agentic-trust/8004-sdk';
import { getChainEnvVar, requireChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';
import { DomainClient } from './domainClient';
import { resolveDomainUserApps, resolveReputationAccountProvider, type DomainUserApps } from './domainAccountProviders';

interface ReputationInitArg {
  userApps?: DomainUserApps;
}

class ReputationDomainClient extends DomainClient<AIAgentReputationClient, number> {
  constructor() {
    super('reputation');
  }

  protected async buildClient(targetChainId: number, initArg?: unknown): Promise<AIAgentReputationClient> {
    const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', targetChainId);
    const reputationRegistry = requireChainEnvVar('AGENTIC_TRUST_REPUTATION_REGISTRY', targetChainId);
    const ensRegistry = getChainEnvVar('AGENTIC_TRUST_ENS_REGISTRY', targetChainId);
    const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);

    const init = (initArg || {}) as ReputationInitArg;
    const userApps = init.userApps ?? (await resolveDomainUserApps());
    const accountProvider: AccountProvider = await resolveReputationAccountProvider(
      targetChainId,
      rpcUrl,
      userApps
    );

    const reputationClient = await AIAgentReputationClient.create(
      accountProvider as AccountProvider,
      identityRegistry as `0x${string}`,
      reputationRegistry as `0x${string}`,
      (ensRegistry || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as `0x${string}`, // Default ENS registry on Sepolia
    );

    return reputationClient;
  }
}

const reputationDomainClient = new ReputationDomainClient();

/**
 * Get or create the AIAgentReputationClient singleton
 * Initializes from session package if available, otherwise uses environment variables
 */
export async function getReputationClient(
  chainId?: number,
): Promise<AIAgentReputationClient> {
  // Default to configured chain if no chainId provided
  const targetChainId: number = chainId || DEFAULT_CHAIN_ID;
  return reputationDomainClient.get(targetChainId);
}

/**
 * Check if reputation client is initialized for a specific chain
 */
export function isReputationClientInitialized(chainId?: number): boolean {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  return reputationDomainClient.isInitialized(targetChainId);
}

/**
 * Reset the reputation client instance for a specific chain (useful for testing)
 */
export function resetReputationClient(chainId?: number): void {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  reputationDomainClient.reset(targetChainId);
}

