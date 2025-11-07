/**
 * ENS Client Singleton
 * 
 * Manages a singleton instance of AIAgentENSClient
 * Initialized from environment variables using AccountProvider
 */

import { AIAgentENSClient } from '@erc8004/agentic-trust-sdk';
import { ViemAccountProvider, type AccountProvider } from '@erc8004/sdk';
import { sepolia } from 'viem/chains';
import { createPublicClient, http } from 'viem';
import { getAdminApp } from '../userApps/adminApp';
import { getClientApp } from '../userApps/clientApp';
import { getProviderApp } from '../userApps/providerApp';

// Singleton instance
let ensClientInstance: AIAgentENSClient | null = null;
let initializationPromise: Promise<AIAgentENSClient> | null = null;

/**
 * Get or create the AIAgentENSClient singleton
 * Initializes from environment variables using AccountProvider from AdminApp, ClientApp, or ProviderApp
 */
export async function getENSClient(): Promise<AIAgentENSClient> {
  // If already initialized, return immediately
  if (ensClientInstance) {
    return ensClientInstance;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      // Get RPC URL from environment
      const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL || '';

      // Get ENS registry addresses from environment
      const ensRegistry = (process.env.AGENTIC_TRUST_ENS_REGISTRY || '') as `0x${string}`;
      
      const ensResolver = (process.env.AGENTIC_TRUST_ENS_RESOLVER || '') as `0x${string}`;
      
      const identityRegistry = (process.env.AGENTIC_TRUST_IDENTITY_REGISTRY || 
                               '0x0000000000000000000000000000000000000000') as `0x${string}`;

      // Try to get AccountProvider from AdminApp, ClientApp, or ProviderApp
      let accountProvider: AccountProvider | null = null;

      // Try AdminApp first (for admin operations)
      const isAdminApp = process.env.AGENTIC_TRUST_IS_ADMIN_APP === 'true' || process.env.AGENTIC_TRUST_IS_ADMIN_APP === '1';
      if (isAdminApp) {
        try {
          const adminApp = await getAdminApp();
          if (adminApp?.accountProvider) {
            accountProvider = adminApp.accountProvider;
          }
        } catch (error) {
          console.warn('AdminApp not available for ENS client, trying other options...');
        }
      }

      // Try ClientApp if AdminApp didn't work
      if (!accountProvider) {
        const isClientApp = process.env.AGENTIC_TRUST_IS_CLIENT_APP === 'true' || process.env.AGENTIC_TRUST_IS_CLIENT_APP === '1';
        if (isClientApp) {
          try {
            const clientApp = await getClientApp();
            if (clientApp?.accountProvider) {
              accountProvider = clientApp.accountProvider;
            }
          } catch (error) {
            console.warn('ClientApp not available for ENS client, trying ProviderApp...');
          }
        }
      }

      // Try ProviderApp if ClientApp didn't work
      if (!accountProvider) {
        const isProviderApp = process.env.AGENTIC_TRUST_IS_PROVIDER_APP === 'true' || process.env.AGENTIC_TRUST_IS_PROVIDER_APP === '1';
        if (isProviderApp) {
          try {
            const providerApp = await getProviderApp();
            if (providerApp?.accountProvider) {
              accountProvider = providerApp.accountProvider;
            }
          } catch (error) {
            console.warn('ProviderApp not available for ENS client, creating read-only client...');
          }
        }
      }

      // Fallback: Create a read-only AccountProvider if no app is available
      if (!accountProvider) {
        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(rpcUrl),
        });

        accountProvider = new ViemAccountProvider({
          publicClient,
          walletClient: null,
          account: undefined,
          chainConfig: {
            id: sepolia.id,
            rpcUrl,
            name: sepolia.name,
            chain: sepolia,
          },
        });
      }

      // Create ENS client
      ensClientInstance = new AIAgentENSClient(
        sepolia,
        rpcUrl,
        accountProvider,
        ensRegistry,
        ensResolver,
        identityRegistry,
      );

      return ensClientInstance;
    } catch (error) {
      console.error('❌ Failed to initialize ENS client singleton:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Check if ENS client is initialized
 */
export function isENSClientInitialized(): boolean {
  return ensClientInstance !== null;
}

/**
 * Reset the ENS client instance (useful for testing)
 */
export function resetENSClient(): void {
  ensClientInstance = null;
  initializationPromise = null;
}

/**
 * Check if an ENS name is available
 * 
 * @param agentName - The agent name (e.g., "my-agent")
 * @param orgName - The organization name (e.g., "8004-agent" or "8004-agent.eth")
 * @returns true if the ENS name is available, false if it's taken, null if check failed
 */
export async function isENSAvailable(
  agentName: string,
  orgName: string
): Promise<boolean | null> {
  try {
    const ensClient = await getENSClient();
    
    // Format: agentName.orgName.eth
    const agentNameLabel = agentName.toLowerCase().replace(/\s+/g, '-');
    const orgNameClean = orgName.toLowerCase().replace(/\.eth$/, '');
    const fullName = `${agentNameLabel}.${orgNameClean}.eth`;
    
    // Check if agent name is available
    const existingAccount = await ensClient.getAgentAccountByName(fullName);
    const isAvailable = !existingAccount || existingAccount === '0x0000000000000000000000000000000000000000';
    
    return isAvailable;
  } catch (error) {
    console.error('Error checking ENS availability:', error);
    return null;
  }
}

/**
 * Create an ENS subdomain name for an agent
 * 
 * @param agentName - The agent name (e.g., "my-agent")
 * @param orgName - The organization name (e.g., "8004-agent" or "8004-agent.eth")
 * @param agentAddress - The agent's account address (0x...)
 * @param agentUrl - Optional agent URL to set in ENS text record
 * @param accountProvider - Optional AccountProvider to use (if not provided, will try to get from AdminApp/ClientApp/ProviderApp)
 * @returns Array of transaction hashes for the ENS creation transactions
 * @throws Error if ENS creation fails
 */
export async function createENSName(
  agentName: string,
  orgName: string,
  agentAddress: `0x${string}`,
  agentUrl?: string,
  accountProvider?: AccountProvider
): Promise<string[]> {
  try {
    // Validate inputs
    if (!agentName || !orgName || !agentAddress) {
      throw new Error(`Missing required parameters: agentName=${agentName}, orgName=${orgName}, agentAddress=${agentAddress}`);
    }

    // Validate agentAddress format
    if (typeof agentAddress !== 'string' || !agentAddress.startsWith('0x') || agentAddress.length !== 42) {
      throw new Error(`Invalid agentAddress format: ${agentAddress}. Must be a valid Ethereum address (0x followed by 40 hex characters).`);
    }

    const ensClient = await getENSClient();
    
    // Get AccountProvider for sending transactions
    // Use provided accountProvider, or try to get from apps
    let providerToUse: AccountProvider | null = accountProvider || null;
    
    if (!providerToUse) {
      // Try all apps in order: AdminApp, ClientApp, ProviderApp
      // Don't rely on environment variables - try to get each app and use it if available
      
      // Try AdminApp first
      try {
        const adminApp = await getAdminApp();
        if (adminApp?.accountProvider) {
          providerToUse = adminApp.accountProvider;
        }
      } catch (error) {
        // AdminApp not available, continue to next option
        console.warn('AdminApp not available for ENS creation:', error);
      }
      
      // Try ClientApp if AdminApp didn't work
      if (!providerToUse) {
        try {
          const clientApp = await getClientApp();
          if (clientApp?.accountProvider) {
            providerToUse = clientApp.accountProvider;
          }
        } catch (error) {
          // ClientApp not available, continue to next option
          console.warn('ClientApp not available for ENS creation:', error);
        }
      }
      
      // Try ProviderApp if ClientApp didn't work
      if (!providerToUse) {
        try {
          const providerApp = await getProviderApp();
          if (providerApp?.accountProvider) {
            providerToUse = providerApp.accountProvider;
          }
        } catch (error) {
          // ProviderApp not available
          console.warn('ProviderApp not available for ENS creation:', error);
        }
      }
    }
    
    if (!providerToUse) {
      throw new Error('No AccountProvider available. Provide accountProvider parameter or ensure AdminApp, ClientApp, or ProviderApp is initialized.');
    }
    
    // Format names
    const agentNameLabel = agentName.toLowerCase().replace(/\s+/g, '-');
    const orgNameClean = orgName.toLowerCase().replace(/\.eth$/, '');
    const fullOrgName = `${orgNameClean}.eth`;
    
    // Prepare ENS creation calls
    console.log('Creating ENS name with:', {
      orgName: fullOrgName,
      agentName: agentNameLabel,
      agentAddress: agentAddress,
      agentUrl: agentUrl || '',
    });

    const { calls } = await ensClient.prepareAddAgentNameToOrgCalls({
      orgName: fullOrgName,
      agentName: agentNameLabel,
      agentAddress: agentAddress,
      agentUrl: agentUrl || '',
    });
    
    // Send ENS creation transactions
    const txHashes: string[] = [];
    for (const call of calls) {
      const result = await providerToUse.send({
        to: call.to,
        data: call.data as `0x${string}`,
        value: (call as any).value || 0n, // value is optional in some implementations
      }, {
        simulation: true,
      });
      txHashes.push(result.hash);
      console.log('ENS record created:', result.hash);
    }
    
    return txHashes;
  } catch (error) {
    console.error('Error creating ENS name:', error);
    throw new Error(`Failed to create ENS name: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

