/**
 * Account Abstraction (AA) Client Utilities
 * 
 * Provides utilities for working with Account Abstraction (AA) accounts
 * using MetaMask Smart Account implementation via @metamask/delegation-toolkit
 */

import { keccak256, stringToHex, createPublicClient, http, createWalletClient, custom, type Address, type Account } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { PublicClient, WalletClient } from 'viem';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';
import { getENSClient } from '../server/singletons/ensClient';
import type { SessionPackage, DelegationSetup } from './sessionPackage';
import { buildDelegationSetup } from './sessionPackage';

/**
 * Get MetaMask Delegation Toolkit imports
 * Helper function to dynamically import and validate the toolkit
 */
async function getMetaMaskToolkit() {
  let toMetaMaskSmartAccount: any;
  let Implementation: any;
  try {
    const mod = await import('@metamask/delegation-toolkit');
    toMetaMaskSmartAccount = mod.toMetaMaskSmartAccount;
    Implementation = mod.Implementation;
  } catch (e: any) {
    throw new Error(
      '@metamask/delegation-toolkit package not installed. ' +
      'Install it with: pnpm add @metamask/delegation-toolkit ' +
      `Error: ${e?.message || e}`
    );
  }

  if (!toMetaMaskSmartAccount) {
    throw new Error(
      'toMetaMaskSmartAccount not found in @metamask/delegation-toolkit package. ' +
      'Please ensure the package is correctly installed.'
    );
  }

  if (!Implementation) {
    throw new Error(
      'Implementation not found in @metamask/delegation-toolkit package. ' +
      'Please ensure the package is correctly installed.'
    );
  }

  return { toMetaMaskSmartAccount, Implementation };
}

/**
 * Get AA account client by agent name
 * 
 * ⚠️ CLIENT-SIDE ONLY: This function requires access to the user's wallet (MetaMask/Web3Auth)
 * via window.ethereum. It cannot be used server-side.
 * 
 * For server-side address computation, use the `/api/agents/resolve-account` API route
 * which handles ENS resolution server-side. For deterministic computation, this function
 * must be called client-side because it requires the wallet client to create the MetaMask
 * smart account client.
 * 
 * Tries multiple resolution methods:
 * 1. Server-side: Resolve via ENS -> agent-identity -> agentId -> on-chain account (via API)
 * 2. Server-side: Get agent account via ENS name directly (via API)
 * 3. Client-side: Compute deterministically using agent name as salt (requires wallet client)
 * 
 * @param agentName - The agent name
 * @param eoaAddress - The EOA (Externally Owned Account) address that will own the AA account
 * @param options - Optional configuration
 * @param options.rpcUrl - RPC URL for the blockchain (defaults to env var or Sepolia)
 * @param options.chain - Chain configuration (defaults to Sepolia)
 * @param options.publicClient - Optional public client (will be created if not provided)
 * @param options.walletClient - Optional wallet client (will be created from window.ethereum if not provided)
 * @param options.ethereumProvider - Optional ethereum provider (for client-side, defaults to window.ethereum)
 * @returns The AA account client
 * @throws Error if computation fails or required dependencies are missing
 * @throws Error if called server-side without a wallet client provided
 */
export async function getAAAccountClientByAgentName(
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: {
    rpcUrl?: string;
    chain?: typeof sepolia;
    publicClient?: PublicClient;
    walletClient?: WalletClient;
    ethereumProvider?: any; // window.ethereum or similar
  }
): Promise<any> {
  const { toMetaMaskSmartAccount, Implementation } = await getMetaMaskToolkit();

  // Get RPC URL from options or environment
  const rpcUrl = options?.rpcUrl || 
                process.env.AGENTIC_TRUST_RPC_URL || ''

  // Get chain from options or default to Sepolia
  const resolvedChain = options?.chain || sepolia;

  // Create or use provided public client
  let publicClient: PublicClient;
  if (options?.publicClient) {
    publicClient = options.publicClient;
  } else {
    publicClient = createPublicClient({
      chain: resolvedChain as any,
      transport: http(rpcUrl),
    }) as any;
  }

  // Create or use provided wallet client
  let walletClient: WalletClient;
  if (options?.walletClient) {
    walletClient = options.walletClient;
  } else {
    // Check if we're in a browser environment
    const isBrowser = typeof window !== 'undefined';
    
    if (!isBrowser) {
      throw new Error(
        'getAAAccountClientByAgentName is client-side only. ' +
        'It requires access to the user\'s wallet (window.ethereum). ' +
        'For server-side address computation, use the /api/agents/resolve-account API route. ' +
        'If you need to create an AA account client server-side, provide a walletClient in the options.'
      );
    }
    
    // Try to get ethereum provider from options or window
    const provider = options?.ethereumProvider || (window as any).ethereum;
    
    if (!provider) {
      throw new Error(
        'No wallet provider found. ' +
        'Provide ethereumProvider option or ensure window.ethereum is available. ' +
        'This function requires access to the user\'s wallet (MetaMask/Web3Auth).'
      );
    }

    walletClient = createWalletClient({
      chain: resolvedChain as any,
      transport: custom(provider),
      account: eoaAddress as Address,
    });
  }

  try {
    // Ensure wallet is connected to the correct chain
    const currentChainId = await walletClient.getChainId();

    if (currentChainId !== resolvedChain.id) {
      console.info(`🔄 Wallet is on chain ${currentChainId}, switching to ${resolvedChain.id} (${resolvedChain.name})`);
      
      // Try to switch the wallet to the correct chain
      try {
        await walletClient.switchChain({ id: resolvedChain.id });
        console.info(`✅ Successfully switched to chain ${resolvedChain.id}`);
      } catch (switchError) {
        console.error(`❌ Failed to switch chain:`, switchError);
        throw new Error(`Wallet is connected to chain ${currentChainId} but expected chain ${resolvedChain.id}. Please switch to ${resolvedChain.name} manually.`);
      }
    }

    // ENS resolution is server-side only
    // When called from browser, try API route first, then fall back to deterministic computation
    const isServerSide = typeof window === 'undefined';
    
    if (agentName && agentName.trim() !== '') {
      if (isServerSide) {
        // Server-side: Use ENS client directly
        try {
          const ensClient = await getENSClient();
          
          // Check if ENS client is properly configured (has ensRegistryAddress)
          const ensRegistryAddress = (ensClient as any)?.ensRegistryAddress;
          if (ensClient && ensRegistryAddress && ensRegistryAddress !== '' && ensRegistryAddress !== '0x0000000000000000000000000000000000000000') {
            try {
              const { agentId, account } = await ensClient.getAgentIdentityByName(agentName.trim());
              if (account && account !== '0x0000000000000000000000000000000000000000') {
                const agentAccountClient = await toMetaMaskSmartAccount({
                  address: account as `0x${string}`,
                  client: publicClient,
                  implementation: Implementation.Hybrid,
                  signatory: { walletClient },
                });
                
                return agentAccountClient;
              }
            } catch (ensError) {
              console.warn('ENS resolution failed, falling back to deterministic computation:', ensError);
            }

            // Try to get agent account via ENS name directly
            try {
              const ensAgentAddress = await ensClient.getAgentAccountByName(agentName);
              if (ensAgentAddress && ensAgentAddress !== '0x0000000000000000000000000000000000000000') {
                const agentAccountClient = await toMetaMaskSmartAccount({
                  address: ensAgentAddress as `0x${string}`,
                  client: publicClient,
                  implementation: Implementation.Hybrid,
                  signatory: { walletClient },
                });

                console.info("++++++++++++++ ens found with name", agentName, agentAccountClient.address);
                return agentAccountClient;
              }
            } catch (ensError) {
              console.warn('ENS account lookup failed, falling back to deterministic computation:', ensError);
            }
          }
        } catch (error: any) {
          console.error("error getting agent by name (server-side)", agentName, error);
          // Continue to fallback method
        }
      } else {
        // Client-side: Call API route for ENS resolution
        try {
          const response = await fetch('/api/agents/resolve-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentName: agentName.trim() }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.account && data.account !== '0x0000000000000000000000000000000000000000') {
              // Found via ENS resolution
              const agentAccountClient = await toMetaMaskSmartAccount({
                address: data.account as `0x${string}`,
                client: publicClient,
                implementation: Implementation.Hybrid,
                signatory: { walletClient },
              });
              
              console.info(`ENS resolution found account via ${data.method}:`, data.account);
              return agentAccountClient;
            }
            // No ENS resolution found, will fall through to deterministic computation
            console.info('No ENS resolution found, using deterministic computation');
          } else {
            console.warn('ENS resolution API call failed, using deterministic computation');
          }
        } catch (error: any) {
          console.warn('Error calling ENS resolution API, using deterministic computation:', error);
          // Continue to fallback method
        }
      }
    }

    // Fallback: use agentName to get salt and compute deterministically
    const salt: `0x${string}` = keccak256(stringToHex(agentName)) as `0x${string}`;
    const agentAccountClient = await toMetaMaskSmartAccount({
      client: publicClient,
      implementation: Implementation.Hybrid,
      deployParams: [eoaAddress as `0x${string}`, [], [], []],
      signatory: { walletClient },
      deploySalt: salt,
    } as any);
    
    return agentAccountClient;
  } catch (error) {
    console.error('Error getting AA account client by agent name:', error);
    throw new Error(
      `Failed to get AA account client: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Compute a deterministic Account Abstraction (AA) address for an agent
 * Uses MetaMask Smart Account with Hybrid implementation
 * 
 * @param agentName - The agent name (used as salt for deterministic address)
 * @param eoaAddress - The EOA (Externally Owned Account) address that will own the AA account
 * @param options - Optional configuration
 * @param options.rpcUrl - RPC URL for the blockchain (defaults to env var or Sepolia)
 * @param options.chain - Chain configuration (defaults to Sepolia)
 * @param options.publicClient - Optional public client (will be created if not provided)
 * @param options.walletClient - Optional wallet client (will be created from window.ethereum if not provided)
 * @param options.ethereumProvider - Optional ethereum provider (for client-side, defaults to window.ethereum)
 * @returns The computed AA address
 * @throws Error if computation fails or required dependencies are missing
 */
export async function getAAAddress(
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: {
    rpcUrl?: string;
    chain?: typeof sepolia;
    publicClient?: PublicClient;
    walletClient?: WalletClient;
    ethereumProvider?: any; // window.ethereum or similar
  }
): Promise<`0x${string}`> {
  const agentAccountClient = await getAAAccountClientByAgentName(agentName, eoaAddress, options);
  const computedAddress = await agentAccountClient.getAddress();
  return computedAddress as `0x${string}`;
}

/**
 * Build agent account from session package
 * Uses MetaMask smart account implementation
 * 
 * @param sessionPackage - Optional session package (if not provided, will use DelegationSetup)
 * @param delegationSetup - Optional delegation setup (if not provided, will build from sessionPackage)
 * @returns The agent account (AA client)
 */
export async function buildAgentAccountFromSession(
  sessionPackage?: SessionPackage,
  delegationSetup?: DelegationSetup
): Promise<Account> {
  // Build delegation setup if not provided
  let sp: DelegationSetup;
  if (delegationSetup) {
    sp = delegationSetup;
  } else if (sessionPackage) {
    sp = buildDelegationSetup(sessionPackage);
  } else {
    throw new Error('Either sessionPackage or delegationSetup must be provided');
  }
  
  // Create public client for the chain
  const l1PublicClient = createPublicClient({ 
    chain: sp.chain, 
    transport: http(sp.rpcUrl) 
  });

  // Create EOA account from session key for signing
  const agentOwnerEOA = privateKeyToAccount(sp.sessionKey.privateKey);

  // Get MetaMask toolkit
  const { toMetaMaskSmartAccount, Implementation } = await getMetaMaskToolkit();

  // Use sessionAA address from session package, or fallback to aa address
  const agentOwnerAddress = sp.sessionAA || sp.aa;

  // Create smart account client
  console.info("pK: ", sp.sessionKey.privateKey);
  console.info("agentOwnerAddress: ", agentOwnerAddress);
  console.info("agentOwnerEOA: ", agentOwnerEOA);

  const agentAccountClient = await toMetaMaskSmartAccount({
    address: agentOwnerAddress as `0x${string}`,
    client: l1PublicClient,
    implementation: Implementation.Hybrid,
    signatory: { account: agentOwnerEOA },
  } as any);

  console.info("agentAccountClient.address: ", agentAccountClient.address);

  // Return the account from the smart account client
  return agentAccountClient as Account;
}

