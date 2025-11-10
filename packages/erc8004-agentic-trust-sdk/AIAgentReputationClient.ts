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

export class AIAgentReputationClient extends BaseReputationClient {
  private chain: Chain;
  private agentAccountProvider: AccountProvider;
  private clientAccountProvider: AccountProvider;
  private ensRegistryAddress: `0x${string}`;
  private reputationAddress: `0x${string}`;
  private publicClient: PublicClient | null = null;

  constructor(
    agentAccountProvider: AccountProvider,
    clientAccountProvider: AccountProvider,
    registrationRegistryAddress: `0x${string}`,
    identityRegistryAddress: `0x${string}`,
    ensRegistryAddress: `0x${string}`
  ) {
    // For now, we still need to pass a BlockchainAdapter to BaseReputationClient
    // TODO: Update BaseReputationClient to use AccountProvider
    // We'll create a minimal adapter wrapper for compatibility
    const minimalAdapter = {
      call: async (to: string, abi: any, functionName: string, args?: any[]) => {
        return agentAccountProvider.call({ to: to as `0x${string}`, abi, functionName, args });
      },
      send: async (to: string, abi: any, functionName: string, args?: any[]) => {
        const data = await agentAccountProvider.encodeFunctionData({ abi, functionName, args: args || [] });
        const tx: TxRequest = { to: to as `0x${string}`, data };
        const result = await agentAccountProvider.send(tx);
        return { hash: result.hash, txHash: result.hash };
      },
      signMessage: async (message: Uint8Array | string) => {
        return agentAccountProvider.signMessage(message);
      },
    };
    
    super(minimalAdapter as any, registrationRegistryAddress, identityRegistryAddress);

    this.chain = sepolia;
    this.agentAccountProvider = agentAccountProvider;
    this.clientAccountProvider = clientAccountProvider;
    this.reputationAddress = registrationRegistryAddress;
    this.ensRegistryAddress = ensRegistryAddress;

    // Try to extract publicClient from AccountProvider if it's a ViemAccountProvider
    const viemProvider = agentAccountProvider as any;
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
    agentAccountProvider: AccountProvider,
    clientAccountProvider: AccountProvider,
    identityRegistryAddress: `0x${string}`,
    registrationRegistryAddress: `0x${string}`,
    ensRegistryAddress: `0x${string}`
  ): Promise<AIAgentReputationClient> {
    return new AIAgentReputationClient(
      agentAccountProvider,
      clientAccountProvider,
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
    const tag1 = params.tag1 ? ethers.id(params.tag1).slice(0, 66) : ethers.ZeroHash;
    const tag2 = params.tag2 ? ethers.id(params.tag2).slice(0, 66) : ethers.ZeroHash;
    const feedbackHash = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
    const feedbackUri = params.feedbackUri || '';

    console.info("params.feedbackAuth", JSON.stringify(params.feedbackAuth, null, 2));
    console.info("this.reputationAddress", this.reputationAddress);
    console.info("agentId", params.agentId);
    console.info("score", params.score);
    console.info("tag1", tag1);
    console.info("tag2", tag2);
    console.info("feedbackUri", feedbackUri);
    console.info("feedbackHash", feedbackHash);

    // Encode function data using AccountProvider
    const data = await this.clientAccountProvider.encodeFunctionData({
      abi: ReputationRegistryABI as any,
      functionName: 'giveFeedback',
      args: [
        params.agentId,
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
      data,
      value: 0n,
    };

    const result = await this.clientAccountProvider.send(tx, {
      simulation: true,
    });

    return { txHash: result.hash };
  }
}