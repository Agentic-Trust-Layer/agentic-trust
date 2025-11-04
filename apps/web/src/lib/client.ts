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
 * Note: Veramo agent is now optional - if not provided, it will be created automatically
 * @param veramoAgent - Optional Veramo agent instance (will be created if not provided)
 * @param privateKey - Optional private key override (if not provided, will use env var or generate)
 */
export function createApiClientConfig(
  veramoAgent?: VeramoAgent,
  privateKey?: string
): ApiClientConfig {
  // Get API key from environment variable
  // NEXT_PUBLIC_ prefix is required for client-side access in Next.js
  const apiKey = process.env.NEXT_PUBLIC_AGENTIC_TRUST_API_KEY || process.env.AGENTIC_TRUST_API_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_BASE_URL || process.env.AGENTIC_TRUST_BASE_URL;
  
  // Get private key from parameter or environment variable
  // Note: Private keys should generally NOT be in NEXT_PUBLIC_ env vars for security
  // Consider using server-side only env vars or secure storage
  const envPrivateKey = process.env.AGENTIC_TRUST_PRIVATE_KEY || process.env.NEXT_PUBLIC_AGENTIC_TRUST_PRIVATE_KEY;

  // Get RPC URLs from environment
  const sepoliaRpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

  // Get identity registry from environment
  const identityRegistry = process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY ||
    process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;

  // Get reputation registry from environment
  const reputationRegistry = process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY ||
    process.env.AGENTIC_TRUST_REPUTATION_REGISTRY;

  // Get session package configuration
  const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH || 
    process.env.NEXT_PUBLIC_AGENTIC_TRUST_SESSION_PACKAGE_PATH;
  const ensRegistry = process.env.AGENTIC_TRUST_ENS_REGISTRY || 
    process.env.NEXT_PUBLIC_AGENTIC_TRUST_ENS_REGISTRY;
  const sessionPackageRpcUrl = process.env.AGENTIC_TRUST_RPC_URL ||
    process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL;
  const bundlerUrl = process.env.AGENTIC_TRUST_BUNDLER_URL ||
    process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL;
  const reputationRegistry = process.env.AGENTIC_TRUST_REPUTATION_REGISTRY ||
    process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY;

  const config: ApiClientConfig = {
    timeout: 30000,
    headers: {
      Accept: 'application/json',
    },
  };

  // Set veramoAgent if provided (optional)
  if (veramoAgent) {
    config.veramoAgent = veramoAgent;
  }

  // Set baseUrl if provided
  if (baseUrl) {
    config.baseUrl = baseUrl;
  }

  // Only include apiKey if it exists (don't pass undefined)
  if (apiKey) {
    config.apiKey = apiKey;
  }

  // Set private key from parameter (preferred) or environment variable
  const finalPrivateKey = privateKey || envPrivateKey;
  if (finalPrivateKey) {
    config.privateKey = finalPrivateKey;
  }

  if (sepoliaRpcUrl) {
    config.sepoliaRpcUrl = sepoliaRpcUrl;
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

  return config;
}

// Singleton instance
let agenticTrustClientInstance: AgenticTrustClient | null = null;

/**
 * Initialize the AgenticTrust client instance
 * Veramo agent is optional - will be created automatically if not provided
 * Must be called before using getAgenticTrustClient()
 * 
 * @param config - Optional configuration including veramoAgent and privateKey
 */
export async function initializeAgenticTrustClient(
  config?: { veramoAgent?: VeramoAgent; privateKey?: string }
): Promise<AgenticTrustClient> {
  if (agenticTrustClientInstance) {
    // If already initialized and new agent provided, reconnect
    if (config?.veramoAgent) {
      agenticTrustClientInstance.veramo.disconnect();
      agenticTrustClientInstance.veramo.connect(config.veramoAgent);
    }
    return agenticTrustClientInstance;
  }

  agenticTrustClientInstance = await AgenticTrustClient.create(
    createApiClientConfig(config?.veramoAgent, config?.privateKey)
  );
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

