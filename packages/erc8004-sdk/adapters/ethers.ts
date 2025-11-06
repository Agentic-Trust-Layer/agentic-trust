/**
 * Ethers.js v6 adapter implementation
 */

import { Contract, ethers } from 'ethers';
import type { Abi, Address, Hex } from 'viem';
import { BlockchainAdapter, ContractCallResult } from './types';

export class EthersAdapter implements BlockchainAdapter {
  private provider: ethers.Provider;
  private signer?: ethers.Signer;

  constructor(provider: ethers.Provider, signer?: ethers.Signer) {
    this.provider = provider;
    this.signer = signer;
  }

  // Public getters to access the private provider and signer
  getProvider(): ethers.Provider {
    return this.provider;
  }

  getSigner(): ethers.Signer | undefined {
    return this.signer;
  }

  async call<T = unknown>(
    contractAddress: Address,
    abi: Abi,
    functionName: string,
    args?: readonly unknown[]
  ): Promise<T> {
    const contract = new Contract(contractAddress, abi as any, this.provider);
    const fn = contract[functionName];
    if (!fn || typeof fn !== 'function') {
      throw new Error(`Function ${functionName} not found in contract`);
    }
    return await fn(...(args || [])) as T;
  }

  async send(
    contractAddress: Address,
    abi: Abi,
    functionName: string,
    args?: readonly unknown[],
    overrides?: {
      value?: bigint;
      gas?: bigint;
      gasPrice?: bigint;
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas?: bigint;
      nonce?: number;
      account?: Address;
      chain?: any;
    }
  ): Promise<ContractCallResult> {
    if (!this.signer) {
      throw new Error('Signer required for write operations');
    }

    const contract = new Contract(contractAddress, abi as any, this.signer);
    const fn = contract[functionName];
    if (!fn || typeof fn !== 'function') {
      throw new Error(`Function ${functionName} not found in contract`);
    }

    // Build transaction options from overrides
    const txOptions: any = {};
    if (overrides?.value !== undefined) {
      txOptions.value = overrides.value;
    }
    if (overrides?.gas !== undefined) {
      txOptions.gasLimit = overrides.gas;
    }
    if (overrides?.gasPrice !== undefined) {
      txOptions.gasPrice = overrides.gasPrice;
    }
    if (overrides?.maxFeePerGas !== undefined) {
      txOptions.maxFeePerGas = overrides.maxFeePerGas;
    }
    if (overrides?.maxPriorityFeePerGas !== undefined) {
      txOptions.maxPriorityFeePerGas = overrides.maxPriorityFeePerGas;
    }
    if (overrides?.nonce !== undefined) {
      txOptions.nonce = overrides.nonce;
    }

    const tx = await fn(...(args || []), Object.keys(txOptions).length > 0 ? txOptions : undefined);
    if (!tx || typeof tx.wait !== 'function') {
      throw new Error('Transaction failed to be created');
    }
    const receipt = await tx.wait();

    // Parse events from the receipt
    const events: any[] = [];
    if (receipt && receipt.logs) {
      for (const log of receipt.logs) {
        try {
          const parsed = contract.interface.parseLog({
            topics: [...log.topics],
            data: log.data,
          });
          if (parsed) {
            events.push({
              name: parsed.name,
              args: parsed.args,
            });
          }
        } catch (error) {
          // Skip logs that don't match this contract's ABI
          // This is normal for logs from other contracts
        }
      }
    }

    return {
      hash: receipt.hash as Hex,
      blockNumber: BigInt(receipt.blockNumber),
      receipt,
      events,
      // Legacy support - also include txHash for backward compatibility
      txHash: receipt.hash,
    };
  }

  async encodeFunctionData(
    contractAddress: Address,
    abi: Abi,
    functionName: string,
    args?: readonly unknown[]
  ): Promise<Hex> {
    const contract = new Contract(contractAddress, abi as any);
    const iface = contract.interface;
    
    // Strip function signature if present
    const cleanFunctionName = functionName.includes('(')
      ? functionName.substring(0, functionName.indexOf('('))
      : functionName;
    
    const encoded = iface.encodeFunctionData(cleanFunctionName, args || []);
    return encoded as Hex;
  }

  async getAddress(): Promise<Address | null> {
    if (!this.signer) {
      return null;
    }
    return (await this.signer.getAddress()) as Address;
  }

  async getChainId(): Promise<number> {
    const network = await this.provider.getNetwork();
    return Number(network.chainId);
  }

  async signMessage(message: string | Uint8Array): Promise<Hex> {
    if (!this.signer) {
      throw new Error('Signer required for signing');
    }
    return (await this.signer.signMessage(message)) as Hex;
  }

  async signTypedData<TTypedData extends Record<string, unknown>>(
    domain: any,
    types: any,
    value: TTypedData
  ): Promise<Hex> {
    if (!this.signer) {
      throw new Error('Signer required for signing');
    }

    // Check if signer supports signTypedData (Wallet does, but not all signers)
    if ('signTypedData' in this.signer && typeof (this.signer as any).signTypedData === 'function') {
      return (await (this.signer as any).signTypedData(domain, types, value)) as Hex;
    }

    throw new Error('Signer does not support EIP-712 typed data signing');
  }
}