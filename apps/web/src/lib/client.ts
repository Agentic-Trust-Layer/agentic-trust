/**
 * AgenticTrust Client Singleton
 * 
 * Provides a singleton instance of the AgenticTrustClient
 * for use throughout the application
 */

import {
  AgenticTrustClient,
  type ApiClientConfig,
  type VeramoAgent,
} from '@agentic-trust/core';

/**
 * Create API client configuration
 * Retrieves API key and private key from environment variables
 * 
 */
export function createApiClientConfig(
  privateKey?: string
): ApiClientConfig {

  const apiKey = process.env.NEXT_PUBLIC_AGENTIC_TRUST_API_KEY || process.env.AGENTIC_TRUST_API_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_BASE_URL || process.env.AGENTIC_TRUST_BASE_URL;


  const rpcUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL;
  const identityRegistry = process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY ||
    process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
  const reputationRegistry = process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY ||
    process.env.AGENTIC_TRUST_REPUTATION_REGISTRY;



  const config: ApiClientConfig = {
    timeout: 30000,
    headers: {
      Accept: 'application/json',
    },
  };



  if (baseUrl) {
    config.baseUrl = baseUrl;
  }


  if (apiKey) {
    config.apiKey = apiKey;
  }


  if (privateKey) {
    config.privateKey = privateKey;
  }

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


  return config;
}

// Singleton instance
let agenticTrustClientInstance: AgenticTrustClient | null = null;

/**
 * Initialize the AgenticTrust client instance
 * Must be called before using getAgenticTrustClient()
 * 
 * @param config - Optional configuration including privateKey
 */
export async function initializeAgenticTrustClient(
  config?: { privateKey?: string }
): Promise<AgenticTrustClient> {

  console.info('************* Initializing AgenticTrustClient *************');
  if (agenticTrustClientInstance) {
    return agenticTrustClientInstance;
  }

  agenticTrustClientInstance = await AgenticTrustClient.create(
    createApiClientConfig(config?.privateKey)
  );
  console.warn('✅ AgenticTrustClient created successfully');
  return agenticTrustClientInstance;
}

/**
 * Get the AgenticTrust client instance
 * Throws if client has not been initialized
 */
export function getAgenticTrustClient(): AgenticTrustClient {
  if (!agenticTrustClientInstance) {
    throw new Error(
      'AgenticTrustClient not initialized. Call initializeAgenticTrustClient(veramoAgent) first.'
    );
  }
  return agenticTrustClientInstance;
}

/**
 * Reset the client instance (useful for testing or re-authentication)
 */
export function resetAgenticTrustClient(): void {
  agenticTrustClientInstance = null;
}

