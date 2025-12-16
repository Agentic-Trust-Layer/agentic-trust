/**
 * Agentic Trust SDK - Validation Client
 * Extends the base ERC-8004 ValidationClient with AccountProvider support.
 * Uses AccountProvider (Ports & Adapters pattern) for chain I/O.
 */

import { sepolia } from 'viem/chains';
import type { Chain } from 'viem';
import { keccak256, stringToHex } from 'viem';
import {
  ValidationClient as BaseValidationClient,
  type ValidationStatus,
  AccountProvider,
  type TxRequest,
} from '@agentic-trust/8004-sdk';
import ValidationRegistryABI from './abis/ValidationRegistry.json';

// Local copies of request/response types to avoid tight coupling to 8004-sdk exports
export interface ValidationRequestParams {
  validatorAddress: string;
  agentId: bigint;
  requestUri: string;
  requestHash: string;
}

export interface ValidationResponseParams {
  requestHash: string;
  response: number;
  responseUri?: string;
  responseHash?: string;
  tag?: string;
}

export class AIAgentValidationClient extends BaseValidationClient {
  private chain: Chain;
  private accountProvider: AccountProvider;
  private validationRegistryAddress: `0x${string}`;

  constructor(accountProvider: AccountProvider, validationRegistryAddress: `0x${string}`) {
    // Minimal adapter wrapper using AccountProvider for BaseValidationClient compatibility
    const minimalAdapter = {
      call: async (to: string, abi: any, functionName: string, args?: any[]) => {
        return accountProvider?.call({ to: to as `0x${string}`, abi, functionName, args });
      },
      send: async (to: string, abi: any, functionName: string, args?: any[]) => {
        const data = await accountProvider?.encodeFunctionData({
          abi,
          functionName,
          args: args || [],
        });
        if (data) {
          const tx: TxRequest = { to: to as `0x${string}`, data };
          const result = await accountProvider?.send(tx);
          return { hash: result?.hash, txHash: result?.hash };
        }
        return { hash: undefined, txHash: undefined };
      },
    };

    super(minimalAdapter as any, validationRegistryAddress);

    this.chain = sepolia;
    this.accountProvider = accountProvider;
    this.validationRegistryAddress = validationRegistryAddress;
  }

  // Factory helper to mirror AIAgentReputationClient.create-style API
  static async create(
    accountProvider: AccountProvider,
    validationRegistryAddress: `0x${string}`,
  ): Promise<AIAgentValidationClient> {
    return new AIAgentValidationClient(accountProvider, validationRegistryAddress);
  }

  // Re-expose base-class methods for TypeScript consumers
  getIdentityRegistry(): Promise<string> {
    return (BaseValidationClient.prototype as any).getIdentityRegistry.call(this);
  }

  getAgentValidations(agentId: bigint): Promise<string[]> {
    return (BaseValidationClient.prototype as any).getAgentValidations.call(this, agentId);
  }

  getValidatorRequests(validatorAddress: string): Promise<string[]> {
    return (BaseValidationClient.prototype as any).getValidatorRequests.call(
      this,
      validatorAddress,
    );
  }

  getValidationStatus(requestHash: string): Promise<ValidationStatus> {
    return (BaseValidationClient.prototype as any).getValidationStatus.call(this, requestHash);
  }

  getSummary(
    agentId: bigint,
    validatorAddresses?: string[],
    tag?: string,
  ): Promise<{ count: bigint; avgResponse: number }> {
    return (BaseValidationClient.prototype as any).getSummary.call(
      this,
      agentId,
      validatorAddresses,
      tag,
    );
  }

  validationRequest(
    params: ValidationRequestParams,
  ): Promise<{ txHash: string; requestHash: string }> {
    return (BaseValidationClient.prototype as any).validationRequest.call(this, params);
  }

  validationResponse(params: ValidationResponseParams): Promise<{ txHash: string }> {
    return (BaseValidationClient.prototype as any).validationResponse.call(this, params);
  }

  /**
   * Prepare the validationRequest transaction data without sending it.
   * Requires the validator account address to be provided (computed server-side).
   */
  async prepareValidationRequestTx(params: {
    agentId: string | number | bigint;
    validatorAddress: `0x${string}`;
    requestUri?: string;
    requestHash?: string;
  }): Promise<{ txRequest: TxRequest; requestHash: string }> {
    if (!params.agentId) {
      throw new Error('agentId requesting validation is required');
    }
    if (!params.validatorAddress) {
      throw new Error('validatorAddress that performs the validation is required');
    }

    // Prepare validation request parameters
    const agentIdBigInt = typeof params.agentId === 'bigint' 
      ? params.agentId 
      : BigInt(params.agentId.toString());
    const finalRequestUri = params.requestUri || `https://agentic-trust.org/validation/${params.agentId}`;
    const finalRequestHash = params.requestHash || (keccak256(stringToHex(finalRequestUri)) as `0x${string}`);

    // Encode the validation request call
    const data = await this.accountProvider?.encodeFunctionData({
      abi: ValidationRegistryABI as any,
      functionName: 'validationRequest',
      args: [params.validatorAddress, agentIdBigInt, finalRequestUri, finalRequestHash],
    });

    return {
      txRequest: {
        to: this.validationRegistryAddress,
        data: data || '0x',
        value: 0n,
      },
      requestHash: finalRequestHash,
    };
  }

  /**
   * Prepare the validationResponse transaction data without sending it.
   * This encodes the transaction that can be sent via a bundler using account abstraction.
   */
  async prepareValidationResponseTx(params: ValidationResponseParams): Promise<TxRequest> {
    if (params.response < 0 || params.response > 100) {
      throw new Error('Response MUST be between 0 and 100');
    }

    // Convert optional parameters to proper format (matching BaseValidationClient logic)
    const { ethers } = await import('ethers');
    const responseUri = params.responseUri || '';
    const responseHash = params.responseHash || ethers.ZeroHash;
    const tag = params.tag ? ethers.id(params.tag).slice(0, 66) : ethers.ZeroHash;

    // Encode the validation response call
    const data = await this.accountProvider?.encodeFunctionData({
      abi: ValidationRegistryABI as any,
      functionName: 'validationResponse',
      args: [params.requestHash, params.response, responseUri, responseHash, tag],
    });

    return {
      to: this.validationRegistryAddress,
      data: data || '0x',
      value: 0n,
    };
  }
}


