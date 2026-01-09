/**
 * Reputation Client for ERC-8004
 * Handles feedback submission and reputation queries
 */

import { BlockchainAdapter } from './adapters/types';
import { FeedbackAuth } from './types';
import ReputationRegistryABI from './abis/ReputationRegistry.json';
import { ethers } from 'ethers';

export interface GiveFeedbackParams {
  agentId: bigint;
  score: number; // MUST be 0-100
  // Updated ABI uses string tags
  tag1?: string; // OPTIONAL (string)
  tag2?: string; // OPTIONAL (string)
  // Updated ABI includes endpoint + feedbackURI + feedbackHash
  endpoint?: string; // OPTIONAL (string)
  feedbackUri?: string; // OPTIONAL (string)
  feedbackHash?: string; // OPTIONAL (bytes32, keccak256 of feedback content)
  // Deprecated (no longer used by updated on-chain ABI)
  feedbackAuth?: string;
}

import type { Address } from 'viem';

export class ReputationClient {
  private adapter: BlockchainAdapter;
  private contractAddress: Address;
  private identityRegistryAddress: Address;

  constructor(
    adapter: BlockchainAdapter,
    contractAddress: string | Address,
    identityRegistryAddress: string | Address
  ) {
    this.adapter = adapter;
    this.contractAddress = contractAddress as Address;
    this.identityRegistryAddress = identityRegistryAddress as Address;
  }

  /**
   * Create a feedbackAuth structure to be signed
   * Spec: tuple (agentId, clientAddress, indexLimit, expiry, chainId, identityRegistry, signerAddress)
   *
   * @param agentId - The agent ID
   * @param clientAddress - Address authorized to give feedback
   * @param indexLimit - Must be > last feedback index from this client (typically lastIndex + 1)
   * @param expiry - Unix timestamp when authorization expires
   * @param chainId - Chain ID where feedback will be submitted
   * @param signerAddress - Address of the signer (agent owner/operator)
   */
  createFeedbackAuth(
    agentId: bigint,
    clientAddress: string,
    indexLimit: bigint,
    expiry: bigint,
    chainId: bigint,
    signerAddress: string
  ): FeedbackAuth {
    return {
      agentId,
      clientAddress,
      indexLimit,
      expiry,
      chainId,
      identityRegistry: this.identityRegistryAddress,
      signerAddress,
    };
  }

  /**
   * Sign a feedbackAuth using EIP-191
   * The agent owner/operator signs to authorize a client to give feedback
   *
   * @param auth - The feedbackAuth structure
   * @returns Signed authorization as bytes (encoded tuple + signature)
   */
  async signFeedbackAuth(auth: FeedbackAuth): Promise<string> {
    // Encode the feedbackAuth tuple
    // Spec: (agentId, clientAddress, indexLimit, expiry, chainId, identityRegistry, signerAddress)
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'uint256', 'uint256', 'uint256', 'address', 'address'],
      [
        auth.agentId,
        auth.clientAddress,
        auth.indexLimit,
        auth.expiry,
        auth.chainId,
        auth.identityRegistry,
        auth.signerAddress,
      ]
    );

    // Hash the encoded data
    const messageHash = ethers.keccak256(encoded);

    // Sign using EIP-191 (personal_sign)
    // This prefixes the message with "\x19Ethereum Signed Message:\n32"
    const signature = await this.adapter.signMessage(ethers.getBytes(messageHash));

    // Return encoded tuple + signature concatenated
    // Contract will decode the tuple and verify the signature
    return ethers.concat([encoded, signature]);
  }

  /**
   * Submit feedback for an agent
   * Updated ABI:
   *   giveFeedback(uint256 agentId, uint8 score, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)
   *
   * @param params - Feedback parameters (score is MUST, others are OPTIONAL)
   * @returns Transaction result
   */
  async giveFeedback(params: GiveFeedbackParams): Promise<{ txHash: string }> {
    // Validate score is 0-100 (MUST per spec)
    if (params.score < 0 || params.score > 100) {
      throw new Error('Score MUST be between 0 and 100');
    }

    const tag1 = params.tag1 || '';
    const tag2 = params.tag2 || '';
    const endpoint = params.endpoint || '';
    const feedbackHash = params.feedbackHash || ethers.ZeroHash;
    const feedbackUri = params.feedbackUri || '';

    const result = await this.adapter.send(
      this.contractAddress,
      ReputationRegistryABI as any,
      'giveFeedback',
      [
        params.agentId,
        params.score,
        tag1,
        tag2,
        endpoint,
        feedbackUri,
        feedbackHash,
      ]
    );

    return { txHash: result.hash || (result as any).txHash };
  }

  /**
   * Revoke previously submitted feedback
   * Spec: function revokeFeedback(uint256 agentId, uint64 feedbackIndex)
   *
   * @param agentId - The agent ID
   * @param feedbackIndex - Index of feedback to revoke
   */
  async revokeFeedback(agentId: bigint, feedbackIndex: bigint): Promise<{ txHash: string }> {
    const result = await this.adapter.send(
      this.contractAddress,
      ReputationRegistryABI as any,
      'revokeFeedback',
      [agentId, feedbackIndex]
    );

    return { txHash: result.hash || (result as any).txHash };
  }

  /**
   * Append a response to existing feedback
   * Spec: function appendResponse(uint256 agentId, address clientAddress, uint64 feedbackIndex, string calldata responseUri, bytes32 calldata responseHash)
   *
   * @param agentId - The agent ID
   * @param clientAddress - Client who gave the feedback
   * @param feedbackIndex - Index of the feedback
   * @param responseUri - URI to response content
   * @param responseHash - OPTIONAL hash of response content (KECCAK-256)
   */
  async appendResponse(
    agentId: bigint,
    clientAddress: string,
    feedbackIndex: bigint,
    responseUri: string,
    responseHash?: string
  ): Promise<{ txHash: string }> {
    const hash = responseHash || ethers.ZeroHash;

    const result = await this.adapter.send(
      this.contractAddress,
      ReputationRegistryABI as any,
      'appendResponse',
      [agentId, clientAddress, feedbackIndex, responseUri, hash]
    );

    return { txHash: result.hash || (result as any).txHash };
  }

  /**
   * Get the identity registry address
   * Spec: function getIdentityRegistry() external view returns (address identityRegistry)
   */
  async getIdentityRegistry(): Promise<string> {
    return await this.adapter.call(
      this.contractAddress,
      ReputationRegistryABI as any,
      'getIdentityRegistry',
      []
    );
  }

  /**
   * Get reputation summary for an agent
   * Updated ABI: getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2)
   * Note: agentId is ONLY mandatory parameter, others are OPTIONAL filters
   *
   * @param agentId - The agent ID (MANDATORY)
   * @param clientAddresses - OPTIONAL filter by specific clients
   * @param tag1 - OPTIONAL filter by tag1
   * @param tag2 - OPTIONAL filter by tag2
   */
  async getSummary(
    agentId: bigint,
    clientAddresses?: string[],
    tag1?: string,
    tag2?: string
  ): Promise<{ count: bigint; averageScore: number }> {
    const clients = clientAddresses || [];
    const t1 = tag1 || '';
    const t2 = tag2 || '';

    // Some deployed ReputationRegistry implementations revert on edge cases
    // (e.g. empty clientAddresses / empty tags). Treat that as "no summary available"
    // instead of failing the entire API response.
    let result: any;
    try {
      result = await this.adapter.call<any>(
        this.contractAddress,
        ReputationRegistryABI as any,
        'getSummary',
        [agentId, clients, t1, t2] as any
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[ReputationClient.getSummary] getSummary reverted; returning default summary', {
        agentId: agentId.toString(),
        clientCount: clients.length,
        tag1: t1,
        tag2: t2,
        error: error instanceof Error ? error.message : String(error),
      });
      return { count: 0n, averageScore: 0 };
    }

    return {
      count: BigInt(result.count || result[0]),
      averageScore: Number(result.averageScore || result[1]),
    };
  }

  /**
   * Read a specific feedback entry
   * Updated ABI: readFeedback(...) returns (uint8 score, string tag1, string tag2, bool isRevoked)
   *
   * @param agentId - The agent ID
   * @param clientAddress - Client who gave feedback
   * @param index - Feedback index
   */
  async readFeedback(
    agentId: bigint,
    clientAddress: string,
    index: bigint
  ): Promise<{ score: number; tag1: string; tag2: string; isRevoked: boolean }> {
    const result = await this.adapter.call<any>(
      this.contractAddress,
      ReputationRegistryABI as any,
      'readFeedback',
      [agentId, clientAddress, index] as any
    );

    return {
      score: Number(result.score || result[0]),
      tag1: String(result.tag1 || result[1] || ''),
      tag2: String(result.tag2 || result[2] || ''),
      isRevoked: Boolean(result.isRevoked || result[3]),
    };
  }

  /**
   * Read all feedback for an agent with optional filters
   * Updated ABI:
   *   readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked)
   *   returns (address[] clients, uint64[] feedbackIndexes, uint8[] scores, string[] tag1s, string[] tag2s, bool[] revokedStatuses)
   * Note: agentId is ONLY mandatory parameter
   *
   * @param agentId - The agent ID (MANDATORY)
   * @param clientAddresses - OPTIONAL filter by clients
   * @param tag1 - OPTIONAL filter by tag1
   * @param tag2 - OPTIONAL filter by tag2
   * @param includeRevoked - OPTIONAL include revoked feedback
   */
  async readAllFeedback(
    agentId: bigint,
    clientAddresses?: string[],
    tag1?: string,
    tag2?: string,
    includeRevoked?: boolean
  ): Promise<{
    clientAddresses: string[];
    indexes: bigint[];
    scores: number[];
    tag1s: string[];
    tag2s: string[];
    revokedStatuses: boolean[];
  }> {
    const clients = clientAddresses || [];
    const t1 = tag1 || '';
    const t2 = tag2 || '';
    const includeRev = includeRevoked || false;

    const result = await this.adapter.call<any>(
      this.contractAddress,
      ReputationRegistryABI as any,
      'readAllFeedback',
      [agentId, clients, t1, t2, includeRev] as any
    );

    return {
      clientAddresses: (result.clients || result[0]) as string[],
      indexes: ((result.feedbackIndexes || result[1]) as any[]).map((i: any) => BigInt(i)),
      scores: ((result.scores || result[2]) as any[]).map((s: any) => Number(s)),
      tag1s: ((result.tag1s || result[3]) as any[]).map((t: any) => String(t ?? '')),
      tag2s: ((result.tag2s || result[4]) as any[]).map((t: any) => String(t ?? '')),
      revokedStatuses: ((result.revokedStatuses || result[5]) as any[]).map((b: any) => Boolean(b)),
    };
  }

  /**
   * Get response count for a feedback entry
   * Spec: function getResponseCount(uint256 agentId, address clientAddress, uint64 feedbackIndex, address[] responders) returns (uint64)
   * Note: agentId is ONLY mandatory parameter
   */
  async getResponseCount(
    agentId: bigint,
    clientAddress?: string,
    feedbackIndex?: bigint,
    responders?: string[]
  ): Promise<bigint> {
    const client = clientAddress || ethers.ZeroAddress;
    const index = feedbackIndex || BigInt(0);
    const resp = responders || [];

    const result = await this.adapter.call<any>(
      this.contractAddress,
      ReputationRegistryABI as any,
      'getResponseCount',
      [agentId, client, index, resp] as any
    );

    return BigInt(result);
  }

  /**
   * Get all clients who have given feedback to an agent
   * Spec: function getClients(uint256 agentId) returns (address[] memory)
   */
  async getClients(agentId: bigint): Promise<string[]> {
    return await this.adapter.call(
      this.contractAddress,
      ReputationRegistryABI as any,
      'getClients',
      [agentId] as any
    );
  }

  /**
   * Get the last feedback index from a client for an agent
   * Spec: function getLastIndex(uint256 agentId, address clientAddress) returns (uint64)
   *
   * @param agentId - The agent ID
   * @param clientAddress - Client address
   * @returns Last feedback index (0 if no feedback yet)
   */
  async getLastIndex(agentId: bigint, clientAddress: string): Promise<bigint> {
    const result = await this.adapter.call<any>(
      this.contractAddress,
      ReputationRegistryABI as any,
      'getLastIndex',
      [agentId, clientAddress] as any
    );

    return BigInt(result);
  }
}