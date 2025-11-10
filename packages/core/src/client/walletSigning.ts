/**
 * Client-side wallet signing utilities
 * 
 * Handles MetaMask/EIP-1193 wallet integration for signing and sending transactions
 * All Ethereum logic is handled server-side, client only needs to sign and send
 */

import {
  createWalletClient,
  custom,
  createPublicClient,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { getChainById, DEFAULT_CHAIN_ID, getChainRpcUrl, getChainBundlerUrl, sepolia, baseSepolia, optimismSepolia, isL1, isL2 } from '../server/lib/chainConfig';
import { getDeployedAccountClientByAgentName } from './aaClient';
import {
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
} from './bundlerUtils';
export {
  getDeployedAccountClientByAgentName,
  getCounterfactualAccountClientByAgentName,
} from './aaClient';

function resolveEthereumProvider(providedProvider?: any): any {
  if (providedProvider) return providedProvider;
  if (typeof window !== 'undefined') {
    const web3authProvider = (window as any)?.web3auth?.provider;
    if (web3authProvider) return web3authProvider;
    const injected = (window as any).ethereum;
    if (injected) return injected;
  }
  return null;
}

async function resolveChainId(ethereumProvider: any): Promise<number> {
  try {
    const chainHex = await ethereumProvider.request?.({ method: 'eth_chainId' });
    if (typeof chainHex === 'string') {
      return parseInt(chainHex, 16);
    }
  } catch {
    // ignore; fallback below
  }
  // Fallback to default chain id
  return DEFAULT_CHAIN_ID;
}

/**
 * Ensure the provider has an authorized account and return it.
 * Tries eth_accounts first; if empty, requests eth_requestAccounts.
 */
async function ensureAuthorizedAccount(ethereumProvider: any): Promise<Address> {
  try {
    const existing = await ethereumProvider.request({ method: 'eth_accounts' });
    if (Array.isArray(existing) && existing.length > 0) {
      return existing[0] as Address;
    }
  } catch {
    // ignore and fall through to request
  }
  try {
    const granted = await ethereumProvider.request({ method: 'eth_requestAccounts' });
    if (Array.isArray(granted) && granted.length > 0) {
      return granted[0] as Address;
    }
  } catch {
    // fallthrough to permissions flow
  }
  try {
    await ethereumProvider.request?.({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
    });
    const afterPerm = await ethereumProvider.request({ method: 'eth_accounts' });
    if (Array.isArray(afterPerm) && afterPerm.length > 0) {
      return afterPerm[0] as Address;
    }
  } catch {
    // ignore
  }
  throw new Error('Wallet not authorized. Please connect your wallet.');
}

async function ensureChainSelected(ethereumProvider: any, chain: Chain): Promise<void> {
  try {
    const currentHex = await ethereumProvider.request?.({ method: 'eth_chainId' });
    const current = typeof currentHex === 'string' ? parseInt(currentHex, 16) : undefined;
    if (current === chain.id) return;
  } catch {
    // continue to switch
  }
  const hexId = `0x${chain.id.toString(16)}`;
  try {
    await ethereumProvider.request?.({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexId }],
    });
    return;
  } catch (switchErr: any) {
    // 4902 = unknown chain, try add then switch
    if (switchErr?.code !== 4902) {
      throw switchErr;
    }
  }
  // Try to add chain using centralized configuration
  const chainConfig = getChainById(chain.id);
  const addParams = {
    chainId: hexId,
    chainName: chainConfig.name,
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: [getChainRpcUrl(chain.id)],
    blockExplorerUrls: chainConfig.blockExplorers?.default ? [chainConfig.blockExplorers.default.url] : [],
  };
  await ethereumProvider.request?.({
    method: 'wallet_addEthereumChain',
    params: [addParams],
  });
  await ethereumProvider.request?.({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: hexId }],
  });
}

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
    onStatusUpdate,
    extractAgentId = false,
  } = options;

  // Get wallet provider
  const provider = resolveEthereumProvider(ethereumProvider);
  
  if (!provider) {
    throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
  }

  // Update status
  onStatusUpdate?.('Connecting to wallet...');

  // Create wallet client
  try {
    // Ensure correct chain & account permission before sending
    await ensureChainSelected(provider, chain);
    await ensureAuthorizedAccount(provider);
  } catch {
    // Non-fatal; some providers may not require this here
  }
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
    transport: custom(ethereumProvider),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Extract agentId if requested (for agent creation transactions)
  let agentId: string | undefined;
  if (receipt && Array.isArray(receipt.logs)) {
    const zeroTopic = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const mintLog = receipt.logs.find(
      (log: any) =>
        log?.topics?.[0] === transferTopic &&
        (log?.topics?.[1] === zeroTopic || log?.topics?.[1] === undefined)
    );
    if (mintLog) {
      const tokenTopic = mintLog.topics?.[3];
      const tokenData = mintLog.data;
      const tokenHex = tokenTopic ?? tokenData;
      if (tokenHex) {
        try {
          agentId = BigInt(tokenHex).toString();
        } catch (error) {
          console.warn('Unable to parse agentId from mint log:', error);
        }
      }
    }
  }
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
  ensOptions?: {
    enabled?: boolean;
    orgName?: string;
  };
  chainId?: number; // Explicit chain selection from UI
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
    chainId: requestedChainId,
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
    account = await ensureAuthorizedAccount(ethereumProvider);
  }

  // Step 1: Call API to create agent
  onStatusUpdate?.('Creating agent...');
  
  // Prepare request body with AA parameters if needed
  const requestBody: any = {
    ...agentData,
    chainId: requestedChainId,
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

  // Step 2: Check if client-side signing is required (regular EOA transaction)
  if (data.requiresClientSigning && data.transaction) {
    // Get chain from transaction chainId
    const chainId = data.transaction.chainId;
    const chain = getChainById(chainId);


    // Sign and send transaction
    const result = await signAndSendTransaction({
      transaction: data.transaction,
      account,
      chain,
      ethereumProvider,

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
  const {
    agentData,
    account: providedAccount,
    ethereumProvider: providedProvider,
    rpcUrl: providedRpcUrl,
    onStatusUpdate,
    chainId: providedChainId,
  } = options;


  // Get wallet provider (default to window.ethereum)
  const ethereumProvider = resolveEthereumProvider(providedProvider);
  
  if (!ethereumProvider) {
    throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
  }

  // Get account from provider if not provided
  let account: Address;
  if (providedAccount) {
    account = providedAccount;
  } else {
    account = await ensureAuthorizedAccount(ethereumProvider);
  }

  const chainId = typeof providedChainId === 'number'
    ? providedChainId
    : await resolveChainId(ethereumProvider);

  // Step 1: Call API to create agent
  onStatusUpdate?.('Creating agent...');
  


  // 0.  Get on the correct chain get adapter for the chain

  let chain: Chain;
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
      chain = sepolia;
      console.warn(`Unknown chainId ${chainId}, defaulting to Sepolia`);
  }

  // Ensure provider is on the required chain before building clients
  try {
    await ensureChainSelected(ethereumProvider, chain);
  } catch (switchErr) {
    console.warn('Unable to switch chain on provider for AA flow:', switchErr);
  }

  // Build viem clients bound to the user's Web3Auth provider
  const viemWalletClient = createWalletClient({
    account,
    chain,
    transport: custom(ethereumProvider),
  });
  const viemPublicClient = createPublicClient({
    chain,
    transport: custom(ethereumProvider),
  });

  // 1.  Need to create the Agent Account Abstraction (Account)

  // Build AA account client using client's EOA (MetaMask/Web3Auth)


  // Get agent name from request
  //let agentFullName = options.agentData.agentName;
  //if (options.ensOptions?.orgName) {
  //  agentFullName = options.agentData.agentName + '.' + options.ensOptions?.orgName + ".eth";
  //}

  

  // Get Account Client by Agent Name, find if exists and if not then create it
  const bundlerUrl = getChainBundlerUrl(chainId);

  let agentAccountClient = await getDeployedAccountClientByAgentName(
    bundlerUrl,
    options.agentData.agentName,
    account,
    {
      chain: chain as any,
      walletClient: viemWalletClient as any,
      publicClient: viemPublicClient as any,
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


    // 2.  Add ENS record associated with new agent

    console.log('*********** createAgentWithWalletForAA: options.ensOptions', options.ensOptions);
    
    if (options.ensOptions?.enabled && options.ensOptions.orgName && isL1(chainId)) {
      try {
        const ensAgentAccount = (typeof computedAddress === 'string' && computedAddress.startsWith('0x'))
          ? computedAddress
          : options.agentData.agentAccount;
  
        onStatusUpdate?.('Creating ENS subdomain for agent: ' + options.agentData.agentName);
        const ensResponse = await fetch('/api/agents/ens/addToL1Org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentAccount: ensAgentAccount,
            orgName: options.ensOptions.orgName,
            agentName: options.agentData.agentName,
            agentUrl: options.agentData.agentUrl,
            chainId,
          }),
        });

        onStatusUpdate?.('Preparing ENS metadata update...');
        const infoResponse = await fetch('/api/agents/ens/setL1NameInfo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentAddress: ensAgentAccount,
            orgName: options.ensOptions.orgName,
            agentName: options.agentData.agentName,
            agentUrl: options.agentData.agentUrl,
            agentDescription: options.agentData.description,
            chainId,
          }),
        });
 
        if (infoResponse.ok) {
          console.log('*********** createAgentWithWalletForAA: ENS metadata response received');
          const infoData = await infoResponse.json();
          const serverInfoUserOpHash = (infoData as any)?.userOpHash as string | undefined;
          if (serverInfoUserOpHash) {
            console.log('*********** createAgentWithWalletForAA: ENS info userOpHash (server-submitted)', serverInfoUserOpHash);
          } else {
            const infoCalls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];

            if (Array.isArray(infoData?.calls)) {
              for (const rawCall of infoData.calls as Array<Record<string, unknown>>) {
                const to = rawCall?.to as `0x${string}` | undefined;
                const data = rawCall?.data as `0x${string}` | undefined;
                if (!to || !data) {
                  continue;
                }

                let value: bigint | undefined;
                if (rawCall?.value !== null && rawCall?.value !== undefined) {
                  try {
                    value = BigInt(rawCall.value as string | number | bigint);
                  } catch (error) {
                    console.warn('Unable to parse ENS info call value', rawCall.value, error);
                  }
                }

                infoCalls.push({
                  to,
                  data,
                  value,
                });
              }
            }

            if (infoCalls.length > 0) {
              onStatusUpdate?.('Updating ENS agent info...');
              // Ensure we are using a deployed-only AA client (no factory/factoryData)
              //const fullAgentName = agentName + '.' + options.ensOptions.orgName + ".eth";
              console.log('!!!!!!!!!!!! handleCreateAgent: getDeployedAccountClientByAgentName 2: agentName', options.agentData.agentName);
              agentAccountClient = await getDeployedAccountClientByAgentName(
                bundlerUrl,
                options.agentData.agentName,
                account,
                {
                  chain: chain as any,
                  walletClient: viemWalletClient as any,
                  publicClient: viemPublicClient as any,
                }
              );
              const infoUserOpHash = await sendSponsoredUserOperation({
                bundlerUrl,
                chain: chain as any,
                accountClient: agentAccountClient,
                calls: infoCalls,
              });

              await waitForUserOperationReceipt({
                bundlerUrl,
                chain: chain as any,
                hash: infoUserOpHash,
              });
            }
          }
        } else {
          const errorPayload = await infoResponse.json().catch(() => ({}));
          console.warn('Failed to prepare ENS metadata calls:', errorPayload);
        }
  
        console.log('Requested ENS record creation and metadata update for agent', options.agentData.agentName);
      } catch (ensError) {
        console.warn('Failed to create ENS record for agent:', ensError);
      }
    }
    else if (options.ensOptions?.enabled && options.ensOptions.orgName && isL2(chainId)) {
      const rawOrg = options.ensOptions.orgName || '';
      const rawAgent = options.agentData.agentName || '';
      const cleanOrgName = rawOrg.replace(/\.eth$/i, '').toLowerCase();
      const orgPattern = cleanOrgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cleanAgentName = rawAgent
        .replace(new RegExp(`^${orgPattern}\\.`, 'i'), '')
        .replace(/\.eth$/i, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
      const agentUrl = options.agentData.agentUrl;
      const agentDescription = options.agentData.description;
      const agentImage = options.agentData.image;
      
      // Prepare all necessary L2 ENS calls server-side, then send them as one user operation
      const prepareResp = await fetch('/api/agents/ens/addToL2Org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentAddress: agentAccountClient.address,
          orgName: cleanOrgName,
          agentName: cleanAgentName,
          agentUrl,
          agentDescription,
          agentImage,
          chainId,
        }),
      });
      if (!prepareResp.ok) {
        const errorPayload = await prepareResp.json().catch(() => ({}));
        console.warn('Failed to prepare L2 ENS calls:', errorPayload);
      } else {
        const { calls: rawCalls } = await prepareResp.json();
        const l2EnsCalls = (rawCalls || []).map((call: any) => ({
          to: call.to as `0x${string}`,
          data: call.data as `0x${string}`,
          value: BigInt(call.value || '0'),
        }));
        if (l2EnsCalls.length > 0) {
          for (const call of l2EnsCalls) {
            console.log('********************* send sponsored user operation for L2 ENS call');
            const userOpHash = await sendSponsoredUserOperation({
              bundlerUrl,
              chain,
              accountClient: agentAccountClient,
              calls: [call],
            });
            await waitForUserOperationReceipt({
              bundlerUrl,
              chain,
              hash: userOpHash,
            });
          }
        }
      }
    }





  // 2.  Need to create the Agent Identity (NFT)

  console.log('*********** createAgentWithWalletForAA: creating agent identity...');
  const finalAgentName =
        options.ensOptions?.enabled && options.ensOptions?.orgName
          ? `${options.agentData.agentName}.${options.ensOptions?.orgName}.eth`
          : options.agentData.agentName;
  agentData.agentName = finalAgentName;

  // Prepare request body with AA parameters if needed
  const requestBody: any = {
    account: computedAddress,
    ...agentData,
    chainId,
  };

  const response = await fetch('/api/agents/create-for-aa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || errorData.error || 'Failed to create agent');
  }

  const data = await response.json();

  if (!Array.isArray(data.calls) || data.calls.length === 0) {
    throw new Error('Agent creation response missing register calls');
  }


  // Construct Agent Identity with agentAccount Client
  const createAgentIdentityCalls = data.calls.map((call: any) => ({
    to: call.to as `0x${string}`,
    data: call.data as `0x${string}`,
    value: BigInt(call.value || '0'),
  }));

  // Send UserOperation via bundler
  
  onStatusUpdate?.('Sending UserOperation via bundler...');
  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain: chain as any,
    accountClient: agentAccountClient,
    calls: createAgentIdentityCalls,
  });

  onStatusUpdate?.(`UserOperation sent! Hash: ${userOpHash}. Waiting for confirmation...`);

  // Wait for receipt
  const receipt = await waitForUserOperationReceipt({
    bundlerUrl,
    chain: chain as any,
    hash: userOpHash,
  });



  // Extract agentId from receipt logs
  let agentId: string | undefined;
  try {
    const extractResponse = await fetch('/api/agents/extract-agent-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receipt: JSON.parse(
          JSON.stringify(receipt, (_, value) => (typeof value === 'bigint' ? value.toString() : value))
        ),
        chainId: chain.id,
      }),
    });

    if (extractResponse.ok) {
      const extractData = await extractResponse.json();
      if (extractData?.agentId) {
        agentId = extractData.agentId;
      }
    } else {
      const errorPayload = await extractResponse.json().catch(() => ({}));
      console.warn('Failed to extract agentId via API:', errorPayload);
    }
  } catch (error) {
    console.warn('Unable to extract agentId via API:', error);
  }




  // Refresh GraphQL indexer
  if (agentId) {
    await refreshAgentInIndexer(agentId);
  } else {
    onStatusUpdate?.('Refreshing GraphQL indexer...');
    console.log('UserOperation confirmed. Please refresh the agent list to see the new agent.');
  }

  return {
    agentId,
    txHash: userOpHash,
    requiresClientSigning: true,
  };

}



