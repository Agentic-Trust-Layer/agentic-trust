/**
 * Veramo Agent integration for AgenticTrustClient
 */

import type { TAgent, IKeyManager, IDIDManager, ICredentialIssuer, ICredentialVerifier, IResolver } from '@veramo/core';

/**
 * Type definition for a Veramo agent with required capabilities
 */
export type VeramoAgent = TAgent<
  IKeyManager & IDIDManager & ICredentialIssuer & ICredentialVerifier & IResolver
>;

/**
 * Veramo integration API
 * Provides access to the connected Veramo agent
 */
export class VeramoAPI {
  private agent: VeramoAgent | null = null;

  /**
   * Connect a Veramo agent instance to the client
   */
  connect(agent: VeramoAgent): void {
    this.agent = agent;
  }

  /**
   * Get the connected Veramo agent
   * Agent is always connected after client construction
   */
  getAgent(): VeramoAgent {
    if (!this.agent) {
      throw new Error('Veramo agent not connected. This should not happen.');
    }
    return this.agent;
  }

  /**
   * Check if an agent is connected
   */
  isConnected(): boolean {
    return this.agent !== null;
  }

  /**
   * Disconnect the agent
   */
  disconnect(): void {
    this.agent = null;
  }
}

