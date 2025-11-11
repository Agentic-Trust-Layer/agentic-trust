/**
 * Discovery Client Singleton
 *
 * Manages a singleton instance of AIAgentDiscoveryClient
 * Initialized from environment variables or AgenticTrustClient config
 */

import {
  AIAgentDiscoveryClient,
  type AIAgentDiscoveryClientConfig,
} from '@agentic-trust/8004-ext-sdk';

// Singleton instance
let discoveryClientInstance: AIAgentDiscoveryClient | null = null;
let initializationPromise: Promise<AIAgentDiscoveryClient> | null = null;

/**
 * Get or create the AIAgentDiscoveryClient singleton
 * Initializes from environment variables or provided config
 */
export async function getDiscoveryClient(
  config?: Partial<AIAgentDiscoveryClientConfig>
): Promise<AIAgentDiscoveryClient> {
  // If already initialized and no config override, return immediately
  if (discoveryClientInstance && !config) {
    return discoveryClientInstance;
  }

  // If initialization is in progress and no config override, wait for it
  if (initializationPromise && !config) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      // Get configuration from environment variables or provided config
      // Note: endpoint should be the full discovery GraphQL URL (e.g., https://api.example.com/graphql)
      let discoveryUrl = config?.endpoint;
      if (!discoveryUrl) {
        // Try environment variable
        discoveryUrl = process.env.AGENTIC_TRUST_DISCOVERY_URL;
        // If it doesn't end with /graphql, append it
        if (discoveryUrl && !discoveryUrl.endsWith('/graphql')) {
          discoveryUrl = `${discoveryUrl.replace(/\/$/, '')}/graphql`;
        }
      }
      
      const apiKey =
        config?.apiKey ??
        process.env.AGENTIC_TRUST_DISCOVERY_API_KEY;

      if (!discoveryUrl) {
        throw new Error(
          'Missing required configuration: Discovery endpoint. Set AGENTIC_TRUST_DISCOVERY_URL or provide config.endpoint'
        );
      }

      // Build full config
      const clientConfig: AIAgentDiscoveryClientConfig = {
        endpoint: discoveryUrl,
        apiKey,
        timeout: config?.timeout,
        headers: config?.headers,
      };

      discoveryClientInstance = new AIAgentDiscoveryClient(clientConfig);

      console.log('✅ DiscoveryClient singleton initialized');
      return discoveryClientInstance;
    } catch (error) {
      console.error('❌ Failed to initialize DiscoveryClient singleton:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Check if discovery client is initialized
 */
export function isDiscoveryClientInitialized(): boolean {
  return discoveryClientInstance !== null;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetDiscoveryClient(): void {
  discoveryClientInstance = null;
  initializationPromise = null;
}

