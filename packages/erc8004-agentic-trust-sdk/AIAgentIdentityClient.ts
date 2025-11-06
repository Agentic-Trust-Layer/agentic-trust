/**
 * Agentic Trust SDK - Identity Client
 * Extends the base ERC-8004 IdentityClient with AA-centric helpers.
 * 
 * Supports both viem-native usage (simple) and full adapter pattern (flexible).
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
import { IdentityClient as BaseIdentityClient, BlockchainAdapter, ViemAdapter } from '@erc8004/sdk';
import IdentityRegistryABI from './abis/IdentityRegistry.json';
import type { MetadataEntry } from '@erc8004/sdk';

export type AIAgentIdentityClientOptions = 
  | {
      // Option 1: Use adapter directly (flexible, supports any blockchain library)
      adapter: BlockchainAdapter;
      identityRegistryAddress: `0x${string}`;
    }
  | {
      // Option 2: Use viem clients directly (simple, native viem support)
      publicClient: PublicClient;
      walletClient?: WalletClient<Transport, Chain, Account> | null;
      identityRegistryAddress: `0x${string}`;
    }
  | {
      // Option 3: Legacy pattern - create clients from chainId/rpcUrl (backward compatible)
      chainId: number;
      rpcUrl: string;
      identityRegistryAddress: `0x${string}`;
      walletClient?: WalletClient<Transport, Chain, Account> | null;
      account?: Account | ViemAddress;
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

  constructor(options: AIAgentIdentityClientOptions) {
    let adapter: BlockchainAdapter;
    let chain: Chain | null = null;
    let publicClient: PublicClient | null = null;
    let walletClient: WalletClient<Transport, Chain, Account> | null = null;
    let identityRegistryAddress: `0x${string}`;

    if ('adapter' in options) {
      // Option 1: Use provided adapter
      adapter = options.adapter;
      identityRegistryAddress = options.identityRegistryAddress;
      
      // Try to extract publicClient from adapter if it's a ViemAdapter
      if ((adapter as any).publicClient) {
        publicClient = (adapter as any).publicClient;
      }
      if ((adapter as any).walletClient) {
        walletClient = (adapter as any).walletClient;
      }
    } else if ('publicClient' in options) {
      // Option 2: Use viem clients directly (simplest, native viem)
      publicClient = options.publicClient;
      walletClient = options.walletClient ?? null;
      identityRegistryAddress = options.identityRegistryAddress;
      
      // Create ViemAdapter from the clients
      adapter = new ViemAdapter({
        publicClient,
        walletClient: walletClient ?? null,
      });
    } else {
      // Option 3: Legacy pattern - create from chainId/rpcUrl
      chain = getChainById(options.chainId);
      // @ts-ignore - viem version compatibility issue
      publicClient = createPublicClient({ chain, transport: http(options.rpcUrl) });
      walletClient = options.walletClient ?? null;
      
      // Create ViemAdapter
      adapter = new ViemAdapter({
        publicClient,
        walletClient: walletClient ?? null,
      });
      
      identityRegistryAddress = options.identityRegistryAddress;
    }

    // Pass adapter to BaseIdentityClient
    super(adapter, identityRegistryAddress);

    this.chain = chain;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.identityRegistryAddress = identityRegistryAddress;
  }

  /**
   * Get metadata using viem's native readContract (if publicClient available)
   * Falls back to adapter if needed
   */
  async getMetadata(agentId: bigint, key: string): Promise<string> {
    if (this.publicClient) {
      // Use viem's native readContract - simpler and direct
      // @ts-ignore - viem version compatibility issue
      const bytes = await this.publicClient.readContract({
        address: this.identityRegistryAddress,
        abi: IdentityRegistryABI as any,
        functionName: 'getMetadata',
        args: [agentId, key],
      });
      return hexToString(bytes as `0x${string}`);
    }
    
    // Fallback to adapter
    const adapterCall = (this as any).adapter.call as <T = unknown>(
      contractAddress: any,
      abi: any,
      functionName: string,
      args?: readonly unknown[]
    ) => Promise<T>;
    const bytes = await adapterCall<`0x${string}`>(
      this.identityRegistryAddress,
      IdentityRegistryABI as any,
      'getMetadata',
      [agentId, key] as any
    );
    return hexToString(bytes as `0x${string}`);
  }

  /**
   * Encode function call data using viem's native encodeFunctionData (if available)
   * Falls back to adapter if needed
   */
  async encodeFunctionData(
    abi: any[],
    functionName: string,
    args: any[]
  ): Promise<string> {
    // Use adapter's encodeFunctionData (which uses viem internally)
    return await (this as any).adapter.encodeFunctionData(
      this.identityRegistryAddress,
      abi,
      functionName,
      args as any
    );
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
    tokenURI: string,
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
    
    // Use adapter's encodeFunctionData (which uses viem internally)
    return await (this as any).adapter.encodeFunctionData(
      this.identityRegistryAddress,
      IdentityRegistryABI as any,
      'register(string,(string,bytes)[])',
      [tokenURI, metadataFormatted] as any
    );
  }

  async encodeRegister(name: string, agentAccount: `0x${string}`, tokenURI: string): Promise<string> {
    console.info("name: ", name);
    console.info("agentAccount: ", agentAccount);

    return await this.encodeRegisterWithMetadata(tokenURI, [{ key: 'agentName', value: name }, { key: 'agentAccount', value: agentAccount }]);
  }

  async prepareRegisterCalls(name: string, agentAccount: `0x${string}`, tokenURI: string): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {
    const data = await this.encodeRegisterWithMetadata(tokenURI, [{ key: 'agentName', value: name }, { key: 'agentAccount', value: agentAccount }]);
    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];
    calls.push({ 
        to: this.identityRegistryAddress, 
        data: data as `0x${string}`
    });
    return { calls };
  }

  async encodeSetRegistrationUri(agentId: bigint, uri: string): Promise<`0x${string}`>  {
    const data = await (this as any).adapter.encodeFunctionData(
      this.identityRegistryAddress,
      IdentityRegistryABI as any,
      'setAgentUri',
      [agentId, uri] as any
    );
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
   * @param tokenURI - IPFS token URI for the agent registration
   * @param metadata - Metadata entries for the agent
   * @param fromAddress - Address that will sign the transaction (only address needed, no client)
   * @returns Prepared transaction object ready for client-side signing
   */
  async prepareRegisterTransaction(
    tokenURI: string,
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
    // Ensure we have a publicClient (required for gas estimation and nonce)
    if (!this.publicClient) {
      throw new Error(
        'AIAgentIdentityClient must be initialized with a publicClient or chainId/rpcUrl to prepare transactions. ' +
        'Use a constructor that provides public client access (e.g., chainId/rpcUrl or publicClient option).'
      );
    }

    // Encode the transaction data
    const encodedData = await this.encodeRegisterWithMetadata(tokenURI, metadata);

    // Get chain ID using internal publicClient
    const chainId = await this.publicClient.getChainId();

    // Initialize gas estimation variables
    let gasEstimate: bigint | undefined;
    let gasPrice: bigint | undefined;
    let maxFeePerGas: bigint | undefined;
    let maxPriorityFeePerGas: bigint | undefined;
    let nonce: number | undefined;

    try {
      // Get current block data to check for EIP-1559 support
      const blockData = await this.publicClient.getBlock({ blockTag: 'latest' });

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
        gasPrice = await this.publicClient.getGasPrice();
      }

      // Estimate gas using internal publicClient
      gasEstimate = await this.publicClient.estimateGas({
        account: fromAddress,
        to: this.identityRegistryAddress,
        data: encodedData as `0x${string}`,
      });

      // Get nonce using internal publicClient
      nonce = await this.publicClient.getTransactionCount({
        address: fromAddress,
        blockTag: 'pending',
      });
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
    if (this.publicClient) {
      const code = await this.publicClient.getBytecode({ address: agentAccount as `0x${string}` });
      return code ? true : false;
    }
    // Fallback to adapter if no publicClient
    try {
      // Try to get code via adapter (if it supports read operations)
      const code = await ((this as any).adapter as any).publicClient?.getBytecode?.({ address: agentAccount });
      return code ? true : false;
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

  async getAgentEoaByAgentAccount(agentAccount: `0x${string}`): Promise<string | null> {
    if (this.publicClient) {
      // @ts-ignore - viem version compatibility issue
      const eoa = await this.publicClient.readContract({
        address: agentAccount as `0x${string}`,
        abi: [{ name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
        functionName: 'owner',
      });
      return eoa as string;
    }
    
    // Fallback to adapter
    try {
      const adapterCall = (this as any).adapter.call as <T = unknown>(
        contractAddress: any,
        abi: any,
        functionName: string,
        args?: readonly unknown[]
      ) => Promise<T>;
      const eoa = await adapterCall<string>(
        agentAccount,
        [{ name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as any,
        'owner',
        [] as any
      );
      return eoa;
    } catch {
      return null;
    }
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
