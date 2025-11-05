/**
 * Provider App Singleton
 * 
 * Manages a singleton instance for provider-side operations using session package
 * Provides access to agent account, delegation setup, and wallet client for agent operations
 */

import { ViemAdapter } from '@erc8004/sdk';
import type { Account, PublicClient, WalletClient } from 'viem';
import type { SessionPackage, DelegationSetup } from './sessionPackage';

// Provider app instance type
type ProviderAppInstance = {
  sessionPackage: SessionPackage;
  delegationSetup: DelegationSetup;
  agentAccount: Account;
  publicClient: PublicClient;
  walletClient: WalletClient;
  agentAdapter: ViemAdapter;
  agentId: bigint;
};

// Singleton instance
let providerAppInstance: ProviderAppInstance | null = null;
let initializationPromise: Promise<ProviderAppInstance> | null = null;

/**
 * Get or create the ProviderApp singleton
 * Initializes from session package in environment variables
 */
export async function getProviderApp(): Promise<ProviderAppInstance | undefined> {
  // If already initialized, return immediately
  if (providerAppInstance) {
    return providerAppInstance;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;

      if (!sessionPackagePath) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_SESSION_PACKAGE_PATH');
      }

      // Load session package and build delegation setup
      const { loadSessionPackage, buildDelegationSetup, buildAgentAccountFromSession } = await import('./sessionPackage');
      const sessionPackage = loadSessionPackage(sessionPackagePath);
      const delegationSetup = buildDelegationSetup(sessionPackage);

      // Get agent account from session package
      const agentAccount = await buildAgentAccountFromSession(sessionPackage);

      // Create wallet client for agent
      const { createWalletClient, http: httpTransport } = await import('viem');
      const walletClient = createWalletClient({
        account: agentAccount,
        chain: delegationSetup.chain,
        transport: httpTransport(delegationSetup.rpcUrl),
      });

      // Create agent adapter
      const agentAdapter = new ViemAdapter(
        delegationSetup.publicClient,
        walletClient as any,
        agentAccount.address as `0x${string}`
      );

      providerAppInstance = {
        sessionPackage,
        delegationSetup,
        agentAccount,
        publicClient: delegationSetup.publicClient as any,
        walletClient: walletClient as any,
        agentAdapter,
        agentId: BigInt(sessionPackage.agentId),
      };

      console.log('✅ ProviderApp singleton initialized with agent ID:', sessionPackage.agentId);
      return providerAppInstance;
    } catch (error) {
      console.error('❌ Failed to initialize ProviderApp singleton:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  // Check if this is a provider app (environment variable can be 'true', '1', or truthy)
  const isProviderApp = process.env.AGENTIC_TRUST_IS_PROVIDER_APP === '1' || 
                        process.env.AGENTIC_TRUST_IS_PROVIDER_APP?.trim() === 'true' ||
                        !!process.env.AGENTIC_TRUST_IS_PROVIDER_APP;
  
  if (!isProviderApp) {
    return undefined;
  }

  return initializationPromise;

}

/**
 * Get the agent ID (convenience method)
 */
export async function getProviderAgentId(): Promise<bigint> {
  const providerApp = await getProviderApp();
  return providerApp?.agentId ?? BigInt(0);
}

/**
 * Check if provider app is initialized
 */
export function isProviderAppInitialized(): boolean {
  return providerAppInstance !== null;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetProviderApp(): void {
  providerAppInstance = null;
  initializationPromise = null;
}

