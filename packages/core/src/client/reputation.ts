/**
 * Reputation API
 * 
 * Manages the AIAgentReputationClient instance
 */

import type { AIAgentReputationClient } from '@erc8004/agentic-trust-sdk';
import { ViemAdapter } from '@erc8004/sdk';

export class ReputationAPI {
  private reputationClient: AIAgentReputationClient | null = null;

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
    clientAccount: `0x${string}`;
    agentAccount: `0x${string}`;
    identityRegistry: `0x${string}`; // Required - must be provided in reputation config or top-level config
    reputationRegistry: `0x${string}`;
    ensRegistry: `0x${string}`;
  }): Promise<void> {
    const { AIAgentReputationClient } = await import('@erc8004/agentic-trust-sdk');

    // Create adapters for client and agent using ViemAdapter
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
   * Disconnect the reputation client
   */
  disconnect(): void {
    this.reputationClient = null;
  }
}

