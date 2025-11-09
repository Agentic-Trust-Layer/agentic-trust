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
import { createBundlerClient } from 'viem/account-abstraction';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { privateKeyToAccount } from 'viem/accounts';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';

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


export async function sendSponsoredUserOperation(params: {
  bundlerUrl: string,
  chain: any,
  accountClient: any,
  calls: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }[],
}): Promise<`0x${string}`> {
  const { bundlerUrl, chain, accountClient, calls } = params;
  const pimlicoClient = createPimlicoClient({ transport: http(bundlerUrl) } as any);
  const bundlerClient = createBundlerClient({ 
    transport: http(bundlerUrl), 
    paymaster: true as any,
    chain: chain as any, 
    paymasterContext: { mode: 'SPONSORED' } 
  } as any);
  const { fast: fee } = await (pimlicoClient as any).getUserOperationGasPrice();
  
  const userOpHash = await (bundlerClient as any).sendUserOperation({ 
    account: accountClient, 
    calls,
    ...fee
  });
  return userOpHash as `0x${string}`;
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
/*
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

    console.log("*********** zzz prepareAddAgentNameToOrgCalls: ensClient");

    // ENS Owner AA: parent domain controller
    const bundlerUrl = process.env.AGENTIC_TRUST_BUNDLER_URL as string;
    const l1RpcUrl = process.env.AGENTIC_TRUST_RPC_URL as string;
    const l1PublicClient = createPublicClient({ chain: sepolia, transport: http(l1RpcUrl) });
    const ensPrivateKey = process.env.AGENTIC_TRUST_ENS_PRIVATE_KEY as `0x${string}`;
    const orgOwnerEOA = privateKeyToAccount(ensPrivateKey);
    const orgOwnerAddress = orgOwnerEOA.address;


    const bundlerClient = createBundlerClient({
      transport: http(bundlerUrl),
      paymaster: true as any,
      chain: sepolia as any,
      paymasterContext: { mode: 'SPONSORED' },
    } as any);
                
    const orgAccountClient = await toMetaMaskSmartAccount({
      address: orgOwnerAddress as `0x${string}`,
      client: l1PublicClient,
      implementation: Implementation.Hybrid,
      signatory: { account: orgOwnerEOA },
    } as any);

    const { calls: orgCalls } = await ensClient.prepareAddAgentNameToOrgCalls({
      orgName: fullOrgName,
      agentName: agentNameLabel,
      agentAddress: agentAddress,
      agentUrl: agentUrl || '',
    });
    
    const userOpHash1 = await sendSponsoredUserOperation({
      bundlerUrl,
      chain: sepolia,
      accountClient: orgAccountClient,
      calls: orgCalls
    });
    const { receipt: orgReceipt } = await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOpHash1 });
    console.log('********************* orgReceipt', orgReceipt);
    
    const pimlicoClient = createPimlicoClient({ transport: http(bundlerUrl) } as any);
    const { fast: fee } = await (pimlicoClient as any).getUserOperationGasPrice();


    // 2. Set agent name info within ENS
      // Clean orgName: remove .eth suffix
  const cleanOrgName = orgName.replace(/\.eth$/i, '');
  
  // Clean agentName: remove leading orgName + . and .eth suffix
  const cleanAgentName = agentName
    .replace(new RegExp(`^${cleanOrgName}\\.`, 'i'), '') // Remove leading orgName.
    .replace(/\.eth$/i, ''); // Remove .eth suffix

    console.log('********************* prepareSetAgentNameInfoCalls');
    const { calls: agentCalls } = await ensClient.prepareSetAgentNameInfoCalls({
      orgName: cleanOrgName,
      agentName: cleanAgentName,
      agentAddress: agentAccount,
      agentUrl: agentUrl,
      agentDescription: agentDescription
    });

    const userOpHash2 = await sendSponsoredUserOperation({
      bundlerUrl,
      chain: sepolia,
      accountClient: agentAccountClient,
      calls: agentCalls,
    });

    const { receipt: agentReceipt } = await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOpHash2 });
    console.log('********************* agentReceipt', agentReceipt);

    if (agentImage && agentImage.trim() !== '') {
      const ensFullName = `${cleanAgentName}.${cleanOrgName}.eth`;
      const { calls: imageCalls } = await agentENSClient.prepareSetNameImageCalls(ensFullName, agentImage.trim());
      
      if (imageCalls.length > 0) {
        const userOpHash3 = await sendSponsoredUserOperation({
          bundlerUrl,
          chain: sepolia,
          accountClient: agentAccountClient,
          calls: imageCalls,
        });

        await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOpHash3 });
      }
    }
    
    return [];
  } catch (error) {
    console.error('Error creating ENS name 2:', error);
    throw new Error(`Failed to create ENS name: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
*/

export interface AddAgentToOrgParams {
  agentName: string;
  orgName: string;
  agentAddress: `0x${string}`;
  agentUrl?: string;
}

export interface AddAgentToOrgResult {
  calls: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }[];
}

export interface PrepareAgentNameInfoParams {
  agentName: string;
  orgName: string;
  agentAddress: `0x${string}`;
  agentUrl?: string;
  agentDescription?: string;
}

export interface PrepareAgentNameInfoResult {
  calls: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }[];
}

export async function addAgentNameToOrgUsingEnsKey(params: AddAgentToOrgParams): Promise<AddAgentToOrgResult> {
  const { agentName, orgName, agentAddress, agentUrl } = params;

  if (!agentName || !orgName || !agentAddress) {
    throw new Error('agentName, orgName, and agentAddress are required to add an agent name to an org');
  }

  const ensClient = await getENSClient();

  const agentNameLabel = agentName.toLowerCase().replace(/\s+/g, '-');
  const orgNameClean = orgName.toLowerCase().replace(/\.eth$/, '');
  const fullOrgName = `${orgNameClean}.eth`;

  const { calls } = await ensClient.prepareAddAgentNameToOrgCalls({
    orgName: fullOrgName,
    agentName: agentNameLabel,
    agentAddress,
    agentUrl: agentUrl || '',
  });

  // Optionally submit server-side if configured (no breaking change: still returns calls)
  try {
    const bundlerUrl = process.env.AGENTIC_TRUST_BUNDLER_URL || process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL || '';
    const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL || '';
    const ensPrivKey = process.env.AGENTIC_TRUST_ENS_PRIVATE_KEY as `0x${string}` | undefined;

    if (ensPrivKey && bundlerUrl && rpcUrl) {
      const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
      const orgEOA = privateKeyToAccount(ensPrivKey);
      const orgAccountClient = await toMetaMaskSmartAccount({
        address: orgEOA.address,
        client: publicClient,
        implementation: Implementation.Hybrid,
        signatory: { account: orgEOA },
      } as any);

      const bundlerClient = createBundlerClient({
        transport: http(bundlerUrl),
        paymaster: true as any,
        chain: sepolia as any,
        paymasterContext: { mode: 'SPONSORED' },
      } as any);

      await (bundlerClient as any).sendUserOperation({
        account: orgAccountClient,
        calls: (calls || []).map((c) => ({
          to: c.to,
          data: c.data,
        })),
      });
    }
  } catch (ignored) {
    // If server-side submission fails, just return prepared calls
  }

  return {
    calls,
  };
}

export interface AddAgentToOrgServerSubmitParams {
  agentName: string;
  orgName: string;
  agentAddress: `0x${string}`;
  agentUrl?: string;
}

export interface AddAgentToOrgServerSubmitResult {
  success: boolean;
  userOpHash?: `0x${string}`;
  calls: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: string | null;
  }[];
}

/**
 * Prepare ENS create subdomain calls and, if configured, submit them server-side
 * using the org ENS private key via the bundler.
 *
 * Falls back to returning prepared calls if server-side submission is not configured.
 */
export async function addAgentNameToOrgServerSubmit(
  params: AddAgentToOrgServerSubmitParams
): Promise<AddAgentToOrgServerSubmitResult> {
  const { agentName, orgName, agentAddress, agentUrl } = params;

  // Prepare calls first (JSON-safe mapping)
  const prepared = await addAgentNameToOrgUsingEnsKey({
    agentName,
    orgName,
    agentAddress,
    agentUrl,
  });

  const jsonSafeCalls = (prepared.calls || []).map((call) => {
    const to = call?.to as `0x${string}`;
    const data = call?.data as `0x${string}`;
    const value = call?.value;
    return {
      to,
      data,
      value: typeof value === 'bigint' ? value.toString() : value ? String(value) : null,
    };
  }).filter((c) => typeof c.to === 'string' && typeof c.data === 'string');

  // Check server-side submission configuration
  const bundlerUrl = process.env.AGENTIC_TRUST_BUNDLER_URL || process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL || '';
  const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL || '';
  const ensPrivKey = process.env.AGENTIC_TRUST_ENS_PRIVATE_KEY as `0x${string}` | undefined;

  if (!ensPrivKey || !bundlerUrl || !rpcUrl) {
    // Not configured to submit; return prepared calls
    return {
      success: true,
      calls: jsonSafeCalls,
    };
  }

  // Submit on server using org ENS key
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const orgEOA = privateKeyToAccount(ensPrivKey);

  const orgAccountClient = await toMetaMaskSmartAccount({
    address: orgEOA.address,
    client: publicClient,
    implementation: Implementation.Hybrid,
    signatory: { account: orgEOA },
  } as any);

  const bundlerClient = createBundlerClient({
    transport: http(bundlerUrl),
    paymaster: true as any,
    chain: sepolia as any,
    paymasterContext: { mode: 'SPONSORED' },
  } as any);

  const userOpHash = await (bundlerClient as any).sendUserOperation({
    account: orgAccountClient,
    calls: jsonSafeCalls.map((c) => ({
      to: c.to,
      data: c.data,
      value: c.value ? BigInt(c.value) : undefined,
    })),
  });

  return {
    success: true,
    userOpHash,
    calls: jsonSafeCalls,
  };
}

export async function prepareAgentNameInfoCalls(
  params: PrepareAgentNameInfoParams
): Promise<PrepareAgentNameInfoResult> {
  const { agentName, orgName, agentAddress, agentUrl, agentDescription } = params;

  if (!agentName || !orgName || !agentAddress) {
    throw new Error('agentName, orgName, and agentAddress are required to prepare ENS agent info calls');
  }

  const ensClient = await getENSClient();

  const orgNameClean = orgName.replace(/\.eth$/i, '').toLowerCase();
  const orgNamePattern = orgNameClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const agentNameTrimmed = agentName
    .replace(new RegExp(`^${orgNamePattern}\\.`, 'i'), '')
    .replace(/\.eth$/i, '')
    .trim();
  const agentNameLabel = agentNameTrimmed.toLowerCase().replace(/\s+/g, '-');

  const { calls } = await ensClient.prepareSetAgentNameInfoCalls({
    orgName: orgNameClean,
    agentName: agentNameLabel,
    agentAddress,
    agentUrl: agentUrl || '',
    agentDescription: agentDescription || '',
  });

  return {
    calls,
  };
}
