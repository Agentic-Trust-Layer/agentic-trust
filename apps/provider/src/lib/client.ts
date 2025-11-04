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

/**
 * Initialize the AgenticTrust client instance for the provider
 * Uses session package configuration from environment variables
 * 
 * Note: AgenticTrustClient creates its own Veramo agent internally via veramoFactory.
 * This agent includes all necessary resolvers for DID resolution (verification).
 */
export async function initializeProviderClient(): Promise<AgenticTrustClient> {
  if (agenticTrustClientInstance) {
    return agenticTrustClientInstance;
  }

  // Get configuration from environment variables
  const baseUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_BASE_URL || 
                  process.env.AGENTIC_TRUST_BASE_URL;
  const apiKey = process.env.AGENTIC_TRUST_API_KEY || 
                 process.env.NEXT_PUBLIC_AGENTIC_TRUST_API_KEY;
  const privateKey = process.env.AGENTIC_TRUST_PRIVATE_KEY || 
                     process.env.NEXT_PUBLIC_AGENTIC_TRUST_PRIVATE_KEY;
  
  // Session package configuration
  const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH ||
                             process.env.NEXT_PUBLIC_AGENTIC_TRUST_SESSION_PACKAGE_PATH;
  const ensRegistry = process.env.AGENTIC_TRUST_ENS_REGISTRY ||
                      process.env.NEXT_PUBLIC_AGENTIC_TRUST_ENS_REGISTRY;


  // RPC URLs for DID resolution
  const rpcUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL;

  // Get identity registry from environment
  const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY ||
                          process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY;

  // Get reputation registry from environment
  const reputationRegistry = process.env.AGENTIC_TRUST_REPUTATION_REGISTRY ||
                            process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY;

  // Note: AgenticTrustClient creates its own Veramo agent internally via veramoFactory
  // This agent includes all necessary resolvers (AA, Agent, ethr) for DID resolution
  const config: ApiClientConfig = {
    timeout: 30000,
    headers: {
      Accept: 'application/json',
    },
  };

  // Set baseUrl if provided
  if (baseUrl) {
    config.baseUrl = baseUrl;
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
  return agenticTrustClientInstance;
}

/**
 * Get the AgenticTrust client instance
 * Throws if client has not been initialized
 */
export function getProviderClient(): AgenticTrustClient {
  if (!agenticTrustClientInstance) {
    throw new Error(
      'AgenticTrustClient not initialized. Call initializeProviderClient() first.'
    );
  }
  return agenticTrustClientInstance;
}

/**
 * Reset the client instance (useful for testing)
 */
export function resetProviderClient(): void {
  agenticTrustClientInstance = null;
}

