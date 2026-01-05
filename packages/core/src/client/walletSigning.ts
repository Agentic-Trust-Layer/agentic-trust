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
  getAddress,
  toBytes,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { http, isAddressEqual } from 'viem';
import {
  getChainById,
  DEFAULT_CHAIN_ID,
  getChainRpcUrl,
  getChainBundlerUrl,
  sepolia,
  baseSepolia,
  optimismSepolia,
  isL1,
  isL2,
  isPrivateKeyMode,
} from '../server/lib/chainConfig';
import {
  getDeployedAccountClientByAgentName,
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
} from './accountClient';
import {
  createAgent as callCreateAgentEndpoint,
  type CreateAgentClientResult,
  updateAgentRegistration as callUpdateAgentRegistrationEndpoint,
  type UpdateAgentRegistrationClientResult,
} from '../api/agents/client';
import type { AgentOperationMode, AgentOperationPlan } from '../api/agents/types';
import { parseDid8004 } from '../shared/did8004';
export {
  getDeployedAccountClientByAgentName,
  getDeployedAccountClientByAddress,
  getCounterfactualAccountClientByAgentName,
  getCounterfactualSmartAccountAddressByAgentName,
  getCounterfactualAAAddressByAgentName,
} from './accountClient';

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
    const chainHex = await ethereumProvider.request?.({
      method: 'eth_chainId',
    });
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
async function ensureAuthorizedAccount(
  ethereumProvider: any
): Promise<Address> {
  try {
    const existing = await ethereumProvider.request({ method: 'eth_accounts' });
    if (Array.isArray(existing) && existing.length > 0) {
      return existing[0] as Address;
    }
  } catch {
    // ignore and fall through to request
  }
  try {
    const granted = await ethereumProvider.request({
      method: 'eth_requestAccounts',
    });
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
    const afterPerm = await ethereumProvider.request({
      method: 'eth_accounts',
    });
    if (Array.isArray(afterPerm) && afterPerm.length > 0) {
      return afterPerm[0] as Address;
    }
  } catch {
    // ignore
  }
  throw new Error('Wallet not authorized. Please connect your wallet.');
}

async function ensureChainSelected(
  ethereumProvider: any,
  chain: Chain
): Promise<void> {
  try {
    const currentHex = await ethereumProvider.request?.({
      method: 'eth_chainId',
    });
    const current =
      typeof currentHex === 'string' ? parseInt(currentHex, 16) : undefined;
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
      decimals: 18,
    },
    rpcUrls: [getChainRpcUrl(chain.id)],
    blockExplorerUrls: chainConfig.blockExplorers?.default
      ? [chainConfig.blockExplorers.default.url]
      : [],
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
    throw new Error(
      'No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.'
    );
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
  onStatusUpdate?.(
    `Transaction submitted! Hash: ${hash}. Waiting for confirmation...`
  );

  // Wait for transaction receipt
  const publicClient = createPublicClient({
    chain,
    transport: custom(ethereumProvider),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Extract agentId if requested (for agent creation transactions)
  let agentId: string | undefined;
  if (receipt && Array.isArray(receipt.logs)) {
    const zeroTopic =
      '0x0000000000000000000000000000000000000000000000000000000000000000';
    const transferTopic =
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
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
    const transferTopic =
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    // Zero address topic (from address)
    const zeroAddress =
      '0x0000000000000000000000000000000000000000000000000000000000000000';

    if (!receipt.logs || !Array.isArray(receipt.logs)) {
      return undefined;
    }

    for (const log of receipt.logs) {
      if (
        log.topics &&
        log.topics[0] === transferTopic &&
        log.topics[1] === zeroAddress
      ) {
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
 * @param chainId - Chain ID for the agent
 * @param refreshEndpoint - Optional custom refresh endpoint (defaults to `/api/agents/<did>/refresh`)
 * @returns Promise that resolves when refresh is complete
 */
export async function refreshAgentInIndexer(
  agentId: string,
  chainId: number | string,
  refreshEndpoint?: string
): Promise<void> {
  const chainIdStr =
    typeof chainId === 'number' ? chainId.toString(10) : chainId?.toString() ?? '';
  if (!chainIdStr.trim()) {
    throw new Error('Chain ID is required to refresh agent in indexer');
  }
  const did = encodeURIComponent(`did:8004:${chainIdStr.trim()}:${agentId}`);
  const endpoint = refreshEndpoint || `/api/agents/${did}/refresh`;

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
      console.warn(
        `Failed to refresh agent ${agentId} in GraphQL indexer: ${response.status} ${response.statusText}`,
        errorText
      );
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
    console.warn(
      `Error refreshing agent ${agentId} in GraphQL indexer:`,
      error
    );
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
export async function getWalletAddress(
  ethereumProvider?: any
): Promise<Address | null> {
  const provider =
    ethereumProvider ||
    (typeof window !== 'undefined' ? (window as any).ethereum : null);

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
    agentCategory?: string;
    supportedTrust?: string[];
    description?: string;
    image?: string;
    agentUrl?: string;
    endpoints?: Array<{
      name: string;
      endpoint: string;
      version?: string;
      capabilities?: Record<string, any>;
    }>;
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
 * 1. Calls the API to create agent (endpoint: /api/agents/create)
 * 2. If client-side signing is required, signs and sends transaction
 * 3. Waits for receipt and extracts agentId
 * 4. Refreshes GraphQL indexer
 *
 * Only agentData is required - account, chain, and provider are auto-detected
 *
 * @param options - Creation options (only agentData required)
 * @returns Agent creation result
 */
async function createAgentWithWalletEOA(
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
  const ethereumProvider =
    providedProvider ||
    (typeof window !== 'undefined' ? (window as any).ethereum : null);

  if (!ethereumProvider) {
    throw new Error(
      'No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.'
    );
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

  const plan = await callCreateAgentEndpoint({
    mode: 'eoa',
    agentName: agentData.agentName,
    agentAccount: agentData.agentAccount,
    agentCategory: agentData.agentCategory,
    supportedTrust: agentData.supportedTrust,
    description: agentData.description,
    image: agentData.image,
    agentUrl: agentData.agentUrl,
    endpoints: agentData.endpoints,
    chainId: requestedChainId,
  });

  if (plan.mode !== 'eoa' || !plan.transaction) {
    throw new Error('Server response missing EOA transaction details');
  }

  const chain = getChainById(plan.chainId);
  const preparedTx: PreparedTransaction = {
    to: plan.transaction.to as `0x${string}`,
    data: plan.transaction.data as `0x${string}`,
    value: (plan.transaction.value ?? '0') as `0x${string}`,
    gas: plan.transaction.gas as `0x${string}` | undefined,
    gasPrice: plan.transaction.gasPrice as `0x${string}` | undefined,
    maxFeePerGas: plan.transaction.maxFeePerGas as `0x${string}` | undefined,
    maxPriorityFeePerGas:
      plan.transaction.maxPriorityFeePerGas as `0x${string}` | undefined,
    nonce: plan.transaction.nonce,
    chainId: plan.transaction.chainId,
  };

  // Sign and send transaction
  const result = await signAndSendTransaction({
    transaction: preparedTx,
    account,
    chain,
    ethereumProvider,
    onStatusUpdate,
    extractAgentId: true,
  });

  if (result.agentId) {
    await refreshAgentInIndexer(result.agentId, plan.chainId);
  }

  return {
    agentId: result.agentId,
    txHash: result.hash,
    requiresClientSigning: true,
  };
}

/**
 * Create an agent with Account Abstraction (AA) using a wallet
 * 
 * This client-side function handles the complete AA agent creation flow:
 * 1. Detects wallet provider and account
 * 2. Creates/retrieves AA account client for the agent
 * 3. Calls the server API route `/api/agents/create` to prepare registration
 * 4. Sends UserOperation via bundler using the AA account
 * 5. Extracts agentId and refreshes the indexer
 * 
 * **Setup Required:**
 * Your Next.js app must mount the API route handler:
 * 
 * ```typescript
 * // In app/api/agents/create/route.ts
 * import { createAgentRouteHandler } from '@agentic-trust/core/server';
 * export const POST = createAgentRouteHandler();
 * ```
 * 
 * **Usage:**
 * ```typescript
 * import { createAgentWithWallet } from '@agentic-trust/core/client';
 * 
 * const result = await createAgentWithWallet({
 *   agentData: {
 *     agentName: 'my-agent',
 *     agentAccount: '0x...', // AA account address
 *     description: 'My agent',
 *   },
 *   onStatusUpdate: (msg) => console.log(msg),
 * });
 * ```
 * 
 * @param options - Agent creation options
 * @returns Agent creation result with agentId and txHash
 */
async function createAgentWithWalletAA(
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
    throw new Error(
      'No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.'
    );
  }

  // Get account from provider if not provided
  let account: Address;
  if (providedAccount) {
    account = providedAccount;
  } else {
    account = await ensureAuthorizedAccount(ethereumProvider);
  }

  const chainId =
    typeof providedChainId === 'number'
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
  let bundlerUrl = getChainBundlerUrl(chainId);

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
  if (
    computedAddress.toLowerCase() !==
    options.agentData.agentAccount.toLowerCase()
  ) {
    throw new Error(
      `AA address mismatch: computed ${computedAddress}, expected ${options.agentData.agentAccount}`
    );
  }

  // 2.  Add ENS record associated with new agent

  console.log(
    '*********** createAgentWithWallet: options.ensOptions',
    options.ensOptions
  );

  if (
    options.ensOptions?.enabled &&
    options.ensOptions.orgName &&
    isL1(chainId)
  ) {
    try {
      const ensAgentAccount =
        typeof computedAddress === 'string' && computedAddress.startsWith('0x')
          ? computedAddress
          : options.agentData.agentAccount;

      onStatusUpdate?.(
        'Creating ENS subdomain for agent: ' + options.agentData.agentName
      );
      const pkModeDetected = isPrivateKeyMode();

      console.log("createAgentWithWallet: pkModeDetected", pkModeDetected);
      const addEndpoint = pkModeDetected
        ? '/api/names/add-to-l1-org-pk'
        : '/api/names/add-to-l1-org';
      console.info(
        `[ENS][L1] ${pkModeDetected ? 'PK mode detected 11111' : 'Client mode'} - calling ${addEndpoint}`
      );
      const ensResponse = await fetch(addEndpoint, {
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
      if (!ensResponse.ok) {
        const err = await ensResponse.json().catch(() => ({}));
        console.warn('[ENS][L1] add-to-l1-org call failed', err);
      } else {
        console.info('[ENS][L1] add-to-l1-org call succeeded');
      }

      onStatusUpdate?.('Preparing ENS metadata update...');
      const infoEndpoint = pkModeDetected
        ? '/api/names/set-l1-name-info-pk'
        : '/api/names/set-l1-name-info';
      console.info(
        `[ENS][L1] ${pkModeDetected ? 'PK mode detected 22222' : 'Client mode'} - calling ${infoEndpoint}`
      );
      const infoResponse = await fetch(infoEndpoint, {
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
        console.log(
          '*********** createAgentWithWallet: ENS metadata response received'
        );
        const infoData = await infoResponse.json();
        const serverInfoUserOpHash = (infoData as any)?.userOpHash as
          | string
          | undefined;
        if (serverInfoUserOpHash) {
          console.log(
            '*********** createAgentWithWallet: ENS info userOpHash (server-submitted)',
            serverInfoUserOpHash
          );
        } else {
          const infoCalls: {
            to: `0x${string}`;
            data: `0x${string}`;
            value?: bigint;
          }[] = [];

          if (Array.isArray(infoData?.calls)) {
            for (const rawCall of infoData.calls as Array<
              Record<string, unknown>
            >) {
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
                  console.warn(
                    'Unable to parse ENS info call value',
                    rawCall.value,
                    error
                  );
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
            onStatusUpdate?.(
              'MetaMask signature: update ENS metadata (URL/description/image)',
            );
            // Ensure we are using a deployed-only AA client (no factory/factoryData)
            //const fullAgentName = agentName + '.' + options.ensOptions.orgName + ".eth";
            console.log(
              '!!!!!!!!!!!! handleCreateAgent: getDeployedAccountClientByAgentName 2: agentName',
              options.agentData.agentName
            );
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

      console.log(
        'Requested ENS record creation and metadata update for agent',
        options.agentData.agentName
      );
    } catch (ensError) {
      console.warn('Failed to create ENS record for agent:', ensError);
    }
  } else if (
    options.ensOptions?.enabled &&
    options.ensOptions.orgName &&
    isL2(chainId)
  ) {
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
    const prepareResp = await fetch('/api/names/add-to-l2-org', {
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
          onStatusUpdate?.('MetaMask signature: create ENS subdomain / set ENS records');
          console.log(
            '********************* send sponsored user operation for L2 ENS call'
          );
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

    /*  TODO:  Need to resolve this to set ens url and description
      onStatusUpdate?.('Set ENS metadata update...');
      const infoResponse = await fetch('/api/names/set-l2-name-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentAddress: agentAccountClient.address,
          orgName: options.ensOptions.orgName,
          agentName: options.agentData.agentName,
          agentUrl: options.agentData.agentUrl,
          agentDescription: options.agentData.description,
          chainId,
        }),
      });

      if (!infoResponse.ok) {
        const errorPayload = await infoResponse.json().catch(() => ({}));
        console.warn('Failed to prepare L2 ENS calls:', errorPayload);
      } else {
        const { calls: rawCalls } = await infoResponse.json();
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
        */
  }

  // 2.  Need to create the Agent Identity (NFT)

  console.log(
    '*********** createAgentWithWallet: creating agent identity...'
  );
  const finalAgentName =
    options.ensOptions?.enabled && options.ensOptions?.orgName
      ? `${options.agentData.agentName}.${options.ensOptions?.orgName}.eth`
      : options.agentData.agentName;
  agentData.agentName = finalAgentName;

  let data: CreateAgentClientResult;
  try {
    data = await callCreateAgentEndpoint({
      mode: 'smartAccount',
      account: computedAddress,
      agentName: agentData.agentName,
      agentAccount: agentData.agentAccount,
      agentCategory: agentData.agentCategory,
      supportedTrust: agentData.supportedTrust,
      description: agentData.description,
      image: agentData.image,
      agentUrl: agentData.agentUrl,
      endpoints: agentData.endpoints,
      chainId,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Failed to create agent',
    );
  }

  if (data.mode !== 'smartAccount') {
    throw new Error('Server returned an unexpected plan mode for SmartAccount creation');
  }

  if (data.bundlerUrl) {
    bundlerUrl = data.bundlerUrl;
  }

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

  onStatusUpdate?.('MetaMask signature: register agent identity (ERC-8004)');
  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain: chain as any,
    accountClient: agentAccountClient,
    calls: createAgentIdentityCalls,
  });

  onStatusUpdate?.(
    `UserOperation sent! Hash: ${userOpHash}. Waiting for confirmation...`
  );

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
          JSON.stringify(receipt, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
          )
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
    await refreshAgentInIndexer(agentId, chain.id);

    // Finalize UAID now that we have a real on-chain agentId, and write it back by updating tokenUri.
    try {
      onStatusUpdate?.('Finalizing UAID and updating registration tokenUri...');

      const uaidResp = await fetch('/api/agents/generate-uaid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentAccount: agentData.agentAccount,
          chainId: chain.id,
          // Use did:ethr for uid (not ENS)
          uid: `did:ethr:${chain.id}:${agentData.agentAccount}`,
          proto: 'a2a',
          registry: 'erc-8004',
          domain:
            typeof agentData.agentUrl === 'string' && agentData.agentUrl.trim()
              ? (() => {
                  try {
                    return new URL(agentData.agentUrl).hostname;
                  } catch {
                    return undefined;
                  }
                })()
              : undefined,
        }),
      });

      if (uaidResp.ok) {
        const uaidData = await uaidResp.json().catch(() => ({}));
        const uaid = typeof uaidData?.uaid === 'string' && uaidData.uaid.trim() ? uaidData.uaid.trim() : null;

        if (uaid) {
          const did8004 = `did:8004:${chain.id}:${agentId}`;
          const registrationUpdate = {
            type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
            name: agentData.agentName,
            description: agentData.description,
            image: agentData.image,
            agentUrl: agentData.agentUrl,
            // Never include MCP endpoint in registration JSON updates.
            endpoints: Array.isArray(agentData.endpoints)
              ? agentData.endpoints.filter(e => e?.name !== 'MCP')
              : undefined,
            supportedTrust: agentData.supportedTrust,
            active: true,
            registeredBy: 'agentic-trust',
            registryNamespace: 'erc-8004',
            uaid,
            // Ensure agentId is written into the tokenUri JSON
            registrations: [
              {
                agentId: String(agentId),
                // agentRegistry is best-effort; server will also backfill if omitted
                agentRegistry: `eip155:${chain.id}:unknown`,
                registeredAt: new Date().toISOString(),
              },
            ],
          };

          await updateAgentRegistrationWithWallet({
            did8004,
            chain,
            accountClient: agentAccountClient,
            registration: registrationUpdate,
            onStatusUpdate,
          });
        } else {
          console.warn('[createAgentWithWalletAA] UAID endpoint returned no uaid value');
        }
      } else {
        const err = await uaidResp.json().catch(() => ({}));
        console.warn('[createAgentWithWalletAA] UAID endpoint failed:', err);
      }
    } catch (uaidErr) {
      console.warn('[createAgentWithWalletAA] Failed to finalize UAID + registration update:', uaidErr);
    }
  } else {
    onStatusUpdate?.('Refreshing GraphQL indexer...');
    console.log(
      'UserOperation confirmed. Please refresh the agent list to see the new agent.'
    );
  }

  return {
    agentId,
    txHash: userOpHash,
    requiresClientSigning: true,
  };
}

export async function createAgentWithWallet(
  options: CreateAgentWithWalletOptions,
): Promise<CreateAgentResult> {
  const useAA = options.useAA ?? false;
  if (useAA) {
    return createAgentWithWalletAA(options);
  }
  return createAgentWithWalletEOA(options);
}

/**
 * Update an existing agent's registration (tokenUri) using an AA wallet +
 * bundler, mirroring the AA create flow.
 *
 * This client-side function handles the complete AA agent registration update flow:
 * 1. Sends the updated registration JSON to the server API route
 * 2. Receives prepared AA calls + bundler URL
 * 3. Sends a sponsored UserOperation via the bundler using the AA account
 * 4. Waits for confirmation
 *
 * **Setup Required:**
 * Your Next.js app must mount the API route handler:
 * 
 * ```typescript
 * // In app/api/agents/[did:8004]/registration/route.ts
 * import { updateAgentRegistrationRouteHandler } from '@agentic-trust/core/server';
 * export const PUT = updateAgentRegistrationRouteHandler();
 * ```
 * 
 * **Usage:**
 * ```typescript
 * import { updateAgentRegistrationWithWallet } from '@agentic-trust/core/client';
 * 
 * const result = await updateAgentRegistrationWithWallet({
 *   did8004: 'did:8004:11155111:123',
 *   chain: sepolia,
 *   accountClient: agentAccountClient,
 *   registration: { name: 'Updated Agent', description: '...' },
 *   onStatusUpdate: (msg) => console.log(msg),
 * });
 * ```
 */
export interface UpdateAgentRegistrationWithWalletOptions {
  did8004: string;
  chain: Chain;
  accountClient: any;
  registration: string | Record<string, unknown>;
  onStatusUpdate?: (status: string) => void;
}

export async function updateAgentRegistrationWithWallet(
  options: UpdateAgentRegistrationWithWalletOptions,
): Promise<{ txHash: string; requiresClientSigning: true }> {
  const { did8004, chain, accountClient, registration, onStatusUpdate } = options;

  const serialized =
    typeof registration === 'string' ? registration : JSON.stringify(registration, null, 2);

  onStatusUpdate?.('Preparing agent registration update on server...');
  console.info('........... registration: ', registration);
  let prepared: UpdateAgentRegistrationClientResult;
  try {
    prepared = await callUpdateAgentRegistrationEndpoint({
      did8004,
      registration: serialized,
      mode: 'smartAccount',
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Failed to prepare registration update',
    );
  }

  const bundlerUrl: string | undefined = prepared.bundlerUrl;
  const rawCalls: Array<{ to: string; data: string; value?: string | number | bigint }> =
    Array.isArray(prepared.calls) ? prepared.calls : [];

  if (!bundlerUrl || rawCalls.length === 0) {
    throw new Error('Registration update response missing bundlerUrl or calls');
  }

  // Preflight authorization check to avoid opaque bundler simulation reverts ("Not authorized").
  // The IdentityRegistry setAgentUri requires msg.sender to be owner or approved operator for the agentId.
  try {
    const identityRegistry = prepared.identityRegistry as `0x${string}` | undefined;
    const rpcUrl = getChainRpcUrl(chain.id) || chain.rpcUrls?.default?.http?.[0];
    if (identityRegistry && rpcUrl) {
      const publicClient = createPublicClient({
        chain: chain as any,
        transport: http(rpcUrl),
      }) as any;

      const { agentId } = parseDid8004(did8004);
      const tokenId = BigInt(agentId);
      const sender = getAddress(accountClient.address) as `0x${string}`;

      const ERC721_ABI = [
        {
          type: 'function',
          name: 'ownerOf',
          stateMutability: 'view',
          inputs: [{ name: 'tokenId', type: 'uint256' }],
          outputs: [{ name: 'owner', type: 'address' }],
        },
        {
          type: 'function',
          name: 'getApproved',
          stateMutability: 'view',
          inputs: [{ name: 'tokenId', type: 'uint256' }],
          outputs: [{ name: 'operator', type: 'address' }],
        },
        {
          type: 'function',
          name: 'isApprovedForAll',
          stateMutability: 'view',
          inputs: [
            { name: 'owner', type: 'address' },
            { name: 'operator', type: 'address' },
          ],
          outputs: [{ name: 'approved', type: 'bool' }],
        },
      ] as const;

      const owner = (await publicClient.readContract({
        address: identityRegistry,
        abi: ERC721_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      })) as `0x${string}`;

      // If owner is sender, OK.
      const ownerNorm = getAddress(owner);
      if (ownerNorm !== sender) {
        const approved = (await publicClient.readContract({
          address: identityRegistry,
          abi: ERC721_ABI,
          functionName: 'getApproved',
          args: [tokenId],
        })) as `0x${string}`;
        const approvedNorm = approved ? getAddress(approved) : ('0x0000000000000000000000000000000000000000' as const);
        const approvedForAll = (await publicClient.readContract({
          address: identityRegistry,
          abi: ERC721_ABI,
          functionName: 'isApprovedForAll',
          args: [ownerNorm, sender],
        })) as boolean;

        const isAuthorized =
          approvedNorm === sender || approvedForAll === true;

        if (!isAuthorized) {
          throw new Error(
            `Not authorized to update agent registration. ` +
              `Agent NFT owner=${ownerNorm}, sender=${sender}. ` +
              `Grant approval (approve or setApprovalForAll) or use the owning account.`,
          );
        }
      }
    }
  } catch (preflightErr: any) {
    // If we can definitively detect authorization mismatch, surface it.
    const msg = preflightErr?.message || String(preflightErr);
    if (msg.includes('Not authorized to update agent registration')) {
      throw preflightErr;
    }
  }

  const updateCalls = rawCalls.map((call) => ({
    to: call.to as `0x${string}`,
    data: call.data as `0x${string}`,
    value: BigInt(call.value ?? '0'),
  }));

  console.info('updateCalls', updateCalls);
  console.info('accountClient:', accountClient.address);

  onStatusUpdate?.('Sending registration update via bundler...');
  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain: chain as any,
    accountClient,
    calls: updateCalls,
  });

  onStatusUpdate?.(
    `Registration update sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`,
  );

  const receipt = await waitForUserOperationReceipt({
    bundlerUrl,
    chain: chain as any,
    hash: userOpHash,
  });

  console.info('........... receipt: ', receipt);

  return {
    txHash: userOpHash,
    requiresClientSigning: true as const,
  };
}

/**
 * Submit feedback for an agent using an AA wallet + bundler, mirroring the AA update flow.
 *
 * This client-side function handles the complete AA feedback submission flow:
 * 1. Sends feedback data to the server API route to prepare calls
 * 2. Receives prepared AA calls + bundler URL
 * 3. Sends a sponsored UserOperation via the bundler using the AA account
 * 4. Waits for confirmation
 *
 * **Setup Required:**
 * Your Next.js app must mount the API route handler:
 * 
 * ```typescript
 * // In app/api/agents/[did:8004]/feedback/route.ts
 * import { prepareFeedbackRouteHandler } from '@agentic-trust/core/server';
 * export const POST = prepareFeedbackRouteHandler();
 * ```
 * 
 * **Usage:**
 * ```typescript
 * import { giveFeedbackWithWallet } from '@agentic-trust/core/client';
 * 
 * const result = await giveFeedbackWithWallet{
 *   did8004: 'did:8004:11155111:123',
 *   chain: sepolia,
 *   accountClient: clientAccountClient,
 *   score: 85,
 *   feedback: 'Great agent!',
 *   feedbackAuth: '0x...',
 *   onStatusUpdate: (msg) => console.log(msg),
 * });
 * ```
 */
export interface GiveFeedbackWithWalletOptions {
  did8004: string;
  chain: Chain;
  score: number;
  feedback: string;
  feedbackAuth: string;
  clientAddress?: string;
  ethereumProvider?: any;
  tag1?: string;
  tag2?: string;
  feedbackUri?: string;
  feedbackHash?: string;
  skill?: string;
  context?: string;
  capability?: string;
  onStatusUpdate?: (status: string) => void;
}

export async function giveFeedbackWithWallet(
  options: GiveFeedbackWithWalletOptions,
): Promise<{ txHash: string; requiresClientSigning: true }> {
  const {
    did8004,
    chain,
    score,
    feedback,
    feedbackAuth,
    clientAddress,
    tag1,
    tag2,
    feedbackUri,
    feedbackHash,
    skill,
    context,
    capability,
    ethereumProvider,
    onStatusUpdate,
  } = options;

  onStatusUpdate?.('Preparing feedback submission on server...');

  let prepared: AgentOperationPlan;
  try {
    const response = await fetch(`/api/agents/${encodeURIComponent(did8004)}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        score,
        feedback,
        feedbackAuth,
        clientAddress,
        tag1,
        tag2,
        feedbackUri,
        feedbackHash,
        skill,
        context,
        capability,
        mode: 'eoa',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || errorData.message || 'Failed to prepare feedback submission',
      );
    }

    prepared = (await response.json()) as AgentOperationPlan;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Failed to prepare feedback submission',
    );
  }

  if (!prepared.transaction) {
    throw new Error('Feedback submission response missing transaction payload');
  }

  const txResult = await signAndSendTransaction({
    transaction: prepared.transaction as any, // AgentPreparedTransactionPayload is compatible with PreparedTransaction
    account: (clientAddress || '0x') as `0x${string}`,
    chain,
    ethereumProvider,
    onStatusUpdate,
  });

  return {
    txHash: txResult.hash,
    requiresClientSigning: true as const,
  };
}

/**
 * Request validation for an agent using an AA wallet + bundler.
 *
 * This client-side function handles the complete AA validation request flow:
 * 1. Sends validation request data to the server API route to prepare calls
 * 2. Receives prepared AA calls + bundler URL
 * 3. Sends a sponsored UserOperation via the bundler using the AA account
 * 4. Waits for confirmation
 *
 * **Setup Required:**
 * Your Next.js app must mount the API route handler:
 * 
 * ```typescript
 * // In app/api/agents/[did:8004]/validation-request/route.ts
 * import { prepareValidationRequestRouteHandler } from '@agentic-trust/core/server';
 * export const POST = prepareValidationRequestRouteHandler();
 * ```
 * 
 * **Usage:**
 * ```typescript
 * import { requestNameValidationWithWallet } from '@agentic-trust/core/client';
 * 
 * const result = await requestNameValidationWithWallet({
 *   requesterDid: 'did:8004:11155111:123',
 *   chain: sepolia,
 *   requesterAccountClient: agentAccountClient,
 *   requestUri: 'https://...',
 *   onStatusUpdate: (msg) => console.log(msg),
 * });
 * ```
 */
export interface RequestValidationWithWalletOptions {
  requesterDid: string;
  chain: Chain;
  requesterAccountClient?: any; // AA account client (required for smartAccount mode)
  mode?: AgentOperationMode; // default: smartAccount
  ethereumProvider?: any; // required for eoa mode (EIP-1193 provider)
  account?: `0x${string}`; // required for eoa mode (EOA sender)
  requestUri?: string;
  requestHash?: string;
  validatorAddress?: string; // Optional: if provided, use this address directly instead of validatorName
  onStatusUpdate?: (status: string) => void;
}

export interface RequestAssociationWithWalletOptions {
  requesterDid: string; // initiator agent DID (did:8004:chainId:agentId)
  chain: Chain;
  requesterAccountClient?: any; // initiator AA account client (smartAccount mode)
  mode?: AgentOperationMode; // default: smartAccount
  ethereumProvider?: any; // required for eoa mode
  account?: `0x${string}`; // required for eoa mode
  approverAddress: `0x${string}`; // counterparty smart account address
  assocType?: number;
  description?: string;
  onStatusUpdate?: (status: string) => void;
}

export async function finalizeAssociationWithWallet(options: {
  chain: Chain;
  submitterAccountClient?: any; // AA account client of whoever submits (smartAccount mode)
  mode?: AgentOperationMode; // default: smartAccount
  ethereumProvider?: any; // required for eoa mode
  account?: `0x${string}`; // required for eoa mode (EOA sender)
  requesterDid: string; // initiator did:8004
  initiatorAddress?: `0x${string}`; // optional override (must match the signed digest)
  approverAddress: `0x${string}`;
  assocType?: number;
  description?: string;
  validAt: number;
  data: `0x${string}`;
  initiatorSignature: `0x${string}`;
  approverSignature: `0x${string}`;
  onStatusUpdate?: (status: string) => void;
}): Promise<{ txHash: string; requiresClientSigning: true }> {
  const {
    chain,
    submitterAccountClient,
    mode = 'smartAccount',
    ethereumProvider,
    account,
    requesterDid,
    initiatorAddress: initiatorAddressOverride,
    approverAddress,
    assocType,
    description,
    validAt,
    data,
    initiatorSignature,
    approverSignature,
    onStatusUpdate,
  } = options;

  // Preflight: best-effort ERC-1271 signature validation to avoid opaque bundler "reason: 0x".
  // This checks whether the initiator/approver smart accounts would accept the provided signatures
  // for the association digest we are about to submit.
  if (mode === 'smartAccount') {
    if (!submitterAccountClient) {
      throw new Error('smartAccount mode requires submitterAccountClient');
    }
    try {
      const rpcUrl = getChainRpcUrl(chain.id) || chain.rpcUrls?.default?.http?.[0];
      if (rpcUrl) {
        const publicClient = createPublicClient({
          chain: chain as any,
          transport: http(rpcUrl),
        }) as any;

        // Resolve initiator address for digest computation.
        // If caller supplied an override (from inbox payload), prefer it to avoid mismatches.
        const initiatorFinal = initiatorAddressOverride
          ? (getAddress(initiatorAddressOverride) as `0x${string}`)
          : null;

        let initiatorResolved = initiatorFinal;
        if (!initiatorResolved) {
          const initiatorResp = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}`);
          const initiatorJson = initiatorResp.ok ? await initiatorResp.json().catch(() => ({})) : {};
          const initiatorAddrRaw = initiatorJson?.agentAccount || initiatorJson?.account;
          if (initiatorAddrRaw) {
            initiatorResolved = getAddress(initiatorAddrRaw) as `0x${string}`;
          }
        }

        if (!initiatorResolved) {
          throw new Error('Missing initiatorAddress for association preflight');
        }

        const approver = getAddress(approverAddress) as `0x${string}`;

        // Recompute digest using the erc8092 scheme (same as packages/erc8092-sdk eip712Hash)
        const { ethers } = await import('ethers');
        const toMinimalBigEndianBytes = (n: bigint): Uint8Array => {
          if (n === 0n) return new Uint8Array([0]);
          let hex = n.toString(16);
          if (hex.length % 2) hex = `0${hex}`;
          return ethers.getBytes(`0x${hex}`);
        };
        const formatEvmV1 = (chainId: number, address: string): string => {
          const addr = ethers.getAddress(address);
          const chainRef = toMinimalBigEndianBytes(BigInt(chainId));
          const head = ethers.getBytes('0x00010000');
          const out = ethers.concat([
            head,
            new Uint8Array([chainRef.length]),
            chainRef,
            new Uint8Array([20]),
            ethers.getBytes(addr),
          ]);
          return ethers.hexlify(out);
        };
        const initiatorInterop = formatEvmV1(chain.id, initiatorResolved);
        const approverInterop = formatEvmV1(chain.id, approver);
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const DOMAIN_TYPEHASH = ethers.id('EIP712Domain(string name,string version)');
        const NAME_HASH = ethers.id('AssociatedAccounts');
        const VERSION_HASH = ethers.id('1');
        const MESSAGE_TYPEHASH = ethers.id(
          'AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)',
        );
        const domainSeparator = ethers.keccak256(
          abiCoder.encode(['bytes32', 'bytes32', 'bytes32'], [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH]),
        );
        const interfaceId = '0x00000000';
        const validUntil = 0;
        const hashStruct = ethers.keccak256(
          abiCoder.encode(
            ['bytes32', 'bytes32', 'bytes32', 'uint40', 'uint40', 'bytes4', 'bytes32'],
            [
              MESSAGE_TYPEHASH,
              ethers.keccak256(initiatorInterop),
              ethers.keccak256(approverInterop),
              validAt,
              validUntil,
              interfaceId,
              ethers.keccak256(data),
            ],
          ),
        );
        const digest = ethers.keccak256(
          ethers.solidityPacked(['bytes2', 'bytes32', 'bytes32'], ['0x1901', domainSeparator, hashStruct]),
        ) as `0x${string}`;

        const ERC1271_MAGIC = '0x1626ba7e' as const;
        const ERC1271_ABI = [
          {
            type: 'function',
            name: 'isValidSignature',
            stateMutability: 'view',
            inputs: [
              { name: 'hash', type: 'bytes32' },
              { name: 'signature', type: 'bytes' },
            ],
            outputs: [{ name: 'magicValue', type: 'bytes4' }],
          },
        ] as const;

        const checkSignature = async (account: `0x${string}`, sig: `0x${string}`) => {
          const code = await publicClient.getBytecode({ address: account });

          // EOA: verify with ecrecover.
          if (!code || code === '0x') {
            try {
              const recovered = ethers.recoverAddress(digest, sig);
              return {
                ok: recovered.toLowerCase() === account.toLowerCase(),
                method: 'ecrecover' as const,
                recovered,
              };
            } catch (e: any) {
              return { ok: false as const, method: 'ecrecover' as const, error: e?.message || String(e) };
            }
          }

          // Contract: verify with ERC-1271.
          try {
            const magic = (await publicClient.readContract({
              address: account,
              abi: ERC1271_ABI,
              functionName: 'isValidSignature',
              args: [digest, sig],
            })) as `0x${string}`;
            return { ok: magic.toLowerCase() === ERC1271_MAGIC, method: 'erc1271' as const, magic };
          } catch (e: any) {
            return { ok: false as const, method: 'erc1271' as const, error: e?.message || String(e) };
          }
        };

        const initiatorCheck = await checkSignature(initiatorResolved, initiatorSignature);
        if (!initiatorCheck.ok) {
          throw new Error(
            `Initiator signature check failed. initiator=${initiatorResolved} digest=${digest} method=${(initiatorCheck as any).method}`,
          );
        }

        const approverCheck = await checkSignature(approver, approverSignature);
        if (!approverCheck.ok) {
          throw new Error(
            `Approver signature check failed. approver=${approver} digest=${digest} method=${(approverCheck as any).method}`,
          );
        }

        // Extra sanity: ensure we're submitting from the approver account we think we are.
        const submitter = getAddress(submitterAccountClient.address) as `0x${string}`;
        if (!isAddressEqual(submitter, approver)) {
          console.warn(
            '[finalizeAssociationWithWallet] submitterAccountClient.address does not match approverAddress',
            { submitter, approver },
          );
        }
      }
    } catch (preflightErr: any) {
      // If we can detect invalid signatures, surface it; otherwise continue to let bundler give more info.
      // (This block is best-effort and should not block in environments without RPC.)
      const msg = preflightErr?.message || String(preflightErr);
      if (msg.includes('rejected signature') || msg.includes('ERC-1271')) {
        throw preflightErr;
      }
    }
  }

  onStatusUpdate?.('Preparing association store transaction on server...');

  let prepared: AgentOperationPlan;
  const response = await fetch('/api/associate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      did8004: requesterDid,
      initiatorAddress: initiatorAddressOverride,
      approverAddress: getAddress(approverAddress),
      assocType,
      description,
      validAt,
      data,
      initiatorSignature,
      approverSignature,
      mode,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || 'Failed to prepare association store');
  }
  prepared = (await response.json()) as AgentOperationPlan;

  if (mode === 'eoa') {
    if (!prepared.transaction) {
      throw new Error('Association store response missing transaction payload');
    }
    if (!account) {
      throw new Error('EOA mode requires account (EOA sender address)');
    }
    const txResult = await signAndSendTransaction({
      transaction: prepared.transaction as any,
      account,
      chain,
      ethereumProvider,
      onStatusUpdate,
    });
    return { txHash: txResult.hash, requiresClientSigning: true as const };
  }

  const bundlerUrl: string | undefined = prepared.bundlerUrl;
  const rawCalls: Array<{ to: string; data: string; value?: string | number | bigint }> =
    Array.isArray(prepared.calls) ? prepared.calls : [];
  if (!bundlerUrl || rawCalls.length === 0) {
    throw new Error('Association store response missing bundlerUrl or calls');
  }
  if (!submitterAccountClient) {
    throw new Error('smartAccount mode requires submitterAccountClient');
  }

  const calls = rawCalls.map((call) => ({
    to: getAddress(call.to) as `0x${string}`,
    data: call.data as `0x${string}`,
    value: BigInt(call.value ?? '0'),
  }));

  onStatusUpdate?.('Submitting association via bundler...');
  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain: chain as any,
    accountClient: submitterAccountClient,
    calls,
  });

  await waitForUserOperationReceipt({
    bundlerUrl,
    chain: chain as any,
    hash: userOpHash,
  });

  return { txHash: userOpHash, requiresClientSigning: true as const };
}

export async function requestNameValidationWithWallet(
  options: RequestValidationWithWalletOptions,
): Promise<{ txHash: string; requiresClientSigning: true; validatorAddress: string; requestHash: string }> {
  const {
    requesterDid,
    chain,
    requesterAccountClient,
    mode = 'smartAccount',
    ethereumProvider,
    account,
    requestUri,
    requestHash,
    onStatusUpdate,
  } = options;

  onStatusUpdate?.('Preparing validation request on server...');

  const validatorName = 'name-validator';
  const chainIdFromDid = (() => {
    const m = requesterDid.match(/^did:8004:(\d+):/);
    if (!m) return undefined;
    const parsed = Number(m[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  })();

  async function resolveValidatorAddressByName(params: {
    validatorName: string;
    chainId?: number;
  }): Promise<`0x${string}`> {
    const urlParams = new URLSearchParams({
      query: params.validatorName,
      page: '1',
      pageSize: '10',
    });

    const response = await fetch(`/api/agents/search?${urlParams.toString()}`);
    if (!response.ok) {
      throw new Error(
        `Failed to resolve validator "${params.validatorName}" via discovery (status ${response.status})`,
      );
    }

    const data = (await response.json().catch(() => ({}))) as any;
    const agents: any[] = Array.isArray(data?.agents) ? data.agents : [];

    const normalizedName = params.validatorName.trim().toLowerCase();
    const byExactName = agents.find((a) => {
      const name = typeof a?.agentName === 'string' ? a.agentName.trim().toLowerCase() : '';
      const chainIdOk =
        typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
      const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
      return chainIdOk && acctOk && name === normalizedName;
    });

    const fallback = agents.find((a) => {
      const chainIdOk =
        typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
      const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
      return chainIdOk && acctOk;
    });

    const agentAccount = (byExactName?.agentAccount ?? fallback?.agentAccount) as string | undefined;
    if (!agentAccount) {
      throw new Error(
        `Validator "${params.validatorName}" not found in discovery (chainId=${params.chainId ?? 'any'})`,
      );
    }

    return getAddress(agentAccount) as `0x${string}`;
  }

  async function resolveValidatorAddress(params: {
    validatorName: string;
    chainId?: number;
  }): Promise<`0x${string}`> {
    try {
      return await resolveValidatorAddressByName(params);
    } catch (_discoveryErr) {
      const chainId =
        typeof params.chainId === 'number'
          ? params.chainId
          : typeof (chain as any)?.id === 'number'
            ? ((chain as any).id as number)
            : undefined;

      if (!chainId) {
        throw _discoveryErr;
      }

      const resp = await fetch(
        `/api/validator-address?validatorName=${encodeURIComponent(params.validatorName)}&chainId=${encodeURIComponent(
          String(chainId),
        )}`,
      );

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const msg =
          errData?.error ||
          errData?.message ||
          `Failed to resolve validator "${params.validatorName}" via /api/validator-address (status ${resp.status})`;
        throw new Error(msg);
      }

      const data = (await resp.json().catch(() => ({}))) as any;
      const addr = typeof data?.validatorAddress === 'string' ? data.validatorAddress : '';
      if (!addr || !addr.startsWith('0x')) {
        throw new Error(
          `Validator "${params.validatorName}" address not returned by /api/validator-address`,
        );
      }
      return getAddress(addr) as `0x${string}`;
    }
  }

  let prepared: AgentOperationPlan;
  try {
    const requestBody: any = {
      requestUri,
      requestHash,
      mode,
    };
    
    // Server requires validatorAddress; resolve validatorName -> address client-side if needed.
    requestBody.validatorAddress =
      (options.validatorAddress
        ? (getAddress(options.validatorAddress) as `0x${string}`)
        : await resolveValidatorAddress({
            validatorName,
            chainId: chainIdFromDid,
          })) as `0x${string}`;

    const response = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}/validation-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || errorData.message || 'Failed to prepare validation request',
      );
    }

    prepared = (await response.json()) as AgentOperationPlan;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Failed to prepare validation request',
    );
  }

  const bundlerUrl: string | undefined = prepared.bundlerUrl;
  const rawCalls: Array<{ to: string; data: string; value?: string | number | bigint }> =
    Array.isArray(prepared.calls) ? prepared.calls : [];

  // EOA mode: server returns a transaction payload.
  if (mode === 'eoa') {
    if (!prepared.transaction) {
      throw new Error('Validation request response missing transaction payload');
    }
    if (!account) {
      throw new Error('EOA mode requires account (EOA sender address)');
    }
    const txResult = await signAndSendTransaction({
      transaction: prepared.transaction as any,
      account,
      chain,
      ethereumProvider,
      onStatusUpdate,
    });

    const validatorAddress =
      ((prepared.metadata as any)?.validatorAddress as string | undefined) ||
      (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
      '';
    const finalRequestHash = (prepared.metadata as any)?.requestHash || '';

    return {
      txHash: txResult.hash,
      requiresClientSigning: true as const,
      validatorAddress,
      requestHash: finalRequestHash,
    };
  }

  if (!bundlerUrl || rawCalls.length === 0) {
    throw new Error('Validation request response missing bundlerUrl or calls');
  }

  const validationCalls = rawCalls.map((call) => ({
    to: call.to as `0x${string}`,
    data: call.data as `0x${string}`,
    value: BigInt(call.value ?? '0'),
  }));

  onStatusUpdate?.('Sending validation request via bundler...');
  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain: chain as any,
    accountClient: requesterAccountClient,
    calls: validationCalls,
  });

  onStatusUpdate?.(
    `Validation request sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`,
  );

  const receipt = await waitForUserOperationReceipt({
    bundlerUrl,
    chain: chain as any,
    hash: userOpHash,
  });

  const validatorAddress =
    ((prepared.metadata as any)?.validatorAddress as string | undefined) ||
    (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
    '';
  const finalRequestHash = (prepared.metadata as any)?.requestHash || '';

  return {
    txHash: userOpHash,
    requiresClientSigning: true as const,
    validatorAddress,
    requestHash: finalRequestHash,
  };
}

export async function requestAccountValidationWithWallet(
  options: RequestValidationWithWalletOptions,
): Promise<{ txHash: string; requiresClientSigning: true; validatorAddress: string; requestHash: string }> {
  const {
    requesterDid,
    chain,
    requesterAccountClient,
    mode = 'smartAccount',
    ethereumProvider,
    account,
    requestUri,
    requestHash,
    onStatusUpdate,
  } = options;

  onStatusUpdate?.('Preparing validation request on server...');

  const validatorName = 'account-validator';
  const chainIdFromDid = (() => {
    const m = requesterDid.match(/^did:8004:(\d+):/);
    if (!m) return undefined;
    const parsed = Number(m[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  })();

  async function resolveValidatorAddressByName(params: {
    validatorName: string;
    chainId?: number;
  }): Promise<`0x${string}`> {
    const urlParams = new URLSearchParams({
      query: params.validatorName,
      page: '1',
      pageSize: '10',
    });

    const response = await fetch(`/api/agents/search?${urlParams.toString()}`);
    if (!response.ok) {
      throw new Error(
        `Failed to resolve validator "${params.validatorName}" via discovery (status ${response.status})`,
      );
    }

    const data = (await response.json().catch(() => ({}))) as any;
    const agents: any[] = Array.isArray(data?.agents) ? data.agents : [];

    const normalizedName = params.validatorName.trim().toLowerCase();
    const byExactName = agents.find((a) => {
      const name = typeof a?.agentName === 'string' ? a.agentName.trim().toLowerCase() : '';
      const chainIdOk =
        typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
      const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
      return chainIdOk && acctOk && name === normalizedName;
    });

    const fallback = agents.find((a) => {
      const chainIdOk =
        typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
      const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
      return chainIdOk && acctOk;
    });

    const agentAccount = (byExactName?.agentAccount ?? fallback?.agentAccount) as string | undefined;
    if (!agentAccount) {
      throw new Error(
        `Validator "${params.validatorName}" not found in discovery (chainId=${params.chainId ?? 'any'})`,
      );
    }

    return getAddress(agentAccount) as `0x${string}`;
  }

  async function resolveValidatorAddress(params: {
    validatorName: string;
    chainId?: number;
  }): Promise<`0x${string}`> {
    try {
      return await resolveValidatorAddressByName(params);
    } catch (_discoveryErr) {
      const chainId =
        typeof params.chainId === 'number'
          ? params.chainId
          : typeof (chain as any)?.id === 'number'
            ? ((chain as any).id as number)
            : undefined;

      if (!chainId) {
        throw _discoveryErr;
      }

      const resp = await fetch(
        `/api/validator-address?validatorName=${encodeURIComponent(params.validatorName)}&chainId=${encodeURIComponent(
          String(chainId),
        )}`,
      );

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const msg =
          errData?.error ||
          errData?.message ||
          `Failed to resolve validator "${params.validatorName}" via /api/validator-address (status ${resp.status})`;
        throw new Error(msg);
      }

      const data = (await resp.json().catch(() => ({}))) as any;
      const addr = typeof data?.validatorAddress === 'string' ? data.validatorAddress : '';
      if (!addr || !addr.startsWith('0x')) {
        throw new Error(
          `Validator "${params.validatorName}" address not returned by /api/validator-address`,
        );
      }
      return getAddress(addr) as `0x${string}`;
    }
  }

  let prepared: AgentOperationPlan;
  try {
    const requestBody: any = {
      requestUri,
      requestHash,
      mode: 'smartAccount',
    };
    
    // Server requires validatorAddress; resolve validatorName -> address client-side if needed.
    requestBody.validatorAddress =
      (options.validatorAddress
        ? (getAddress(options.validatorAddress) as `0x${string}`)
        : await resolveValidatorAddress({
            validatorName,
            chainId: chainIdFromDid,
          })) as `0x${string}`;

  const response = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}/validation-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || errorData.message || 'Failed to prepare validation request',
      );
    }

    prepared = (await response.json()) as AgentOperationPlan;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Failed to prepare validation request',
    );
  }

  const bundlerUrl: string | undefined = prepared.bundlerUrl;
  const rawCalls: Array<{ to: string; data: string; value?: string | number | bigint }> =
    Array.isArray(prepared.calls) ? prepared.calls : [];

  if (mode === 'eoa') {
    if (!prepared.transaction) {
      throw new Error('Validation request response missing transaction payload');
    }
    if (!account) {
      throw new Error('EOA mode requires account (EOA sender address)');
    }
    const txResult = await signAndSendTransaction({
      transaction: prepared.transaction as any,
      account,
      chain,
      ethereumProvider,
      onStatusUpdate,
    });

    const validatorAddress =
      ((prepared.metadata as any)?.validatorAddress as string | undefined) ||
      (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
      '';
    const finalRequestHash = (prepared.metadata as any)?.requestHash || '';

    return {
      txHash: txResult.hash,
      requiresClientSigning: true as const,
      validatorAddress,
      requestHash: finalRequestHash,
    };
  }

  if (!bundlerUrl || rawCalls.length === 0) {
    throw new Error('Validation request response missing bundlerUrl or calls');
  }

  const validationCalls = rawCalls.map((call) => ({
    to: call.to as `0x${string}`,
    data: call.data as `0x${string}`,
    value: BigInt(call.value ?? '0'),
  }));

  onStatusUpdate?.('Sending validation request via bundler...');
  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain: chain as any,
    accountClient: requesterAccountClient,
    calls: validationCalls,
  });

  onStatusUpdate?.(
    `Validation request sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`,
  );

  const receipt = await waitForUserOperationReceipt({
    bundlerUrl,
    chain: chain as any,
    hash: userOpHash,
  });

  const validatorAddress =
    ((prepared.metadata as any)?.validatorAddress as string | undefined) ||
    (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
    '';
  const finalRequestHash = (prepared.metadata as any)?.requestHash || '';

  return {
    txHash: userOpHash,
    requiresClientSigning: true as const,
    validatorAddress,
    requestHash: finalRequestHash,
  };
}

export async function requestAppValidationWithWallet(
  options: RequestValidationWithWalletOptions,
): Promise<{ txHash: string; requiresClientSigning: true; validatorAddress: string; requestHash: string }> {
  const {
    requesterDid,
    chain,
    requesterAccountClient,
    mode = 'smartAccount',
    ethereumProvider,
    account,
    requestUri,
    requestHash,
    onStatusUpdate,
  } = options;

  onStatusUpdate?.('Preparing validation request on server...');

  const validatorName = 'app-validator';
  const chainIdFromDid = (() => {
    const m = requesterDid.match(/^did:8004:(\d+):/);
    if (!m) return undefined;
    const parsed = Number(m[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  })();

  async function resolveValidatorAddressByName(params: {
    validatorName: string;
    chainId?: number;
  }): Promise<`0x${string}`> {
    const urlParams = new URLSearchParams({
      query: params.validatorName,
      page: '1',
      pageSize: '10',
    });

    const response = await fetch(`/api/agents/search?${urlParams.toString()}`);
    if (!response.ok) {
      throw new Error(
        `Failed to resolve validator "${params.validatorName}" via discovery (status ${response.status})`,
      );
    }

    const data = (await response.json().catch(() => ({}))) as any;
    const agents: any[] = Array.isArray(data?.agents) ? data.agents : [];

    const normalizedName = params.validatorName.trim().toLowerCase();
    const byExactName = agents.find((a) => {
      const name = typeof a?.agentName === 'string' ? a.agentName.trim().toLowerCase() : '';
      const chainIdOk =
        typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
      const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
      return chainIdOk && acctOk && name === normalizedName;
    });

    const fallback = agents.find((a) => {
      const chainIdOk =
        typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
      const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
      return chainIdOk && acctOk;
    });

    const agentAccount = (byExactName?.agentAccount ?? fallback?.agentAccount) as string | undefined;
    if (!agentAccount) {
      throw new Error(
        `Validator "${params.validatorName}" not found in discovery (chainId=${params.chainId ?? 'any'})`,
      );
    }

    return getAddress(agentAccount) as `0x${string}`;
  }

  async function resolveValidatorAddress(params: {
    validatorName: string;
    chainId?: number;
  }): Promise<`0x${string}`> {
    try {
      return await resolveValidatorAddressByName(params);
    } catch (_discoveryErr) {
      const chainId =
        typeof params.chainId === 'number'
          ? params.chainId
          : typeof (chain as any)?.id === 'number'
            ? ((chain as any).id as number)
            : undefined;

      if (!chainId) {
        throw _discoveryErr;
      }

      const resp = await fetch(
        `/api/validator-address?validatorName=${encodeURIComponent(params.validatorName)}&chainId=${encodeURIComponent(
          String(chainId),
        )}`,
      );

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const msg =
          errData?.error ||
          errData?.message ||
          `Failed to resolve validator "${params.validatorName}" via /api/validator-address (status ${resp.status})`;
        throw new Error(msg);
      }

      const data = (await resp.json().catch(() => ({}))) as any;
      const addr = typeof data?.validatorAddress === 'string' ? data.validatorAddress : '';
      if (!addr || !addr.startsWith('0x')) {
        throw new Error(
          `Validator "${params.validatorName}" address not returned by /api/validator-address`,
        );
      }
      return getAddress(addr) as `0x${string}`;
    }
  }

  let prepared: AgentOperationPlan;
  try {
    const requestBody: any = {
      requestUri,
      requestHash,
      mode,
    };
    
    requestBody.validatorAddress =
      (options.validatorAddress
        ? (getAddress(options.validatorAddress) as `0x${string}`)
        : await resolveValidatorAddress({
            validatorName,
            chainId: chainIdFromDid,
          })) as `0x${string}`;

    const response = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}/validation-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || errorData.message || 'Failed to prepare validation request',
      );
    }

    prepared = (await response.json()) as AgentOperationPlan;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Failed to prepare validation request',
    );
  }

  const bundlerUrl: string | undefined = prepared.bundlerUrl;
  const rawCalls: Array<{ to: string; data: string; value?: string | number | bigint }> =
    Array.isArray(prepared.calls) ? prepared.calls : [];

  if (mode === 'eoa') {
    if (!prepared.transaction) {
      throw new Error('Validation request response missing transaction payload');
    }
    if (!account) {
      throw new Error('EOA mode requires account (EOA sender address)');
    }
    const txResult = await signAndSendTransaction({
      transaction: prepared.transaction as any,
      account,
      chain,
      ethereumProvider,
      onStatusUpdate,
    });

    const validatorAddress =
      ((prepared.metadata as any)?.validatorAddress as string | undefined) ||
      (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
      '';
    const finalRequestHash = (prepared.metadata as any)?.requestHash || '';

    return {
      txHash: txResult.hash,
      requiresClientSigning: true as const,
      validatorAddress,
      requestHash: finalRequestHash,
    };
  }

  if (!bundlerUrl || rawCalls.length === 0) {
    throw new Error('Validation request response missing bundlerUrl or calls');
  }

  const validationCalls = rawCalls.map((call) => ({
    to: call.to as `0x${string}`,
    data: call.data as `0x${string}`,
    value: BigInt(call.value ?? '0'),
  }));

  onStatusUpdate?.('Sending validation request via bundler...');
  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain: chain as any,
    accountClient: requesterAccountClient,
    calls: validationCalls,
  });

  onStatusUpdate?.(
    `Validation request sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`,
  );

  const receipt = await waitForUserOperationReceipt({
    bundlerUrl,
    chain: chain as any,
    hash: userOpHash,
  });

  const validatorAddress =
    ((prepared.metadata as any)?.validatorAddress as string | undefined) ||
    (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
    '';
  const finalRequestHash = (prepared.metadata as any)?.requestHash || '';

  return {
    txHash: userOpHash,
    requiresClientSigning: true as const,
    validatorAddress,
    requestHash: finalRequestHash,
  };
}

export async function requestAIDValidationWithWallet(
  options: RequestValidationWithWalletOptions,
): Promise<{ txHash: string; requiresClientSigning: true; validatorAddress: string; requestHash: string }> {
  const {
    requesterDid,
    chain,
    requesterAccountClient,
    mode = 'smartAccount',
    ethereumProvider,
    account,
    requestUri,
    requestHash,
    onStatusUpdate,
  } = options;

  onStatusUpdate?.('Preparing validation request on server...');

  const validatorName = 'aid-validator';
  const chainIdFromDid = (() => {
    const m = requesterDid.match(/^did:8004:(\d+):/);
    if (!m) return undefined;
    const parsed = Number(m[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  })();

  async function resolveValidatorAddressByName(params: {
    validatorName: string;
    chainId?: number;
  }): Promise<`0x${string}`> {
    const urlParams = new URLSearchParams({
      query: params.validatorName,
      page: '1',
      pageSize: '10',
    });

    const response = await fetch(`/api/agents/search?${urlParams.toString()}`);
    if (!response.ok) {
      throw new Error(
        `Failed to resolve validator "${params.validatorName}" via discovery (status ${response.status})`,
      );
    }

    const data = (await response.json().catch(() => ({}))) as any;
    const agents: any[] = Array.isArray(data?.agents) ? data.agents : [];

    const normalizedName = params.validatorName.trim().toLowerCase();
    const byExactName = agents.find((a) => {
      const name = typeof a?.agentName === 'string' ? a.agentName.trim().toLowerCase() : '';
      const chainIdOk =
        typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
      const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
      return chainIdOk && acctOk && name === normalizedName;
    });

    const fallback = agents.find((a) => {
      const chainIdOk =
        typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
      const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
      return chainIdOk && acctOk;
    });

    const agentAccount = (byExactName?.agentAccount ?? fallback?.agentAccount) as string | undefined;
    if (!agentAccount) {
      throw new Error(
        `Validator "${params.validatorName}" not found in discovery (chainId=${params.chainId ?? 'any'})`,
      );
    }

    return getAddress(agentAccount) as `0x${string}`;
  }

  async function resolveValidatorAddress(params: {
    validatorName: string;
    chainId?: number;
  }): Promise<`0x${string}`> {
    try {
      return await resolveValidatorAddressByName(params);
    } catch (_discoveryErr) {
      const chainId =
        typeof params.chainId === 'number'
          ? params.chainId
          : typeof (chain as any)?.id === 'number'
            ? ((chain as any).id as number)
            : undefined;

      if (!chainId) {
        throw _discoveryErr;
      }

      const resp = await fetch(
        `/api/validator-address?validatorName=${encodeURIComponent(params.validatorName)}&chainId=${encodeURIComponent(
          String(chainId),
        )}`,
      );

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const msg =
          errData?.error ||
          errData?.message ||
          `Failed to resolve validator "${params.validatorName}" via /api/validator-address (status ${resp.status})`;
        throw new Error(msg);
      }

      const data = (await resp.json().catch(() => ({}))) as any;
      const addr = typeof data?.validatorAddress === 'string' ? data.validatorAddress : '';
      if (!addr || !addr.startsWith('0x')) {
        throw new Error(
          `Validator "${params.validatorName}" address not returned by /api/validator-address`,
        );
      }
      return getAddress(addr) as `0x${string}`;
    }
  }

  let prepared: AgentOperationPlan;
  try {
    const requestBody: any = {
      requestUri,
      requestHash,
      mode,
    };
    
    requestBody.validatorAddress =
      (options.validatorAddress
        ? (getAddress(options.validatorAddress) as `0x${string}`)
        : await resolveValidatorAddress({
            validatorName,
            chainId: chainIdFromDid,
          })) as `0x${string}`;

    const response = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}/validation-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || errorData.message || 'Failed to prepare validation request',
      );
    }

    prepared = (await response.json()) as AgentOperationPlan;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Failed to prepare validation request',
    );
  }

  const bundlerUrl: string | undefined = prepared.bundlerUrl;
  const rawCalls: Array<{ to: string; data: string; value?: string | number | bigint }> =
    Array.isArray(prepared.calls) ? prepared.calls : [];

  if (mode === 'eoa') {
    if (!prepared.transaction) {
      throw new Error('Validation request response missing transaction payload');
    }
    if (!account) {
      throw new Error('EOA mode requires account (EOA sender address)');
    }
    const txResult = await signAndSendTransaction({
      transaction: prepared.transaction as any,
      account,
      chain,
      ethereumProvider,
      onStatusUpdate,
    });

    const validatorAddress =
      ((prepared.metadata as any)?.validatorAddress as string | undefined) ||
      (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
      '';
    const finalRequestHash = (prepared.metadata as any)?.requestHash || '';

    return {
      txHash: txResult.hash,
      requiresClientSigning: true as const,
      validatorAddress,
      requestHash: finalRequestHash,
    };
  }

  if (!bundlerUrl || rawCalls.length === 0) {
    throw new Error('Validation request response missing bundlerUrl or calls');
  }

  const validationCalls = rawCalls.map((call) => ({
    to: call.to as `0x${string}`,
    data: call.data as `0x${string}`,
    value: BigInt(call.value ?? '0'),
  }));

  onStatusUpdate?.('Sending validation request via bundler...');
  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain: chain as any,
    accountClient: requesterAccountClient,
    calls: validationCalls,
  });

  onStatusUpdate?.(
    `Validation request sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`,
  );

  const receipt = await waitForUserOperationReceipt({
    bundlerUrl,
    chain: chain as any,
    hash: userOpHash,
  });

  const validatorAddress =
    ((prepared.metadata as any)?.validatorAddress as string | undefined) ||
    (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
    '';
  const finalRequestHash = (prepared.metadata as any)?.requestHash || '';

  return {
    txHash: userOpHash,
    requiresClientSigning: true as const,
    validatorAddress,
    requestHash: finalRequestHash,
  };
}
