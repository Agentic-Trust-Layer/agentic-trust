/**
 * Agentic Trust SDK - Reputation Client
 * Extends the base ERC-8004 ReputationClient with AccountProvider support.
 * Uses AccountProvider (Ports & Adapters pattern) for chain I/O.
 */
import { createPublicClient, http, namehash, labelhash, encodeFunctionData, hexToString, type Chain, type PublicClient } from 'viem';
import { ethers } from 'ethers';
import { sepolia } from 'viem/chains';

import { 
  ReputationClient as BaseReputationClient,
  AccountProvider,
  type TxRequest,
} from '@agentic-trust/8004-sdk';
import ReputationRegistryABI from './abis/ReputationRegistry.json';
import type { MetadataEntry } from '@agentic-trust/8004-sdk';

// Define GiveFeedbackParams locally since it's not exported from the base SDK
export interface GiveFeedbackParams {
  agent: string;
  score: number;
  feedback: string;
  metadata?: MetadataEntry[];
  tag1?: string;
  tag2?: string;
  feedbackHash?: string;
  feedbackUri?: string;
  agentId?: string;
  feedbackAuth?: string;
}

export interface AppendToFeedbackParams {
  agentId: string | number | bigint;
  clientAddress: `0x${string}`;
  feedbackIndex: string | number | bigint;
  responseUri?: string;
  responseHash?: `0x${string}`;
}

export class AIAgentReputationClient extends BaseReputationClient {
  private chain: Chain;
  private accountProvider: AccountProvider;
  private ensRegistryAddress: `0x${string}`;
  private reputationAddress: `0x${string}`;
  private publicClient: PublicClient | null = null;

  constructor(
    accountProvider: AccountProvider,
    registrationRegistryAddress: `0x${string}`,
    identityRegistryAddress: `0x${string}`,
    ensRegistryAddress: `0x${string}`
  ) {
    // For now, we still need to pass a BlockchainAdapter to BaseReputationClient
    // TODO: Update BaseReputationClient to use AccountProvider
    // We'll create a minimal adapter wrapper for compatibility
    const minimalAdapter = {
      call: async (to: string, abi: any, functionName: string, args?: any[]) => {
        return accountProvider?.call({ to: to as `0x${string}`, abi, functionName, args });
      },
      send: async (to: string, abi: any, functionName: string, args?: any[]) => {
        const data = await accountProvider?.encodeFunctionData({ abi, functionName, args: args || [] });
        if (data) {
          const tx: TxRequest = { to: to as `0x${string}`, data };
          const result = await accountProvider?.send(tx);
          return { hash: result?.hash, txHash: result?.hash };
        }
        return { hash: undefined, txHash: undefined };
      },

      signMessage: async (message: Uint8Array | string) => {
        return accountProvider?.signMessage(message);
      },
    };
    
    super(minimalAdapter as any, registrationRegistryAddress, identityRegistryAddress);

    this.chain = sepolia;
    this.accountProvider = accountProvider as AccountProvider;
    this.reputationAddress = registrationRegistryAddress;
    this.ensRegistryAddress = ensRegistryAddress;

    // Try to extract publicClient from AccountProvider if it's a ViemAccountProvider
    const viemProvider = accountProvider as any;
    if (viemProvider.publicClient) {
      this.publicClient = viemProvider.publicClient;
    }
  }

  // Expose base-class methods so TypeScript recognizes them on this subclass
  getIdentityRegistry(): Promise<string> {
    return (BaseReputationClient.prototype as any).getIdentityRegistry.call(this);
  }
  getLastIndex(agentId: bigint, clientAddress: string): Promise<bigint> {
    return (BaseReputationClient.prototype as any).getLastIndex.call(this, agentId, clientAddress);
  }
  createFeedbackAuth(
    agentId: bigint,
    clientAddress: string,
    indexLimit: bigint,
    expiry: bigint,
    chainId: bigint,
    signerAddress: string
  ): any {

    console.info("----------> createFeedbackAuth", agentId, clientAddress, indexLimit, expiry, chainId, signerAddress);
    return (BaseReputationClient.prototype as any).createFeedbackAuth.call(
      this,
      agentId,
      clientAddress,
      indexLimit,
      expiry,
      chainId,
      signerAddress
    );
  }
  signFeedbackAuth(auth: any): Promise<string> {
    return (BaseReputationClient.prototype as any).signFeedbackAuth.call(this, auth);
  }

  // Factory: resolve identityRegistry from reputation/registration registry before constructing
  static async create(
    accountProvider: AccountProvider,
    identityRegistryAddress: `0x${string}`,
    registrationRegistryAddress: `0x${string}`,
    ensRegistryAddress: `0x${string}`
  ): Promise<AIAgentReputationClient> {
    return new AIAgentReputationClient(
      accountProvider,
      registrationRegistryAddress,
      identityRegistryAddress,
      ensRegistryAddress
    );
  }


  /**
   * Submit feedback for an agent
   * Spec: function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string calldata feedbackUri, bytes32 calldata feedbackHash, bytes memory feedbackAuth)
   *
   * @param params - Feedback parameters (score is MUST, others are OPTIONAL)
   * @returns Transaction result
   */
  async giveClientFeedback(params: GiveFeedbackParams): Promise<{ txHash: string }> {
    // Validate score is 0-100 (MUST per spec)
    if (params.score < 0 || params.score > 100) {
      throw new Error('Score MUST be between 0 and 100');
    }

    // Convert optional string parameters to bytes32 (or empty bytes32 if not provided)
    // Use ethers.id() to hash strings to bytes32 (keccak256), matching base ReputationClient behavior
    const tag1 = params.tag1 ? (ethers.id(params.tag1).slice(0, 66) as `0x${string}`) : (ethers.ZeroHash as `0x${string}`);
    const tag2 = params.tag2 ? (ethers.id(params.tag2).slice(0, 66) as `0x${string}`) : (ethers.ZeroHash as `0x${string}`);
    const feedbackHash = params.feedbackHash || (ethers.ZeroHash as `0x${string}`);
    const feedbackUri = params.feedbackUri || '';

    // Convert agentId to bigint (contract expects uint256)
    if (!params.agentId) {
      throw new Error('agentId is required');
    }
    const agentId = BigInt(params.agentId);

    console.info("params.feedbackAuth", JSON.stringify(params.feedbackAuth, null, 2));
    console.info("this.reputationAddress", this.reputationAddress);
    console.info("agentId", agentId.toString());
    console.info("score", params.score);
    console.info("tag1", tag1);
    console.info("tag2", tag2);
    console.info("feedbackUri", feedbackUri);
    console.info("feedbackHash", feedbackHash);

    // Encode function data using AccountProvider
    const data = await this.accountProvider?.encodeFunctionData({
      abi: ReputationRegistryABI as any,
      functionName: 'giveFeedback',
      args: [
        agentId,
        params.score,
        tag1,
        tag2,
        feedbackUri,
        feedbackHash,
        params.feedbackAuth,
      ],
    });

    // Send transaction using AccountProvider
    const tx: TxRequest = {
      to: this.reputationAddress,
      data: data || '0x',
      value: 0n,
    };

    const result = await this.accountProvider?.send(tx, {
      simulation: true,
    });

    return { txHash: result?.hash || '' };
  }

  /**
   * Append a response to an existing feedback entry for an agent.
   *
   * Wraps the ReputationRegistry `appendResponse(agentId, clientAddress, feedbackIndex, responseUri, responseHash)`
   * function using the same AccountProvider / ClientApp wiring as giveClientFeedback.
   */
  async appendToFeedback(params: AppendToFeedbackParams): Promise<{ txHash: string }> {
    const agentId = BigInt(params.agentId);
    const feedbackIndex = BigInt(params.feedbackIndex);
    const responseUri = params.responseUri || '';
    const responseHash =
      params.responseHash && params.responseHash.length === 66
        ? params.responseHash
        : (ethers.ZeroHash as `0x${string}`);

    const data = await this.accountProvider?.encodeFunctionData({
      abi: ReputationRegistryABI as any,
      functionName: 'appendResponse',
      args: [agentId, params.clientAddress, feedbackIndex, responseUri, responseHash],
    });

    const tx: TxRequest = {
      to: this.reputationAddress,
      data: data || '0x',
      value: 0n,
    };

    const result = await this.accountProvider?.send(tx, {
      simulation: true,
    });

    return { txHash: result?.hash || '' };
  }

  /**
   * Revoke a previously submitted feedback entry for an agent.
   *
   * This wraps the ReputationRegistry `revokeFeedback(uint256 tokenId, uint256 feedbackIndex)`
   * function using the same AccountProvider / ClientApp wiring as giveClientFeedback.
   */
  async revokeFeedback(
    agentId: bigint,
    feedbackIndex: bigint,
  ): Promise<{ txHash: string }> {
    const data = await this.accountProvider?.encodeFunctionData({
      abi: ReputationRegistryABI as any,
      functionName: 'revokeFeedback',
      args: [agentId, feedbackIndex],
    });

    const tx: TxRequest = {
      to: this.reputationAddress,
      data: data || '0x',
      value: 0n,
    };

    const result = await this.accountProvider?.send(tx, {
      simulation: true,
    });

    return { txHash: result?.hash || '' };
  }
}