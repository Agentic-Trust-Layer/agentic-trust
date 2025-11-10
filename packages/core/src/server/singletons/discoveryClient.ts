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
      // Note: endpoint should be the full GraphQL URL (e.g., https://api.example.com/graphql)
      let graphQLUrl = config?.endpoint;
      if (!graphQLUrl) {
        // Try environment variable
        graphQLUrl = process.env.AGENTIC_TRUST_GRAPHQL_URL;
        // If it doesn't end with /graphql, append it
        if (graphQLUrl && !graphQLUrl.endsWith('/graphql')) {
          graphQLUrl = `${graphQLUrl.replace(/\/$/, '')}/graphql`;
        }
      }
      
      const apiKey = config?.apiKey || process.env.AGENTIC_TRUST_API_KEY;

      if (!graphQLUrl) {
        throw new Error(
          'Missing required configuration: GraphQL endpoint. Set AGENTIC_TRUST_GRAPHQL_URL or provide config.endpoint'
        );
      }

      // Build full config
      const clientConfig: AIAgentDiscoveryClientConfig = {
        endpoint: graphQLUrl,
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

