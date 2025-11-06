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
  account?: Account; // Optional - only needed for signing
  publicClient: PublicClient;
  walletClient?: WalletClient; // Optional - only needed for signing
  adminAdapter: ViemAdapter;
  address: `0x${string}`;
  hasPrivateKey: boolean; // Whether this instance can sign transactions
};

// Singleton instance (per private key)
// Note: We use a Map to support multiple private keys (different users)
// The key is the private key hash or address to ensure uniqueness
const adminAppInstances = new Map<string, AdminAppInstance>();
const initializationPromises = new Map<string, Promise<AdminAppInstance>>();

/**
 * Get or create the AdminApp instance for a specific private key
 * Initializes from private key in cookies (Web3Auth/wallet) or environment variables
 * 
 * @param privateKey - Optional private key. If not provided, will try cookies then env vars
 */
export async function getAdminApp(privateKey?: string): Promise<AdminAppInstance | undefined> {
  // Resolve the private key first
  let resolvedPrivateKey: string | undefined = privateKey;

  console.log('______________ resolvedPrivateKey: ', resolvedPrivateKey);
  
  if (!resolvedPrivateKey) {
    // Try to get private key from session first (for Web3Auth/wallet), then fall back to environment variable
    // Only try Next.js cookies if we're in a Next.js environment
    try {
      // Dynamically try to import next/headers (only available in Next.js apps)
      // This is wrapped in try/catch because core package doesn't have next as a dependency
      // @ts-ignore - next/headers is not available in core package, only in Next.js apps
      const nextHeaders = await import('next/headers').catch(() => null);
      if (nextHeaders && nextHeaders.cookies) {
        const cookieStore = await nextHeaders.cookies();
        resolvedPrivateKey = cookieStore.get('admin_private_key')?.value;
      }
    
    } catch (error) {
      // If cookies() fails (e.g., not in Next.js context), fall back to environment variable
      // This is expected in non-Next.js contexts
    }
    console.log('______________ resolvedPrivateKey: ', resolvedPrivateKey);
    
    // Fall back to environment variable if no session key
    if (!resolvedPrivateKey) {
      resolvedPrivateKey = process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY || process.env.AGENTIC_TRUST_PRIVATE_KEY;
    }
  }

  // Check if we have a wallet address from MetaMask (no private key available)
  let walletAddress: string | undefined;
  if (!resolvedPrivateKey) {
    // Try to get wallet address from session (for MetaMask)
    try {
      // @ts-ignore - next/headers is not available in core package, only in Next.js apps
      const nextHeaders = await import('next/headers').catch(() => null);
      if (nextHeaders && nextHeaders.cookies) {
        const cookieStore = await nextHeaders.cookies();
        walletAddress = cookieStore.get('wallet_address')?.value;
      }
    } catch (error) {
      // Ignore errors
    }
    
    // If we have neither private key nor wallet address, throw error
    if (!walletAddress && !resolvedPrivateKey) {
      throw new Error(
        'Missing required: Set AGENTIC_TRUST_ADMIN_PRIVATE_KEY environment variable, authenticate via Web3Auth social login (provides private key), or connect via wallet (MetaMask/Web3Auth).\n\n' +
        'Note:\n' +
        '  - Web3Auth social login (Google, Facebook, etc.) → provides private key → full server-side operations ✅\n' +
        '  - Web3Auth/MetaMask wallet provider → no private key → read-only operations (prepare transactions) ✅\n' +
        '  - For wallet providers, implement client-side signing to complete transactions'
      );
    }
    
    // If we have wallet address but no private key, we can still do read-only operations
    // (prepare transactions, encode calldata, etc.) but not sign/send transactions
    // This is handled by checking hasPrivateKey before attempting to sign
  }
  
  // Determine instance key - use wallet address if available, otherwise use private key address
  let instanceKey: string;
  let resolvedAddress: string | undefined;
  
  if (resolvedPrivateKey) {
    // Use private key to derive address
    const { privateKeyToAccount } = await import('viem/accounts');
    const normalizedKey = resolvedPrivateKey.startsWith('0x') ? resolvedPrivateKey : `0x${resolvedPrivateKey}`;
    const tempAccount = privateKeyToAccount(normalizedKey as `0x${string}`);
    instanceKey = tempAccount.address.toLowerCase();
    resolvedAddress = tempAccount.address;
  } else if (walletAddress) {
    // Use wallet address directly (for read-only operations)
    instanceKey = walletAddress.toLowerCase();
    resolvedAddress = walletAddress;
  } else {
    throw new Error('Either private key or wallet address is required');
  }

  // If already initialized for this key, return immediately
  const existingInstance = adminAppInstances.get(instanceKey);
  if (existingInstance) {
    return existingInstance;
  }

  // If initialization is in progress for this key, wait for it
  const existingPromise = initializationPromises.get(instanceKey);
  if (existingPromise) {
    return existingPromise;
  }

  // Start initialization for this specific private key
  const initializationPromise = (async () => {
    try {
      // Check if this is an admin app (environment variable can be 'true', '1', or truthy)
      const isAdminApp = process.env.AGENTIC_TRUST_IS_ADMIN_APP === '1' ||
                         process.env.AGENTIC_TRUST_IS_ADMIN_APP?.trim() === 'true' ||
                         !!process.env.AGENTIC_TRUST_IS_ADMIN_APP;

      if (!isAdminApp) {
        throw new Error('AdminApp is only available when AGENTIC_TRUST_IS_ADMIN_APP is set to true or 1');
      }

      const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;

      if (!rpcUrl) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_RPC_URL');
      }

      const { createPublicClient, createWalletClient, http: httpTransport } = await import('viem');
      const { sepolia } = await import('viem/chains');

      // Create public client (always needed)
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: httpTransport(rpcUrl),
      });

      let account: Account | undefined;
      let walletClient: WalletClient | undefined;
      let address: `0x${string}`;
      const hasPrivateKey = !!resolvedPrivateKey;

      if (resolvedPrivateKey) {
        // Create wallet client and account from private key
        const { privateKeyToAccount } = await import('viem/accounts');
        const normalizedKey = resolvedPrivateKey.startsWith('0x') ? resolvedPrivateKey : `0x${resolvedPrivateKey}`;
        account = privateKeyToAccount(normalizedKey as `0x${string}`);
        address = account.address;

        walletClient = createWalletClient({
          account,
          chain: sepolia,
          transport: httpTransport(rpcUrl),
        });
      } else {
        // Read-only mode - use wallet address
        address = resolvedAddress as `0x${string}`;
      }

      // Create admin adapter - walletClient is optional (null for read-only)
      const adminAdapter = new ViemAdapter(
        publicClient as any,
        walletClient as any,
        account
      );

      const instance: AdminAppInstance = {
        account,
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        adminAdapter,
        address,
        hasPrivateKey,
      };

      // Store instance by address key
      adminAppInstances.set(instanceKey, instance);
      initializationPromises.delete(instanceKey); // Remove from pending

      console.log('✅ AdminApp initialized with address:', address);
      return instance;
    } catch (error) {
      console.error('❌ Failed to initialize AdminApp:', error);
      initializationPromises.delete(instanceKey); // Remove from pending on error
      throw error;
    }
  })();

  // Store promise for this key
  initializationPromises.set(instanceKey, initializationPromise);

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
 * Check if admin app is initialized for a specific address
 */
export function isAdminAppInitialized(address?: string): boolean {
  if (address) {
    return adminAppInstances.has(address.toLowerCase());
  }
  return adminAppInstances.size > 0;
}

/**
 * Reset admin app instances (useful for testing)
 * @param address - Optional address to reset specific instance, or all if not provided
 */
export function resetAdminApp(address?: string): void {
  if (address) {
    const key = address.toLowerCase();
    adminAppInstances.delete(key);
    initializationPromises.delete(key);
  } else {
    adminAppInstances.clear();
    initializationPromises.clear();
  }
}

