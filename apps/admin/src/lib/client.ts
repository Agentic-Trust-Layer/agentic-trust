/**
 * AgenticTrust Client setup for admin app
 * 
 * Initializes AgenticTrustClient with admin configuration for agent management
 */

import { AgenticTrustClient, type ApiClientConfig } from '@agentic-trust/core';

// Singleton instance
let agenticTrustClientInstance: AgenticTrustClient | null = null;
let initializationPromise: Promise<AgenticTrustClient> | null = null;

/**
 * Get or create the server-side AgenticTrustClient singleton for the admin app
 * Uses admin configuration from environment variables
 */
export async function getAdminClient(): Promise<AgenticTrustClient> {
  // If already initialized, return immediately
  if (agenticTrustClientInstance) {
    return agenticTrustClientInstance;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      // Get configuration from environment variables (server-side only)
      const graphQLUrl = process.env.AGENTIC_TRUST_GRAPHQL_URL;
      const apiKey = process.env.AGENTIC_TRUST_API_KEY;
      const privateKey = process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY || process.env.AGENTIC_TRUST_PRIVATE_KEY;
      const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;

      // Get identity registry from environment
      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
      const reputationRegistry = process.env.AGENTIC_TRUST_REPUTATION_REGISTRY;

      const config: ApiClientConfig = {
        timeout: 30000,
        headers: {
          Accept: 'application/json',
        },
      };

      // Set graphQLUrl if provided
      if (graphQLUrl) {
        config.graphQLUrl = graphQLUrl;
      }

      // Set apiKey if provided
      if (apiKey) {
        config.apiKey = apiKey;
      }

      // Set private key if provided (for AgenticTrustClient's internal Veramo agent)
      if (privateKey) {
        config.privateKey = privateKey;
      }

      // Set RPC URLs if provided (for AgenticTrustClient's internal Veramo agent)
      if (rpcUrl) {
        config.rpcUrl = rpcUrl;
      }

      // Set identity registry if provided
      if (identityRegistry) {
        config.identityRegistry = identityRegistry as `0x${string}`;
      }

      // Set reputation registry if provided
      if (reputationRegistry) {
        config.reputationRegistry = reputationRegistry as `0x${string}`;
      }

      // Create the client
      console.info('Creating Admin AgenticTrustClient instance');
      agenticTrustClientInstance = await AgenticTrustClient.create(config);
      console.log('✅ Admin AgenticTrustClient singleton initialized');
      return agenticTrustClientInstance;
    } catch (error) {
      console.error('❌ Failed to initialize admin AgenticTrustClient:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Reset the client instance (useful for testing)
 */
export function resetAdminClient(): void {
  agenticTrustClientInstance = null;
  initializationPromise = null;
}

