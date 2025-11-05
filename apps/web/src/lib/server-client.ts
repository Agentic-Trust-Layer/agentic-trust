/**
 * Server-side singleton for AgenticTrustClient
 * All API routes should use this singleton instance
 */

import { AgenticTrustClient } from '@agentic-trust/core';

// Singleton instance
let serverClient: AgenticTrustClient | null = null;
let initializationPromise: Promise<AgenticTrustClient> | null = null;

/**
 * Get or create the server-side AgenticTrustClient singleton
 * This ensures all API routes use the same instance
 */
export async function getAgentTrustClient(): Promise<AgenticTrustClient> {
  // If already initialized, return immediately
  if (serverClient) {
    return serverClient;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
      try {
        // Get configuration from environment variables (server-side only)
        const apiKey = process.env.AGENTIC_TRUST_API_KEY;
        const graphQLUrl = process.env.AGENTIC_TRUST_GRAPHQL_URL;
        const privateKey = process.env.AGENTIC_TRUST_PRIVATE_KEY;
        const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;
        const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
        const reputationRegistry = process.env.AGENTIC_TRUST_REPUTATION_REGISTRY;

        if (!graphQLUrl) {
          throw new Error('Missing required environment variable: GRAPHQL_URL');
        }

        const config: Record<string, unknown> = {
          graphQLUrl: graphQLUrl, 
        };

      if (apiKey) {
        config.apiKey = apiKey;
      }

      if (privateKey) {
        config.privateKey = privateKey;
      }

      if (rpcUrl) {
        config.rpcUrl = rpcUrl;
      }

      if (identityRegistry) {
        config.identityRegistry = identityRegistry as `0x${string}`;
      }

      if (reputationRegistry) {
        config.reputationRegistry = reputationRegistry as `0x${string}`;
      }

      console.log('🔧 Initializing server-side AgenticTrustClient singleton...');
      serverClient = await AgenticTrustClient.create(config);
      console.log('✅ Server-side AgenticTrustClient singleton initialized');
      
      return serverClient;
    } catch (error) {
      console.error('❌ Failed to initialize server-side AgenticTrustClient:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetServerClient(): void {
  serverClient = null;
  initializationPromise = null;
}

