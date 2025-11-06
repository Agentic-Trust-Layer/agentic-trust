/**
 * Viem-based AccountProvider implementation
 * Implements ReadClient, Signer, and TxSender using Viem
 */

import {
  PublicClient,
  WalletClient,
  Account,
  Address,
  Hex,
  Abi,
  Chain,
  Transport,
  getAddress,
  decodeEventLog,
} from 'viem';
import type {
  ReadClient,
  Signer,
  TxSender,
  AccountProvider,
  ChainConfig,
  TxRequest,
  TxSendResult,
  GasPolicy,
} from '../types';

export interface ViemAccountProviderOptions {
  publicClient: PublicClient;
  walletClient?: WalletClient<Transport, Chain, Account> | null;
  account?: Account | Address;
  chainConfig: ChainConfig;
}

/**
 * Viem-based AccountProvider
 * Composes ReadClient, Signer, and TxSender using Viem clients
 */
export class ViemAccountProvider implements AccountProvider {
  private publicClient: PublicClient;
  private walletClient?: WalletClient<Transport, Chain, Account> | null;
  private account?: Account | Address;
  private chainConfig: ChainConfig;

  constructor(options: ViemAccountProviderOptions) {
    this.publicClient = options.publicClient;
    this.walletClient = options.walletClient ?? null;
    this.account = options.account;
    this.chainConfig = options.chainConfig;

    // Extract account from walletClient if available
    if (this.walletClient && 'account' in this.walletClient && this.walletClient.account) {
      this.account = this.walletClient.account;
    }
  }

  // ChainConfig
  chain(): ChainConfig {
    return this.chainConfig;
  }

  // ReadClient implementation
  async chainId(): Promise<number> {
    return this.publicClient.getChainId();
  }

  async call<T = unknown>(args: {
    to: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    blockTag?: 'latest' | 'pending' | bigint;
  }): Promise<T> {
    const cleanFunctionName = args.functionName.includes('(')
      ? args.functionName.substring(0, args.functionName.indexOf('('))
      : args.functionName;

    const result = await this.publicClient.readContract({
      address: args.to,
      abi: args.abi,
      functionName: cleanFunctionName,
      args: args.args as any,
      blockTag: args.blockTag as any,
    });
    return result as T;
  }

  async getBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  async getBlock(blockTag?: 'latest' | 'pending' | bigint): Promise<any> {
    const tag = blockTag === undefined ? 'latest' : (typeof blockTag === 'bigint' ? blockTag : blockTag);
    return this.publicClient.getBlock({ blockTag: tag as any });
  }

  async getTransactionCount(
    address: Address,
    blockTag: 'pending' | 'latest' = 'pending'
  ): Promise<number> {
    return this.publicClient.getTransactionCount({ address, blockTag });
  }

  async estimateGas(args: {
    to: Address;
    data: Hex;
    value?: bigint;
    account?: Address;
  }): Promise<bigint> {
    return this.publicClient.estimateGas({
      account: args.account || (await this.getAddress()),
      to: args.to,
      data: args.data,
      value: args.value,
    });
  }

  async getGasPrice(): Promise<bigint> {
    return this.publicClient.getGasPrice();
  }

  async encodeFunctionData(args: {
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<Hex> {
    const { encodeFunctionData } = await import('viem');
    const cleanFunctionName = args.functionName.includes('(')
      ? args.functionName.substring(0, args.functionName.indexOf('('))
      : args.functionName;
    return encodeFunctionData({
      abi: args.abi,
      functionName: cleanFunctionName,
      args: args.args as any,
    });
  }

  // Signer implementation
  async getAddress(): Promise<Address> {
    if (!this.walletClient) {
      throw new Error('Wallet client required for signing. Provide walletClient when creating the provider.');
    }

    if (this.account) {
      if (typeof this.account === 'string') {
        return await getAddress(this.account);
      }
      return this.account.address;
    }

    if (this.walletClient && 'account' in this.walletClient && this.walletClient.account) {
      const account = this.walletClient.account;
      return typeof account === 'string' ? await getAddress(account) : account.address;
    }

    throw new Error('No account available for signing. Provide account in walletClient or constructor.');
  }

  async signMessage(message: string | Uint8Array): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet client required for signing. Provide walletClient when creating the provider.');
    }

    const account = await this.getAddress();
    const accountObj = this.account
      ? (typeof this.account === 'string' ? null : this.account)
      : (this.walletClient.account || null);

    if (!accountObj) {
      throw new Error('Account object required for signing. Provide account in walletClient.');
    }

    return this.walletClient.signMessage({
      account: accountObj,
      message: typeof message === 'string' ? message : { raw: message },
    });
  }

  async signTypedData<TTypedData extends Record<string, unknown>>(args: {
    domain: any;
    types: any;
    primaryType: string;
    message: TTypedData;
  }): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet client required for signing. Provide walletClient when creating the provider.');
    }

    const accountObj = this.account
      ? (typeof this.account === 'string' ? null : this.account)
      : (this.walletClient.account || null);

    if (!accountObj) {
      throw new Error('Account object required for signing. Provide account in walletClient.');
    }

    return this.walletClient.signTypedData({
      account: accountObj,
      domain: args.domain,
      types: args.types,
      primaryType: args.primaryType,
      message: args.message,
    });
  }

  async isContractSigner(): Promise<boolean> {
    // Check if address is a contract (has code)
    try {
      const address = await this.getAddress();
      const code = await this.publicClient.getBytecode({ address });
      return code !== undefined && code !== '0x';
    } catch {
      return false;
    }
  }

  // TxSender implementation
  async send(
    tx: TxRequest,
    opts?: {
      gasPolicy?: GasPolicy;
      simulation?: boolean;
      metadata?: Record<string, unknown>;
    }
  ): Promise<TxSendResult> {
    if (!this.walletClient) {
      throw new Error('Wallet client required for sending transactions. Provide walletClient when creating the provider.');
    }

    const account = await this.getAddress();
    const accountObj = this.account
      ? (typeof this.account === 'string' ? null : this.account)
      : (this.walletClient.account || null);

    if (!accountObj) {
      throw new Error('Account object required for sending. Provide account in walletClient.');
    }

    // Simulate if requested (using estimateGas for basic validation)
    if (opts?.simulation !== false) {
      try {
        await this.estimateGas({
          to: tx.to,
          data: tx.data,
          value: tx.value,
          account: accountObj.address,
        });
      } catch (simError) {
        console.warn('Transaction simulation failed:', simError);
        // Continue anyway if simulation fails
      }
    }

    // Prepare transaction request
    const request: any = {
      account: accountObj,
      to: tx.to,
      data: tx.data,
      value: tx.value || 0n,
    };

    if (tx.gas) {
      request.gas = tx.gas;
    }
    if (tx.maxFeePerGas) {
      request.maxFeePerGas = tx.maxFeePerGas;
    }
    if (tx.maxPriorityFeePerGas) {
      request.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
    }
    if (tx.gasPrice) {
      request.gasPrice = tx.gasPrice;
    }
    if (tx.nonce !== undefined) {
      request.nonce = tx.nonce;
    }

    // Send transaction
    // Use sendTransaction since data is already encoded (not writeContract which expects ABI)
    const hash = await this.walletClient.sendTransaction({
      ...request,
      chain: this.walletClient.chain,
    } as any);

    // Wait for receipt
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    // Parse events if ABI is available (would need to be passed in metadata)
    const events: any[] = [];
    // Events parsing would require ABI from metadata - simplified for now

    return {
      hash,
      kind: 'tx',
      blockNumber: receipt.blockNumber,
      receipt,
      events,
    };
  }

  async sendBatch(
    txs: TxRequest[],
    opts?: {
      gasPolicy?: GasPolicy;
      simulation?: boolean;
      metadata?: Record<string, unknown>;
    }
  ): Promise<TxSendResult> {
    // For EOA, send sequentially
    // For AA, this would be a single UserOperation with multiple calls
    // For now, implement sequential sends
    if (txs.length === 0) {
      throw new Error('Cannot send empty batch');
    }

    if (txs.length === 1) {
      return this.send(txs[0]!, opts);
    }

    // Sequential sends (could be optimized with multicall or AA)
    let lastResult: TxSendResult | null = null;
    for (const tx of txs) {
      lastResult = await this.send(tx, opts);
    }

    if (!lastResult) {
      throw new Error('Batch send failed');
    }

    return lastResult;
  }
}

