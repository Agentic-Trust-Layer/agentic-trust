/**
 * Agentic Trust SDK - Identity Client
 * Extends the base ERC-8004 IdentityClient with AA-centric helpers.
 * 
 * Uses AccountProvider (Ports & Adapters pattern) for chain I/O.
 */
import { 
  createPublicClient, 
  http, 
  hexToString, 
  type Chain, 
  type PublicClient,
  type WalletClient,
  type Account,
  type Transport,
  type Address as ViemAddress,
  type Hex,
  type Abi,
} from 'viem';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';
import { 
  BaseIdentityClient,
  AccountProvider,
  ViemAccountProvider,
  type ChainConfig,
  type ViemAccountProviderOptions,
} from '@agentic-trust/8004-sdk';
import IdentityRegistryABI from './abis/IdentityRegistry.json';
import type { MetadataEntry } from '@agentic-trust/8004-sdk';

export type AIAgentIdentityClientOptions = 
  | {
      // Option 1: Use AccountProvider directly (recommended, supports all custody models)
      accountProvider: AccountProvider;
      identityRegistryAddress: `0x${string}`;
    }
  | {
      // Option 2: Use viem clients directly (simple, native viem support)
      publicClient: PublicClient;
      walletClient?: WalletClient<Transport, Chain, Account> | null;
      identityRegistryAddress: `0x${string}`;
      chainConfig?: ChainConfig;
    }
  | {
      // Option 3: Legacy pattern - create clients from chainId/rpcUrl (backward compatible)
      chainId: number;
      rpcUrl: string;
      identityRegistryAddress: `0x${string}`;
      walletClient?: WalletClient<Transport, Chain, Account> | null;
      account?: Account | ViemAddress;
      bundlerUrl?: string;
      paymasterUrl?: string;
    };

function getChainById(chainId: number): Chain {
  switch (chainId) {
    case 11155111: // ETH Sepolia
      return sepolia;
    case 84532: // Base Sepolia
      return baseSepolia;
    case 11155420: // Optimism Sepolia
      return optimismSepolia;
    default:
      console.warn(`Unknown chainId ${chainId}, defaulting to ETH Sepolia`);
      return sepolia;
  }
}

export class AIAgentIdentityClient extends BaseIdentityClient {
  private chain: Chain | null = null;
  private identityRegistryAddress: `0x${string}`;
  private publicClient: PublicClient | null = null;
  private walletClient: WalletClient<Transport, Chain, Account> | null = null;
  // accountProvider is protected in BaseIdentityClient, so we need to keep it accessible
  protected accountProvider: AccountProvider;

  constructor(options: AIAgentIdentityClientOptions) {
    let accountProvider: AccountProvider;
    let chain: Chain | null = null;
    let publicClient: PublicClient | null = null;
    let walletClient: WalletClient<Transport, Chain, Account> | null = null;
    let identityRegistryAddress: `0x${string}`;

    if ('accountProvider' in options) {
      // Option 1: Use provided AccountProvider (recommended)
      accountProvider = options.accountProvider;
      identityRegistryAddress = options.identityRegistryAddress;
      
      // Try to extract publicClient from AccountProvider if it's a ViemAccountProvider
      const viemProvider = accountProvider as any;
      if (viemProvider.publicClient) {
        publicClient = viemProvider.publicClient;
      }
      if (viemProvider.walletClient) {
        walletClient = viemProvider.walletClient;
      }
      if (viemProvider.chainConfig?.chain) {
        chain = viemProvider.chainConfig.chain;
      }
    } else if ('publicClient' in options) {
      // Option 2: Use viem clients directly (simplest, native viem)
      publicClient = options.publicClient;
      walletClient = options.walletClient ?? null;
      identityRegistryAddress = options.identityRegistryAddress;
      
      // Create ChainConfig
      const chainConfig: ChainConfig = options.chainConfig || {
        id: publicClient.chain?.id || 11155111,
        rpcUrl: (publicClient.transport as any)?.url || '',
        name: publicClient.chain?.name || 'Unknown',
        chain: publicClient.chain || undefined,
      };
      
      // Create ViemAccountProvider from the clients
      accountProvider = new ViemAccountProvider({
        publicClient,
        walletClient: walletClient ?? null,
        account: walletClient?.account,
        chainConfig,
      });
    } else {
      // Option 3: Legacy pattern - create from chainId/rpcUrl
      chain = getChainById(options.chainId);
      // @ts-ignore - viem version compatibility issue
      publicClient = createPublicClient({ chain, transport: http(options.rpcUrl) });
      walletClient = options.walletClient ?? null;
      
      // Create ChainConfig
      const chainConfig: ChainConfig = {
        id: options.chainId,
        rpcUrl: options.rpcUrl,
        name: chain.name,
        chain: chain,
        bundlerUrl: options.bundlerUrl,
        paymasterUrl: options.paymasterUrl,
      };
      
      // Create ViemAccountProvider
      accountProvider = new ViemAccountProvider({
        publicClient,
        walletClient: walletClient ?? null,
        account: options.account || walletClient?.account,
        chainConfig,
      });
      
      identityRegistryAddress = options.identityRegistryAddress;
    }

    // Pass accountProvider to BaseIdentityClient
    super(accountProvider, identityRegistryAddress);

    this.chain = chain;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.identityRegistryAddress = identityRegistryAddress;
    this.accountProvider = accountProvider;
  }

  /**
   * Get metadata using AccountProvider
   */
  async getMetadata(agentId: bigint, key: string): Promise<string> {
    const bytes = await this.accountProvider.call<`0x${string}`>({
      to: this.identityRegistryAddress,
      abi: IdentityRegistryABI as any,
      functionName: 'getMetadata',
      args: [agentId, key],
    });
    return hexToString(bytes);
  }

  /**
   * Encode function call data using AccountProvider
   */
  async encodeFunctionData(
    abi: any[],
    functionName: string,
    args: any[]
  ): Promise<string> {
    return await this.accountProvider.encodeFunctionData({
      abi,
      functionName,
      args,
    });
  }

  /**
   * Legacy method - delegates to encodeFunctionData
   * @deprecated Use encodeFunctionData instead
   */
  encodeCall(
    abi: any[],
    functionName: string,
    args: any[]
  ): string {
    // This is a synchronous method, but encodeFunctionData is async
    // For backward compatibility, we'll use ethers for now
    // TODO: Consider making this async or removing it
    const { ethers } = require('ethers');
    const iface = new ethers.Interface(abi);
    return iface.encodeFunctionData(functionName, args);
  }

  /**
   * Encode register calldata without sending (for bundler/AA - like EAS SDK pattern)
   * This override exists in the Agentic Trust SDK to keep AA helpers here.
   */
  async encodeRegisterWithMetadata(
    tokenUri: string,
    metadata: MetadataEntry[] = []
  ): Promise<string> {
    // Format metadata: convert string values to hex strings (Viem expects hex for bytes)
    const metadataFormatted = metadata.map(m => {
      // Use stringToBytes from base class (via inheritance)
      const bytes = (this as any).stringToBytes(m.value);
      // Convert to hex string (Viem requires hex strings, not Uint8Array)
      const hexString = (this as any).bytesToHex(bytes);
      return {
        key: m.key,
        value: hexString as `0x${string}`,
      };
    });
    
    // Use AccountProvider's encodeFunctionData
    return await this.accountProvider.encodeFunctionData({
      abi: IdentityRegistryABI as any,
      functionName: 'register',
      args: [tokenUri, metadataFormatted],
    });
  }

  async encodeRegister(name: string, agentAccount: `0x${string}`, tokenUri: string): Promise<string> {
    console.info("name: ", name);
    console.info("agentAccount: ", agentAccount);

    return await this.encodeRegisterWithMetadata(tokenUri, [{ key: 'agentName', value: name }, { key: 'agentAccount', value: agentAccount }]);
  }

  async prepareRegisterCalls(name: string, agentAccount: `0x${string}`, tokenUri: string): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {
    const data = await this.encodeRegisterWithMetadata(tokenUri, [{ key: 'agentName', value: name }, { key: 'agentAccount', value: agentAccount }]);
    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];
    calls.push({ 
        to: this.identityRegistryAddress, 
        data: data as `0x${string}`
    });
    return { calls };
  }

  async encodeSetRegistrationUri(agentId: bigint, uri: string): Promise<`0x${string}`>  {
    const data = await this.accountProvider.encodeFunctionData({
      abi: IdentityRegistryABI as any,
      functionName: 'setAgentUri',
      args: [agentId, uri],
    });
    return data as `0x${string}`;
  }

  async prepareSetRegistrationUriCalls(
    agentId: bigint, 
    uri: string
  ): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {

    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];

    const data = await this.encodeSetRegistrationUri(agentId, uri);
    calls.push({ 
      to: this.identityRegistryAddress, 
      data: data as `0x${string}`
    });

    return { calls };

  }

  /**
   * Prepare a complete transaction for client-side signing (similar to prepareCall for bundlers)
   * All Ethereum logic (encoding, gas estimation, nonce) is handled server-side
   * Client only needs to sign and send with MetaMask
   * @param tokenUri - IPFS token URI for the agent registration
   * @param metadata - Metadata entries for the agent
   * @param fromAddress - Address that will sign the transaction (only address needed, no client)
   * @returns Prepared transaction object ready for client-side signing
   */
  async prepareRegisterTransaction(
    tokenUri: string,
    metadata: MetadataEntry[],
    fromAddress: `0x${string}`
  ): Promise<{
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`; // Hex string for Viem compatibility
    gas?: `0x${string}`; // Hex string for Viem compatibility
    gasPrice?: `0x${string}`; // Hex string for Viem compatibility
    maxFeePerGas?: `0x${string}`; // Hex string for Viem compatibility
    maxPriorityFeePerGas?: `0x${string}`; // Hex string for Viem compatibility
    nonce?: number;
    chainId: number;
  }> {
    // Encode the transaction data
    const encodedData = await this.encodeRegisterWithMetadata(tokenUri, metadata);

    // Get chain ID using AccountProvider
    const chainId = await this.accountProvider.chainId();

    // Initialize gas estimation variables
    let gasEstimate: bigint | undefined;
    let gasPrice: bigint | undefined;
    let maxFeePerGas: bigint | undefined;
    let maxPriorityFeePerGas: bigint | undefined;
    let nonce: number | undefined;

    try {
      // Get current block data to check for EIP-1559 support
      const blockData = await this.accountProvider.getBlock('latest');

      // Prefer EIP-1559 (maxFeePerGas/maxPriorityFeePerGas) if available
      // Otherwise fall back to legacy gasPrice
      if (blockData && 'baseFeePerGas' in blockData && blockData.baseFeePerGas) {
        // EIP-1559: Use maxFeePerGas and maxPriorityFeePerGas
        // Set a reasonable priority fee (1-2 gwei typically)
        // maxFeePerGas should be baseFeePerGas + maxPriorityFeePerGas + buffer
        maxPriorityFeePerGas = 1000000000n; // 1 gwei as priority fee
        maxFeePerGas = (blockData.baseFeePerGas * 2n) + maxPriorityFeePerGas; // 2x base + priority (buffer for safety)
      } else {
        // Legacy: Use gasPrice
        gasPrice = await this.accountProvider.getGasPrice();
      }

      // Estimate gas using AccountProvider
      gasEstimate = await this.accountProvider.estimateGas({
        account: fromAddress,
        to: this.identityRegistryAddress,
        data: encodedData as `0x${string}`,
      });

      // Get nonce using AccountProvider
      nonce = await this.accountProvider.getTransactionCount(fromAddress, 'pending');
    } catch (error) {
      console.warn('Could not estimate gas or get transaction parameters:', error);
      // Continue without gas estimates - client can estimate
    }

    // Build transaction object - return hex strings for all bigint values (Viem accepts hex strings directly)
    // This format can be used directly with Viem's sendTransaction without client-side conversion
    const txParams: any = {
      to: this.identityRegistryAddress,
      data: encodedData as `0x${string}`,
      value: '0x0', // Hex string for value
      gas: gasEstimate ? `0x${gasEstimate.toString(16)}` : undefined,
      nonce,
      chainId,
    };

    // Include EIP-1559 fields if available, otherwise legacy gasPrice
    // All as hex strings for direct Viem compatibility
    if (maxFeePerGas && maxPriorityFeePerGas) {
      txParams.maxFeePerGas = `0x${maxFeePerGas.toString(16)}`;
      txParams.maxPriorityFeePerGas = `0x${maxPriorityFeePerGas.toString(16)}`;
    } else if (gasPrice) {
      txParams.gasPrice = `0x${gasPrice.toString(16)}`;
    }

    return txParams;
  }

  async isValidAgentAccount(agentAccount: `0x${string}`): Promise<boolean | null> {
    try {
      // Use AccountProvider's ReadClient interface - check if address has code
      // We can use a simple call to check if it's a contract
      // For now, we'll use publicClient if available, otherwise return null
      if (this.publicClient) {
        const code = await this.publicClient.getBytecode({ address: agentAccount });
        return code ? true : false;
      }
      // AccountProvider doesn't expose getBytecode directly, so we check via isContractSigner
      // This is a workaround - ideally AccountProvider would expose getBytecode
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract agentId from a user operation/transaction receipt
   * Public in this SDK to support AA flows explicitly.
   */
  extractAgentIdFromReceiptPublic(receipt: any): bigint {
    // Look for parsed events first
    if (receipt?.events) {
      const registeredEvent = receipt.events.find((e: any) => e.name === 'Registered');
      if (registeredEvent?.args) {
        const val = registeredEvent.args.agentId ?? registeredEvent.args[0];
        if (val !== undefined) return BigInt(val);
      }

      const transferEvent = receipt.events.find(
        (e: any) => e.name === 'Transfer' && (e.args.from === '0x0000000000000000000000000000000000000000' || e.args.from === 0 || e.args.from === 0n)
      );
      if (transferEvent?.args) {
        const val = transferEvent.args.tokenId ?? transferEvent.args[2];
        if (val !== undefined) return BigInt(val);
      }
    }

    // Fallback: raw logs array
    if (receipt?.logs && Array.isArray(receipt.logs)) {
      for (const log of receipt.logs) {
        // Transfer(address,address,uint256)
        if (log.topics && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
          const from = log.topics[1];
          if (from === '0x0000000000000000000000000000000000000000000000000000000000000000') {
            const tokenId = BigInt(log.topics[3] || log.data);
            return tokenId;
          }
        }
      }
    }

    throw new Error('Could not extract agentId from transaction receipt - Registered or Transfer event not found');
  }

  /**
   * Get the owner (EOA) of an account address
   * 
   * @param accountAddress - The account address (smart account or contract)
   * @returns The owner address (EOA) or null if not found or error
   */
  async getAccountOwner(accountAddress: `0x${string}`): Promise<string | null> {
    try {
      const owner = await this.accountProvider.call<string>({
        to: accountAddress,
        abi: [{ name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as any,
        functionName: 'owner',
        args: [],
      });
      return owner;
    } catch {
      return null;
    }
  }

  /**
   * @deprecated Use getAccountOwner instead
   */
  async getAgentEoaByAgentAccount(agentAccount: `0x${string}`): Promise<string | null> {
    return this.getAccountOwner(agentAccount);
  }

  /**
   * Get agentName from on-chain metadata (string value)
   */
  async getAgentName(agentId: bigint): Promise<string | null> {
    try {
      const name = await this.getMetadata(agentId, 'agentName');
      if (typeof name === 'string') {
        const trimmed = name.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      return name ? String(name) : null;
    } catch (error: any) {
      console.info("++++++++++++++++++++++++ getAgentName: error", error);
      return null;
    }
  }

  /**
   * Get agentAccount address from on-chain metadata.
   * Supports CAIP-10 format like "eip155:11155111:0x..." or raw 0x address.
   */
  async getAgentAccount(agentId: bigint): Promise<`0x${string}` | null> {
    try {
      const value = await this.getMetadata(agentId, 'agentAccount');
      if (!value) return null;
      if (typeof value === 'string') {
        const v = value.trim();
        if (v.startsWith('eip155:')) {
          const parts = v.split(':');
          const addr = parts[2];
          if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) return addr as `0x${string}`;
        }
        if (/^0x[a-fA-F0-9]{40}$/.test(v)) return v as `0x${string}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Keep compatibility: delegate to receipt extractor.
   */
  extractAgentIdFromLogs(receipt: any): bigint {
    return this.extractAgentIdFromReceiptPublic(receipt);
  }
}
