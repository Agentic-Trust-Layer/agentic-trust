/**
 * Admin App Singleton
 * 
 * Manages a singleton instance for admin-side operations using private key
 * Provides access to admin account, wallet client, and admin adapter for agent administration
 */

import { ViemAdapter } from '@erc8004/sdk';
import type { Account, PublicClient, WalletClient } from 'viem';

// Admin app instance type
type AdminAppInstance = {
  account: Account;
  publicClient: PublicClient;
  walletClient: WalletClient;
  adminAdapter: ViemAdapter;
  address: `0x${string}`;
};

// Singleton instance
let adminAppInstance: AdminAppInstance | null = null;
let initializationPromise: Promise<AdminAppInstance> | null = null;

/**
 * Get or create the AdminApp singleton
 * Initializes from private key in environment variables
 */
export async function getAdminApp(): Promise<AdminAppInstance | undefined> {
  // If already initialized, return immediately
  if (adminAppInstance) {
    return adminAppInstance;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      // Check if this is an admin app (environment variable can be 'true', '1', or truthy)
      const isAdminApp = process.env.AGENTIC_TRUST_IS_ADMIN_APP === '1' ||
                         process.env.AGENTIC_TRUST_IS_ADMIN_APP?.trim() === 'true' ||
                         !!process.env.AGENTIC_TRUST_IS_ADMIN_APP;

      if (!isAdminApp) {
        throw new Error('AdminApp is only available when AGENTIC_TRUST_IS_ADMIN_APP is set to true or 1');
      }

      const privateKey = process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY || process.env.AGENTIC_TRUST_PRIVATE_KEY;
      const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;

      if (!privateKey) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_ADMIN_PRIVATE_KEY or AGENTIC_TRUST_PRIVATE_KEY');
      }

      if (!rpcUrl) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_RPC_URL');
      }

      const { privateKeyToAccount } = await import('viem/accounts');
      const { createPublicClient, createWalletClient, http: httpTransport } = await import('viem');
      const { sepolia } = await import('viem/chains');

      // Normalize private key
      const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
      const account = privateKeyToAccount(normalizedKey as `0x${string}`);
      const address = account.address;

      // Create public and wallet clients
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: httpTransport(rpcUrl),
      });

      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: httpTransport(rpcUrl),
      });

      // Create admin adapter
      const adminAdapter = new ViemAdapter(
        publicClient as any,
        walletClient as any,
        account
      );

      adminAppInstance = {
        account,
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        adminAdapter,
        address,
      };

      console.log('✅ AdminApp singleton initialized with address:', address);
      return adminAppInstance;
    } catch (error) {
      console.error('❌ Failed to initialize AdminApp singleton:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Get the admin address (convenience method)
 */
export async function getAdminAddress(): Promise<`0x${string}`> {
  const adminApp = await getAdminApp();
  return adminApp?.address ?? '0x';
}

/**
 * Check if admin app is initialized
 */
export function isAdminAppInitialized(): boolean {
  return adminAppInstance !== null;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetAdminApp(): void {
  adminAppInstance = null;
  initializationPromise = null;
}

