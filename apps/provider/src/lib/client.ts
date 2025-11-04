/**
 * AgenticTrust Client setup for provider app
 * 
 * Initializes AgenticTrustClient with session package for reputation functionality
 * 
 * Note: AgenticTrustClient creates and manages its own Veramo agent internally.
 * The Veramo agent is used for both client operations and verification (DID resolution) in the A2A route.
 */

import { AgenticTrustClient, type ApiClientConfig } from '@agentic-trust/core';

// Singleton instance
let agenticTrustClientInstance: AgenticTrustClient | null = null;
let initializationPromise: Promise<AgenticTrustClient> | null = null;

/**
 * Get or create the server-side AgenticTrustClient singleton for the provider
 * Uses session package configuration from environment variables
 * 
 * Note: AgenticTrustClient creates its own Veramo agent internally via veramoFactory.
 * This agent includes all necessary resolvers for DID resolution (verification).
 */
export async function getProviderClient(): Promise<AgenticTrustClient> {
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
      const privateKey = process.env.AGENTIC_TRUST_PRIVATE_KEY;
      
      // Session package configuration
      const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
      const ensRegistry = process.env.AGENTIC_TRUST_ENS_REGISTRY;

      // RPC URLs for DID resolution
      const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;

      // Get identity registry from environment
      const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;

      // Get reputation registry from environment
      const reputationRegistry = process.env.AGENTIC_TRUST_REPUTATION_REGISTRY;

      // Note: AgenticTrustClient creates its own Veramo agent internally via veramoFactory
      // This agent includes all necessary resolvers (AA, Agent, ethr) for DID resolution
      const config: ApiClientConfig = {
        timeout: 30000,
        headers: {
          Accept: 'application/json',
        },
      };


      // Set apiKey if provided
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

      // Configure session package if path and ENS registry are provided
      // Note: All overrides (rpcUrl, bundlerUrl, reputationRegistry) come from environment variables only
      if (sessionPackagePath && ensRegistry) {
        config.sessionPackage = {
          filePath: sessionPackagePath,
          ensRegistry: ensRegistry as `0x${string}`,
        };
      }

      // Create the client
      console.info('Creating AgenticTrustClient instance: ', config.rpcUrl, ', privateKey: ', config.privateKey);
      agenticTrustClientInstance = await AgenticTrustClient.create(config);
      console.log('✅ Provider AgenticTrustClient singleton initialized');
      return agenticTrustClientInstance;
    } catch (error) {
      console.error('❌ Failed to initialize provider AgenticTrustClient:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * @deprecated Use getProviderClient() instead. This function is kept for backward compatibility.
 */
export async function initializeProviderClient(): Promise<AgenticTrustClient> {
  return getProviderClient();
}

/**
 * Reset the client instance (useful for testing)
 */
export function resetProviderClient(): void {
  agenticTrustClientInstance = null;
}

