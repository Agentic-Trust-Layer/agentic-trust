/**
 * Base Identity Client using Ports & Adapters pattern
 * 
 * Uses AccountProvider (ReadClient + Signer + TxSender) instead of monolithic adapter
 * Supports prepareCalls for server-side preparation and client-side signing
 */

import type { AccountProvider, PreparedCall, TxRequest } from './types';
import type { Address } from 'viem';
import IdentityRegistryABI from '../abis/IdentityRegistry.json';
import type { MetadataEntry } from '../types';

export class BaseIdentityClient {
  protected accountProvider: AccountProvider;
  protected contractAddress: Address;

  constructor(accountProvider: AccountProvider, contractAddress: Address) {
    this.accountProvider = accountProvider;
    this.contractAddress = contractAddress;
  }

  /**
   * Prepare a register call (server-side, no signing)
   * Returns PreparedCall that can be serialized and sent to client
   */
  async prepareRegisterCall(tokenUri: string, metadata: MetadataEntry[] = []): Promise<PreparedCall> {
    // Format metadata
    const metadataFormatted = metadata.map(m => {
      const bytes = this.stringToBytes(m.value);
      const hexString = this.bytesToHex(bytes);
      return {
        // Updated ABI uses struct fields: { metadataKey, metadataValue }
        metadataKey: m.key,
        metadataValue: hexString as `0x${string}`,
      };
    });

    // Encode function data
    // Ensure ABI is loaded (handle potential bundling issues)
    const abi = IdentityRegistryABI || (await import('../abis/IdentityRegistry.json')).default;
    if (!abi || !Array.isArray(abi)) {
      throw new Error('IdentityRegistryABI is not loaded correctly. ABI must be an array.');
    }
    
    const data = await this.accountProvider.encodeFunctionData({
      abi: abi as any,
      functionName: 'register',
      args: [tokenUri, metadataFormatted],
    });

    const chainId = await this.accountProvider.chainId();

    return {
      chainId,
      description: `Register agent with URI: ${tokenUri}`,
      steps: [
        {
          to: this.contractAddress,
          data,
          value: 0n,
        },
      ],
    };
  }

  /**
   * Register agent (requires AccountProvider with TxSender)
   */
  async registerWithMetadata(
    tokenUri: string,
    metadata: MetadataEntry[] = []
  ): Promise<{ agentId: bigint; txHash: string }> {
    // Format metadata
    const metadataFormatted = metadata.map(m => {
      const bytes = this.stringToBytes(m.value);
      const hexString = this.bytesToHex(bytes);
      return {
        // Updated ABI uses struct fields: { metadataKey, metadataValue }
        metadataKey: m.key,
        metadataValue: hexString as `0x${string}`,
      };
    });

    // Encode function data
    // Ensure ABI is loaded (handle potential bundling issues)
    const abi = IdentityRegistryABI || (await import('../abis/IdentityRegistry.json')).default;
    if (!abi || !Array.isArray(abi)) {
      throw new Error('IdentityRegistryABI is not loaded correctly. ABI must be an array.');
    }
    
    const data = await this.accountProvider.encodeFunctionData({
      abi: abi as any,
      functionName: 'register',
      args: [tokenUri, metadataFormatted],
    });

    // Estimate gas and get nonce for better transaction preparation
    const fromAddress = await this.accountProvider.getAddress();
    let gasEstimate: bigint | undefined;
    let nonce: number | undefined;
    let maxFeePerGas: bigint | undefined;
    let maxPriorityFeePerGas: bigint | undefined;
    let gasPrice: bigint | undefined;

    try {
      // Get block to check for EIP-1559 support
      const block = await this.accountProvider.getBlock('latest');
      if (block && 'baseFeePerGas' in block && block.baseFeePerGas) {
        // EIP-1559
        maxPriorityFeePerGas = 1000000000n; // 1 gwei
        maxFeePerGas = (block.baseFeePerGas * 2n) + maxPriorityFeePerGas;
      } else {
        // Legacy
        gasPrice = await this.accountProvider.getGasPrice();
      }

      // Estimate gas
      gasEstimate = await this.accountProvider.estimateGas({
        to: this.contractAddress,
        data,
        value: 0n,
        account: fromAddress,
      });

      // Get nonce
      nonce = await this.accountProvider.getTransactionCount(fromAddress, 'pending');
    } catch (error) {
      console.warn('Could not estimate gas or get transaction parameters:', error);
      // Continue without estimates
    }

    // Prepare transaction request with gas estimates
    const txRequest: TxRequest = {
      to: this.contractAddress,
      data,
      value: 0n,
      gas: gasEstimate,
      nonce,
    };

    if (maxFeePerGas && maxPriorityFeePerGas) {
      txRequest.maxFeePerGas = maxFeePerGas;
      txRequest.maxPriorityFeePerGas = maxPriorityFeePerGas;
    } else if (gasPrice) {
      txRequest.gasPrice = gasPrice;
    }

    // Send transaction
    const result = await this.accountProvider.send(txRequest, {
      simulation: true,
    });

    // Extract agentId from receipt
    const agentId = this.extractAgentIdFromReceipt(result.receipt);

    return {
      agentId,
      txHash: result.hash,
    };
  }

  // Helper methods
  private stringToBytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
  }

  private bytesToHex(bytes: Uint8Array): string {
    return '0x' + Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private extractAgentIdFromReceipt(receipt: any): bigint {
    // Look for Registered event or Transfer event from zero address
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

    if (receipt?.logs && Array.isArray(receipt.logs)) {
      for (const log of receipt.logs) {
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
   * Set the token URI for an agent
   * Note: This is an implementation-specific extension (not in base spec).
   * Assumes implementation exposes setAgentUri with owner/operator checks.
   * @param agentId - The agent's ID
   * @param uri - New URI string
   */
  async setAgentUri(agentId: bigint, uri: string): Promise<{ txHash: string }> {
    // Ensure ABI is loaded (handle potential bundling issues)
    if (!IdentityRegistryABI || !Array.isArray(IdentityRegistryABI)) {
      throw new Error('IdentityRegistryABI is not loaded correctly. ABI must be an array.');
    }
    
    const data = await this.accountProvider.encodeFunctionData({
      abi: IdentityRegistryABI as any,
      // Updated ABI name is setAgentURI (capital URI)
      functionName: 'setAgentURI',
      args: [agentId, uri],
    });

    const txRequest: TxRequest = {
      to: this.contractAddress,
      data,
      value: 0n,
    };

    const result = await this.accountProvider.send(txRequest, {
      simulation: true,
    });

    return { txHash: result.hash };
  }

  /**
   * Set on-chain metadata for an agent
   * Spec: function setMetadata(uint256 agentId, string key, bytes value)
   * @param agentId - The agent's ID
   * @param key - Metadata key
   * @param value - Metadata value
   */
  async setMetadata(agentId: bigint, key: string, value: string): Promise<{ txHash: string }> {
    const bytes = this.stringToBytes(value);
    const hexString = this.bytesToHex(bytes);

    // Ensure ABI is loaded (handle potential bundling issues)
    if (!IdentityRegistryABI || !Array.isArray(IdentityRegistryABI)) {
      throw new Error('IdentityRegistryABI is not loaded correctly. ABI must be an array.');
    }

    const data = await this.accountProvider.encodeFunctionData({
      abi: IdentityRegistryABI as any,
      functionName: 'setMetadata',
      args: [agentId, key, hexString as `0x${string}`],
    });

    const txRequest: TxRequest = {
      to: this.contractAddress,
      data,
      value: 0n,
    };

    const result = await this.accountProvider.send(txRequest, {
      simulation: true,
    });

    return { txHash: result.hash };
  }

  /**
   * Get the owner of an agent
   * Spec: Standard ERC-721 ownerOf function
   * @param agentId - The agent's ID
   */
  async getOwner(agentId: bigint): Promise<string> {
    // Ensure ABI is loaded (handle potential bundling issues)
    if (!IdentityRegistryABI || !Array.isArray(IdentityRegistryABI)) {
      throw new Error('IdentityRegistryABI is not loaded correctly. ABI must be an array.');
    }

    return await this.accountProvider.call<string>({
      to: this.contractAddress,
      abi: IdentityRegistryABI as any,
      functionName: 'ownerOf',
      args: [agentId],
    });
  }

  /**
   * Get the token URI for an agent
   * Spec: Standard ERC-721 tokenURI function
   * @param agentId - The agent's ID
   */
  async getTokenURI(agentId: bigint): Promise<string> {
    // Ensure ABI is loaded (handle potential bundling issues)
    if (!IdentityRegistryABI || !Array.isArray(IdentityRegistryABI)) {
      throw new Error('IdentityRegistryABI is not loaded correctly. ABI must be an array.');
    }

    return await this.accountProvider.call<string>({
      to: this.contractAddress,
      abi: IdentityRegistryABI as any,
      functionName: 'tokenURI',
      args: [agentId],
    });
  }
}

