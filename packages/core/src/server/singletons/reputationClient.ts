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
import { isUserAppEnabled } from '../userApps/userApp';
import { getChainEnvVar, requireChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';
import { DomainClient } from './domainClient';

class ReputationDomainClient extends DomainClient<AIAgentReputationClient, number> {
  constructor() {
    super('reputation');
  }

  protected async buildClient(targetChainId: number): Promise<AIAgentReputationClient> {
    const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', targetChainId);
    const reputationRegistry = requireChainEnvVar('AGENTIC_TRUST_REPUTATION_REGISTRY', targetChainId);
    const ensRegistry = getChainEnvVar('AGENTIC_TRUST_ENS_REGISTRY', targetChainId);
    const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);

    let accountProvider: AccountProvider | undefined;

    const isAdminApp = isUserAppEnabled('admin');
    const isProviderApp = isUserAppEnabled('provider');
    const isClientApp = isUserAppEnabled('client');

    if (isAdminApp) {
      // Admin app: use AdminApp AccountProvider (supports wallet providers and private key)
      const adminApp = await getAdminApp();
      if (adminApp && adminApp.accountProvider) {
        accountProvider = adminApp.accountProvider;
      } else {
        throw new Error('AdminApp not initialized. Connect wallet or set AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
      }
    } else if (isProviderApp) {
      // Provider app: use ProviderApp for agent, try ClientApp for client, or create from session package
      const providerApp = await getProviderApp();
      if (providerApp) {
        accountProvider = providerApp.accountProvider;
        
        // Try to get ClientApp for client operations
        try {
          const { getClientApp } = await import('../userApps/clientApp');
          const clientApp = await getClientApp();
          if (clientApp && clientApp.accountProvider) {
            accountProvider = clientApp.accountProvider;
          }
        } catch {
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
          accountProvider = new ViemAccountProvider({
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
        accountProvider = clientApp.accountProvider;
      }
    } else {
      throw new Error(
        'Cannot initialize reputation client: configure AGENTIC_TRUST_APP_ROLES to include "client", "provider", or "admin".'
      );
    }

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
export async function getReputationClient(chainId?: number): Promise<AIAgentReputationClient> {
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

