/**
 * Reputation API
 * 
 * Manages the AIAgentReputationClient instance
 */

import type { AIAgentReputationClient } from '@erc8004/agentic-trust-sdk';
import { ViemAdapter } from '@erc8004/sdk';
import type { Account } from 'viem/accounts';
import { createFeedbackAuth } from './agentFeedback';

export class ReputationAPI {
  private reputationClient: AIAgentReputationClient | null = null;
  private sessionPackagePath: string | null = null;
  private agentId: bigint | null = null;

  /**
   * Get the reputation client instance
   * Throws if client has not been initialized
   */
  getClient(): AIAgentReputationClient {
    if (!this.reputationClient) {
      throw new Error(
        'Reputation client not initialized. Provide reputation configuration in ApiClientConfig.'
      );
    }
    return this.reputationClient;
  }

  /**
   * Check if reputation client is initialized
   */
  isInitialized(): boolean {
    return this.reputationClient !== null;
  }

  /**
   * Initialize the reputation client
   * @internal
   */
  async initialize(config: {
    publicClient: any;
    walletClient: any;
    clientAccount: `0x${string}` | Account; // Can be address string or Account object
    agentAccount: `0x${string}` | Account; // Can be address string or Account object
    identityRegistry: `0x${string}`; // Required - must be provided in reputation config or top-level config
    reputationRegistry: `0x${string}`;
    ensRegistry: `0x${string}`;
    sessionPackagePath?: string; // Optional - for feedback auth creation
    agentId?: bigint; // Optional - for feedback auth creation
  }): Promise<void> {
    const { AIAgentReputationClient } = await import('@erc8004/agentic-trust-sdk');

    // Store session package info for feedback auth creation
    if (config.sessionPackagePath) {
      this.sessionPackagePath = config.sessionPackagePath;
    }
    if (config.agentId) {
      this.agentId = config.agentId;
    }

    // Create adapters for client and agent using ViemAdapter
    // Pass Account object if available, otherwise use address string
    // ViemAdapter will use the Account for signing if provided
    const clientAdapter = new ViemAdapter(
      config.publicClient,
      config.walletClient,
      config.clientAccount
    );

    const agentAdapter = new ViemAdapter(
      config.publicClient,
      config.walletClient,
      config.agentAccount
    );

    // Create the reputation client
    this.reputationClient = await AIAgentReputationClient.create(
      agentAdapter as any,
      clientAdapter as any,
      config.identityRegistry,
      config.reputationRegistry,
      config.ensRegistry
    );
  }

  /**
   * Request feedback authentication signature
   * Handles all session package loading, delegation setup, and agent account creation
   * @param params - Feedback auth parameters
   * @returns Object with signature, agentId, clientAddress, and skill
   * @throws Error if reputation client is not initialized or session package is not configured
   */
  async requestFeedbackAuth(params: {
    clientAddress: `0x${string}`;
    agentId?: bigint | string;
    skillId?: string;
    expirySeconds?: number;
  }): Promise<{ 
    signature: `0x${string}`; 
    agentId: string;
    clientAddress: `0x${string}`;
    skill: string;
  }> {
    if (!this.isInitialized()) {
      throw new Error(
        'Reputation client not initialized. Provide reputation configuration in ApiClientConfig.'
      );
    }

    // Get session package path from environment or config
    const sessionPackagePath = this.sessionPackagePath || process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
    
    if (!sessionPackagePath) {
      throw new Error(
        'Session package path not configured. Set AGENTIC_TRUST_SESSION_PACKAGE_PATH environment variable or provide sessionPackagePath in reputation config.'
      );
    }

    // Load session package and build delegation setup
    const { loadSessionPackage, buildDelegationSetup, buildAgentAccountFromSession } = await import('./sessionPackage');
    const sessionPackage = loadSessionPackage(sessionPackagePath);
    const delegationSetup = buildDelegationSetup(sessionPackage);
    
    // Get agent account from session package
    const agentAccount = await buildAgentAccountFromSession(sessionPackage);
    
    // Create wallet client for signing
    const { createWalletClient, http: httpTransport } = await import('viem');
    const walletClient = createWalletClient({
      account: agentAccount,
      chain: delegationSetup.chain,
      transport: httpTransport(delegationSetup.rpcUrl),
    });
    
    // Use agentId from params, stored agentId, or session package
    const agentId = params.agentId 
      ? BigInt(params.agentId)
      : (this.agentId || BigInt(sessionPackage.agentId));
    
    
    // Get reputation client
    const reputationClient = this.getClient();
    
    // Create feedback auth
    const signature = await createFeedbackAuth(
      {
        publicClient: delegationSetup.publicClient,
        agentId,
        clientAddress: params.clientAddress,
        signer: agentAccount,
        walletClient: walletClient as any,
        expirySeconds: params.expirySeconds
      },
      reputationClient
    );
    
    // Store agentId for future use if not already stored
    if (!this.agentId) {
      this.agentId = agentId;
    }
    
    return {
      signature,
      agentId: agentId.toString(),
      clientAddress: params.clientAddress,
      skill: params.skillId || 'agent.feedback.requestAuth',
    };
  }

  /**
   * Disconnect the reputation client
   */
  disconnect(): void {
    this.reputationClient = null;
  }
}

