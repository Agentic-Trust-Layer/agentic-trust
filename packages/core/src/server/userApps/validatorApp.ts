/**
 * Validator App Singleton
 * 
 * Manages a singleton instance for validator-side operations using private key
 * Provides access to validator account, wallet client, and validator address
 * Used for processing ENS validation requests
 */

import { ViemAccountProvider, type AccountProvider } from '@agentic-trust/8004-sdk';
import type { Account, PublicClient, WalletClient, Chain } from 'viem';
import { getChainById, getChainRpcUrl, DEFAULT_CHAIN_ID } from '../lib/chainConfig';
import { isUserAppEnabled, logUserAppInitFailure, logUserAppInitStart, logUserAppInitSuccess } from './userApp';

// Validator app instance type
type ValidatorAppInstance = {
  account: Account;
  publicClient: PublicClient;
  walletClient: WalletClient;
  accountProvider: AccountProvider;
  address: `0x${string}`;
  hasPrivateKey: boolean; // Whether this instance can sign transactions
};

// Singleton instance (per chain)
const validatorAppInstances = new Map<string, ValidatorAppInstance>();
const initializationPromises = new Map<string, Promise<ValidatorAppInstance>>();

/**
 * Check if the validator private key is configured in environment.
 */
export function hasValidatorPrivateKey(): boolean {
  const value = process.env.AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY;
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Get or create the ValidatorApp instance
 * Initializes from private key in environment variables
 * 
 * @param chainId - Chain ID (defaults to DEFAULT_CHAIN_ID)
 */
export async function getValidatorApp(chainId: number = DEFAULT_CHAIN_ID): Promise<ValidatorAppInstance | undefined> {
  const instanceKey = `validator:${chainId}`;

  // If already initialized for this chain, return immediately
  const existingInstance = validatorAppInstances.get(instanceKey);
  if (existingInstance) {
    return existingInstance;
  }

  // If initialization is in progress for this chain, wait for it
  const existingPromise = initializationPromises.get(instanceKey);
  if (existingPromise) {
    return existingPromise;
  }

  // Start initialization for this chain
  const initializationPromise = (async () => {
    try {
      // Check if this is a validator app (environment flag)
      if (!isUserAppEnabled('validator')) {
        throw new Error('ValidatorApp is only available when AGENTIC_TRUST_APP_ROLES includes "validator"');
      }

      logUserAppInitStart('validator', `chainId=${chainId}`);

      // Try to get validator private key from sessionPackage first, then fall back to environment variable
      let privateKey: string | undefined;
      
      // Try sessionPackage first (same as feedbackAuth uses)
      try {
        const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
        if (sessionPackagePath) {
          const { loadSessionPackage } = await import('../lib/sessionPackage');
          const sessionPackage = loadSessionPackage(sessionPackagePath);
          if (sessionPackage?.sessionKey?.privateKey) {
            privateKey = sessionPackage.sessionKey.privateKey;
            console.log('[ValidatorApp] Using private key from sessionPackage');
          }
        }
      } catch (sessionError) {
        // If sessionPackage loading fails, fall through to environment variable
        console.warn('[ValidatorApp] Failed to load sessionPackage, falling back to environment variable:', sessionError);
      }

      // Fall back to environment variable if sessionPackage didn't provide a key
      if (!privateKey) {
        privateKey = process.env.AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY;
        if (privateKey) {
          console.log('[ValidatorApp] Using private key from AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY environment variable');
        }
      }

      if (!privateKey) {
        console.warn(
          'ValidatorApp role is enabled but no private key found. ' +
          'Set either AGENTIC_TRUST_SESSION_PACKAGE_PATH (with sessionKey.privateKey) or AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY. ' +
          'Skipping ValidatorApp initialization for this process.',
        );
        validatorAppInstances.delete(instanceKey);
        initializationPromises.delete(instanceKey);
        return undefined as any;
      }

      // Get chain-specific RPC URL and chain config
      const targetChainId = chainId || DEFAULT_CHAIN_ID;
      const rpcUrl = getChainRpcUrl(targetChainId);

      if (!rpcUrl) {
        throw new Error(`Missing required RPC URL. Configure AGENTIC_TRUST_RPC_URL_{CHAIN} for chainId ${targetChainId}`);
      }

      const { createPublicClient, createWalletClient, http: httpTransport } = await import('viem');
      const chain = getChainById(targetChainId) as Chain;

      // Create public client (always needed)
      const publicClient = createPublicClient({
        chain,
        transport: httpTransport(rpcUrl),
      });

      // Create wallet client and account from private key
      const { privateKeyToAccount } = await import('viem/accounts');
      const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
      const account = privateKeyToAccount(normalizedKey as `0x${string}`);
      const address = account.address;

      const walletClient = createWalletClient({
        account,
        chain,
        transport: httpTransport(rpcUrl),
      });

      // Create AccountProvider
      const accountProvider = new ViemAccountProvider({
        publicClient,
        walletClient: walletClient as any,
        account,
        chainConfig: {
          id: chain.id,
          rpcUrl,
          name: chain.name,
          chain,
        },
      });

      const instance: ValidatorAppInstance = {
        account,
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        accountProvider,
        address,
        hasPrivateKey: true,
      };

      // Store instance by chain key
      validatorAppInstances.set(instanceKey, instance);
      initializationPromises.delete(instanceKey); // Remove from pending

      logUserAppInitSuccess('validator', address);

      return instance;
    } catch (error) {
      logUserAppInitFailure('validator', error);
      initializationPromises.delete(instanceKey); // Remove from pending on error
      throw error;
    }
  })();

  // Store promise for this chain
  initializationPromises.set(instanceKey, initializationPromise);

  return initializationPromise;
}

/**
 * Get the validator address (convenience method)
 */
export async function getValidatorAddress(chainId: number = DEFAULT_CHAIN_ID): Promise<`0x${string}` | undefined> {
  const validatorApp = await getValidatorApp(chainId);
  return validatorApp?.address;
}

/**
 * Check if validator app is initialized for a specific chain
 */
export function isValidatorAppInitialized(chainId?: number): boolean {
  if (chainId !== undefined) {
    const instanceKey = `validator:${chainId}`;
    return validatorAppInstances.has(instanceKey);
  }
  return validatorAppInstances.size > 0;
}

/**
 * Reset validator app instances (useful for testing)
 * @param chainId - Optional chain ID to reset specific instance, or all if not provided
 */
export function resetValidatorApp(chainId?: number): void {
  if (chainId !== undefined) {
    const instanceKey = `validator:${chainId}`;
    validatorAppInstances.delete(instanceKey);
    initializationPromises.delete(instanceKey);
  } else {
    validatorAppInstances.clear();
    initializationPromises.clear();
  }
}

