/**
 * Agents GraphQL Client Singleton
 *
 * Manages a singleton instance of AIAgentGraphQLClient
 * Initialized from environment variables or AgenticTrustClient config
 */

import {
  AIAgentGraphQLClient,
  type AIAgentGraphQLClientConfig,
} from '@erc8004/agentic-trust-sdk';

// Singleton instance
let agentsGraphQLClientInstance: AIAgentGraphQLClient | null = null;
let initializationPromise: Promise<AIAgentGraphQLClient> | null = null;

/**
 * Get or create the AIAgentGraphQLClient singleton
 * Initializes from environment variables or provided config
 */
export async function getAgentsGraphQLClient(
  config?: Partial<AIAgentGraphQLClientConfig>
): Promise<AIAgentGraphQLClient> {
  // If already initialized and no config override, return immediately
  if (agentsGraphQLClientInstance && !config) {
    return agentsGraphQLClientInstance;
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
      const clientConfig: AIAgentGraphQLClientConfig = {
        endpoint: graphQLUrl,
        apiKey,
        timeout: config?.timeout,
        headers: config?.headers,
      };

      agentsGraphQLClientInstance = new AIAgentGraphQLClient(clientConfig);

      console.log('✅ AgentsGraphQLClient singleton initialized');
      return agentsGraphQLClientInstance;
    } catch (error) {
      console.error('❌ Failed to initialize AgentsGraphQLClient singleton:', error);
      initializationPromise = null; // Reset on error so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Check if agents GraphQL client is initialized
 */
export function isAgentsGraphQLClientInitialized(): boolean {
  return agentsGraphQLClientInstance !== null;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetAgentsGraphQLClient(): void {
  agentsGraphQLClientInstance = null;
  initializationPromise = null;
}

