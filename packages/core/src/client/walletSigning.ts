/**
 * Client-side wallet signing utilities
 * 
 * Handles MetaMask/EIP-1193 wallet integration for signing and sending transactions
 * All Ethereum logic is handled server-side, client only needs to sign and send
 */

import type { Address, Chain, Hex } from 'viem';

/**
 * Transaction prepared by server for client-side signing
 */
export interface PreparedTransaction {
  to: `0x${string}`;
  data: `0x${string}`;
  value: `0x${string}`;
  gas?: `0x${string}`;
  gasPrice?: `0x${string}`;
  maxFeePerGas?: `0x${string}`;
  maxPriorityFeePerGas?: `0x${string}`;
  nonce?: number;
  chainId: number;
}

/**
 * Result of signing and sending a transaction
 */
export interface TransactionResult {
  hash: `0x${string}`;
  receipt: any;
  agentId?: string; // Extracted agentId for agent creation transactions
}

/**
 * Options for signing a transaction
 */
export interface SignTransactionOptions {
  transaction: PreparedTransaction;
  account: Address;
  chain: Chain;
  ethereumProvider?: any; // window.ethereum or compatible EIP-1193 provider
  rpcUrl?: string; // Optional RPC URL for waiting for receipt (defaults to chain RPC)
  onStatusUpdate?: (message: string) => void; // Optional callback for status updates
  extractAgentId?: boolean; // Whether to extract agentId from receipt (for agent creation)
}

/**
 * Sign and send a transaction using MetaMask/EIP-1193 wallet
 * 
 * @param options - Signing options including transaction, account, chain, and provider
 * @returns Transaction hash, receipt, and optionally extracted agentId
 */
export async function signAndSendTransaction(
  options: SignTransactionOptions
): Promise<TransactionResult> {
  const {
    transaction,
    account,
    chain,
    ethereumProvider,
    rpcUrl,
    onStatusUpdate,
    extractAgentId = false,
  } = options;

  // Dynamically import viem (client-side only)
  const { createWalletClient, custom, createPublicClient, http } = await import('viem');

  // Get wallet provider
  const provider = ethereumProvider || (typeof window !== 'undefined' ? (window as any).ethereum : null);
  
  if (!provider) {
    throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
  }

  // Update status
  onStatusUpdate?.('Connecting to wallet...');

  // Create wallet client
  const walletClient = createWalletClient({
    account,
    chain,
    transport: custom(provider),
  });

  // Update status
  onStatusUpdate?.('Transaction prepared. Please confirm in your wallet...');

  // Convert hex strings to bigint for Viem (Viem accepts both, but TypeScript is strict)
  const txParams: any = {
    ...transaction,
    value: BigInt(transaction.value),
  };
  
  if (transaction.gas) {
    txParams.gas = BigInt(transaction.gas);
  }
  if (transaction.gasPrice) {
    txParams.gasPrice = BigInt(transaction.gasPrice);
  }
  if (transaction.maxFeePerGas) {
    txParams.maxFeePerGas = BigInt(transaction.maxFeePerGas);
  }
  if (transaction.maxPriorityFeePerGas) {
    txParams.maxPriorityFeePerGas = BigInt(transaction.maxPriorityFeePerGas);
  }

  // Sign and send transaction
  const hash = await walletClient.sendTransaction(txParams);

  // Update status
  onStatusUpdate?.(`Transaction submitted! Hash: ${hash}. Waiting for confirmation...`);

  // Wait for transaction receipt
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl || chain.rpcUrls.default.http[0]),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Extract agentId if requested (for agent creation transactions)
  let agentId: string | undefined;
  if (extractAgentId) {
    try {
      agentId = extractAgentIdFromReceipt(receipt);
    } catch (error) {
      console.warn('Could not extract agentId from receipt:', error);
    }
  }

  return {
    hash,
    receipt,
    agentId,
  };
}

/**
 * Extract agentId from a transaction receipt (for agent creation)
 * Looks for ERC-721 Transfer event from zero address
 * 
 * @param receipt - Transaction receipt
 * @returns Extracted agentId as string, or undefined if not found
 */
export function extractAgentIdFromReceipt(receipt: any): string | undefined {
  try {
    // ERC-721 Transfer event signature
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    // Zero address topic (from address)
    const zeroAddress = '0x0000000000000000000000000000000000000000000000000000000000000000';
    
    if (!receipt.logs || !Array.isArray(receipt.logs)) {
      return undefined;
    }

    for (const log of receipt.logs) {
      if (log.topics && log.topics[0] === transferTopic && log.topics[1] === zeroAddress) {
        // Extract tokenId (agentId) from topics[3]
        if (log.topics[3]) {
          return BigInt(log.topics[3]).toString();
        }
      }
    }

    return undefined;
  } catch (error) {
    console.warn('Error extracting agentId from receipt:', error);
    return undefined;
  }
}

/**
 * Refresh agent in GraphQL indexer
 * 
 * @param agentId - Agent ID to refresh
 * @param refreshEndpoint - Optional custom refresh endpoint (defaults to `/api/agents/${agentId}/refresh`)
 * @returns Promise that resolves when refresh is complete
 */
export async function refreshAgentInIndexer(
  agentId: string,
  refreshEndpoint?: string
): Promise<void> {
  const endpoint = refreshEndpoint || `/api/agents/${agentId}/refresh`;
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}), // Send empty body to avoid JSON parsing errors
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Failed to refresh agent ${agentId} in GraphQL indexer: ${response.status} ${response.statusText}`, errorText);
      return;
    }
    
    // Try to parse response, but don't fail if it's empty
    try {
      const data = await response.json();
      console.log(`✅ Refreshed agent ${agentId} in GraphQL indexer`, data);
    } catch (parseError) {
      // Response might be empty, that's okay
      console.log(`✅ Refreshed agent ${agentId} in GraphQL indexer`);
    }
  } catch (error) {
    console.warn(`Error refreshing agent ${agentId} in GraphQL indexer:`, error);
  }
}

/**
 * Check if wallet provider is available
 * 
 * @param ethereumProvider - Optional provider (defaults to window.ethereum)
 * @returns true if provider is available
 */
export function isWalletProviderAvailable(ethereumProvider?: any): boolean {
  if (ethereumProvider) {
    return true;
  }
  
  if (typeof window === 'undefined') {
    return false;
  }
  
  return !!(window as any).ethereum;
}

/**
 * Get the connected wallet address from provider
 * 
 * @param ethereumProvider - Optional provider (defaults to window.ethereum)
 * @returns Connected wallet address, or null if not connected
 */
export async function getWalletAddress(ethereumProvider?: any): Promise<Address | null> {
  const provider = ethereumProvider || (typeof window !== 'undefined' ? (window as any).ethereum : null);
  
  if (!provider) {
    return null;
  }

  try {
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) {
      return accounts[0] as Address;
    }
    return null;
  } catch (error) {
    console.warn('Error getting wallet address:', error);
    return null;
  }
}

/**
 * Options for creating an agent with wallet signing
 * Only agentData is required - everything else is automatically detected
 */
export interface CreateAgentWithWalletOptions {
  agentData: {
    agentName: string;
    agentAccount: `0x${string}`;
    description?: string;
    image?: string;
    agentUrl?: string;
  };
  account?: Address; // Optional - will be fetched from wallet if not provided
  ethereumProvider?: any; // Optional - defaults to window.ethereum
  rpcUrl?: string; // Optional - can be in response or environment variable
  onStatusUpdate?: (message: string) => void;
  // Account Abstraction options
  useAA?: boolean; // If true, use bundler for AA account (bundlerUrl is read from AGENTIC_TRUST_BUNDLER_URL env var on server)
}

/**
 * Result of creating an agent
 */
export interface CreateAgentResult {
  agentId?: string;
  txHash: string;
  requiresClientSigning: boolean;
}

/**
 * Create an agent with automatic wallet signing if needed
 * 
 * This method handles the entire flow:
 * 1. Calls the API to create agent (endpoint: /api/agents/create-for-eoa)
 * 2. If client-side signing is required, signs and sends transaction
 * 3. Waits for receipt and extracts agentId
 * 4. Refreshes GraphQL indexer
 * 
 * Only agentData is required - account, chain, and provider are auto-detected
 * 
 * @param options - Creation options (only agentData required)
 * @returns Agent creation result
 */
export async function createAgentWithWalletForEOA(
  options: CreateAgentWithWalletOptions
): Promise<CreateAgentResult> {
  const {
    agentData,
    account: providedAccount,
    ethereumProvider: providedProvider,
    rpcUrl: providedRpcUrl,
    onStatusUpdate,
  } = options;

  // Get wallet provider (default to window.ethereum)
  const ethereumProvider = providedProvider || (typeof window !== 'undefined' ? (window as any).ethereum : null);
  
  if (!ethereumProvider) {
    throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
  }

  // Get account from provider if not provided
  let account: Address;
  if (providedAccount) {
    account = providedAccount;
  } else {
    const accounts = await ethereumProvider.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0) {
      throw new Error('Wallet not connected. Please connect your wallet first.');
    }
    account = accounts[0] as Address;
  }

  // Step 1: Call API to create agent
  onStatusUpdate?.('Creating agent...');
  
  // Prepare request body with AA parameters if needed
  const requestBody: any = {
    ...agentData,
  };
  
  
  const response = await fetch('/api/agents/create-for-eoa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || errorData.error || 'Failed to create agent');
  }

  const data = await response.json();

  // Step 2: Check if client-side AA account client creation is required
  console.info("*********** walletSigning createAgentWithWallet1: requiresClientSigning", data.requiresClientSigning);
  if (data.requiresClientSigning && data.requiresAAClient && data.calls) {
    console.info("*********** walletSigning createAgentWithWallet: data", data);
    onStatusUpdate?.('Building AA account client and sending UserOperation...');
    
    // Build AA account client using client's EOA (MetaMask/Web3Auth)
    const { getAAAccountClientByAgentName } = await import('./aaClient');
    const { sepolia, baseSepolia, optimismSepolia } = await import('viem/chains');
    
    // Get chain from chainId
    let chain: Chain;
    switch (data.chainId) {
      case 11155111: // ETH Sepolia
        chain = sepolia;
        break;
      case 84532: // Base Sepolia
        chain = baseSepolia;
        break;
      case 11155420: // Optimism Sepolia
        chain = optimismSepolia;
        break;
      default:
        chain = sepolia;
        console.warn(`Unknown chainId ${data.chainId}, defaulting to Sepolia`);
    }

    // Get RPC URL
    const rpcUrl = providedRpcUrl || 
      (typeof process !== 'undefined' && process.env?.AGENTIC_TRUST_RPC_URL) ||
      '';

    // Get agent name from request
    const agentName = options.agentData.agentName;

    // Build AA account client using the new logic (tries ENS resolution first, then deterministic)
    const agentAccountClient = await getAAAccountClientByAgentName(
      agentName,
      account,
      {
        chain: chain as any,
        rpcUrl,
        ethereumProvider,
      }
    );

    if (!agentAccountClient) {
      throw new Error('Failed to build AA account client');
    }

    // Verify the address matches
    const computedAddress = await agentAccountClient.getAddress();
    if (computedAddress.toLowerCase() !== options.agentData.agentAccount.toLowerCase()) {
      throw new Error(`AA address mismatch: computed ${computedAddress}, expected ${options.agentData.agentAccount}`);
    }

    // Deploy smart account if needed
    onStatusUpdate?.('Deploying smart account if needed...');
    const { deploySmartAccountIfNeeded, sendSponsoredUserOperation, waitForUserOperationReceipt } = await import('./bundlerUtils');
    await deploySmartAccountIfNeeded({
      bundlerUrl: data.bundlerUrl,
      chain: chain as any,
      account: agentAccountClient,
    });

    // Convert calls to the format expected by bundler
    const calls = data.calls.map((call: any) => ({
      to: call.to as `0x${string}`,
      data: call.data as `0x${string}`,
      value: BigInt(call.value || '0'),
    }));

    // Send UserOperation via bundler
    onStatusUpdate?.('Sending UserOperation via bundler...');
    const userOpHash = await sendSponsoredUserOperation({
      bundlerUrl: data.bundlerUrl,
      chain: chain as any,
      accountClient: agentAccountClient,
      calls,
    });

    onStatusUpdate?.(`UserOperation sent! Hash: ${userOpHash}. Waiting for confirmation...`);

    // Wait for receipt
    const receipt = await waitForUserOperationReceipt({
      bundlerUrl: data.bundlerUrl,
      chain: chain as any,
      hash: userOpHash,
    });

    // Extract agentId from receipt logs
    let agentId: string | undefined;
    if (receipt.logs && receipt.logs.length > 0) {
      // Look for IdentityRegistered event
      const identityRegistry = process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY || 
                               process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      if (identityRegistry) {
        // Parse logs to find agentId (similar to regular transaction parsing)
        // This is a simplified version - you may need to adjust based on your event structure
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() === identityRegistry.toLowerCase()) {
            // Extract agentId from log data (adjust based on your event structure)
            // For now, we'll refresh the indexer and let it pick up the agent
          }
        }
      }
    }


    // 2. Set agent name info within ENS
    console.log('********************* prepareSetAgentNameInfoCalls');
    const { calls: agentCalls } = await agentENSClient.prepareSetAgentNameInfoCalls({
      orgName: cleanOrgName,
      agentName: cleanAgentName,
      agentAddress: agentAccount,
      agentUrl: agentUrl,
      agentDescription: agentDescription
    });

    const userOpHash2 = await sendSponsoredUserOperation({
      bundlerUrl,
      chain,
      accountClient: agentAccountClient,
      calls: agentCalls,
    });

    const { receipt: agentReceipt } = await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOpHash2 });
    console.log('********************* agentReceipt', agentReceipt);

    // 3. Set agent image if provided
    if (agentImage && agentImage.trim() !== '') {
      const ensFullName = `${cleanAgentName}.${cleanOrgName}.eth`;
      const { calls: imageCalls } = await agentENSClient.prepareSetNameImageCalls(ensFullName, agentImage.trim());
      
      if (imageCalls.length > 0) {
        const userOpHash3 = await sendSponsoredUserOperation({
          bundlerUrl,
          chain,
          accountClient: agentAccountClient,
          calls: imageCalls,
        });

        await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOpHash3 });
      }
    }


    // Refresh GraphQL indexer
    if (agentId) {
      await refreshAgentInIndexer(agentId);
    } else {
      // If we can't extract agentId, refresh using the agent account address
      // The indexer should be able to find it
      onStatusUpdate?.('Refreshing GraphQL indexer...');
      try {
        // We'll need to call the refresh endpoint with the agent account
        // For now, we'll just log that we need to refresh
        console.log('UserOperation confirmed. Please refresh the agent list to see the new agent.');
      } catch (error) {
        console.warn('Could not refresh agent in indexer:', error);
      }
    }

    return {
      agentId,
      txHash: userOpHash,
      requiresClientSigning: true,
    };
  }

  // Step 3: Check if client-side signing is required (regular EOA transaction)
  if (data.requiresClientSigning && data.transaction) {
    // Get chain from transaction chainId
    const chainId = data.transaction.chainId;
    let chain: Chain;
    
    // Import chains and find the matching one
    const chainsModule = await import('viem/chains');
    const { sepolia, baseSepolia, optimismSepolia } = chainsModule;
    
    // Map chainId to chain
    switch (chainId) {
      case 11155111: // ETH Sepolia
        chain = sepolia;
        break;
      case 84532: // Base Sepolia
        chain = baseSepolia;
        break;
      case 11155420: // Optimism Sepolia
        chain = optimismSepolia;
        break;
      default:
        // Fallback to sepolia if chain not found
        chain = sepolia;
        console.warn(`Unknown chainId ${chainId}, defaulting to Sepolia`);
    }

    // Get RPC URL from environment or use default
    const rpcUrl = providedRpcUrl || 
      (typeof process !== 'undefined' && process.env?.AGENTIC_TRUST_RPC_URL) ||
      undefined;

    // Sign and send transaction
    const result = await signAndSendTransaction({
      transaction: data.transaction,
      account,
      chain,
      ethereumProvider,
      rpcUrl,
      onStatusUpdate,
      extractAgentId: true, // Extract agentId for agent creation
    });

    // Step 3: Refresh GraphQL indexer if agentId was extracted
    if (result.agentId) {
      await refreshAgentInIndexer(result.agentId);
    }

    return {
      agentId: result.agentId,
      txHash: result.hash,
      requiresClientSigning: true,
    };
  } else {
    // Server-side signed transaction
    // Ensure we have the required fields
    if (!data.agentId || !data.txHash) {
      throw new Error(`Invalid response from create agent API. Expected agentId and txHash, got: ${JSON.stringify(data)}`);
    }
    
    const agentIdStr = data.agentId.toString();
    
    // Refresh GraphQL indexer for server-side signed transactions too
    if (agentIdStr) {
      try {
        await refreshAgentInIndexer(agentIdStr);
      } catch (error) {
        // Don't fail the whole operation if refresh fails
        console.warn('Failed to refresh agent in indexer:', error);
      }
    }
    
    return {
      agentId: agentIdStr,
      txHash: data.txHash,
      requiresClientSigning: false,
    };
  }
}


export async function createAgentWithWalletForAA(
  options: CreateAgentWithWalletOptions
): Promise<CreateAgentResult> {

  return {
    agentId: "",
    txHash: "",
    requiresClientSigning: false,
  };
}

