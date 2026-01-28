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
import { DomainClient } from './domainClient';

type DiscoveryKey = 'global';

class DiscoveryDomainClient extends DomainClient<AIAgentDiscoveryClient, DiscoveryKey> {
  constructor() {
    super('discovery');
  }

  private normalizeDiscoveryUrl(value: string | undefined | null): string | undefined {
    const raw = (value || '').toString().trim().replace(/\/+$/, '');
    if (!raw) return undefined;
    if (/\/graphql-kb$/i.test(raw)) return raw;
    if (/\/graphql$/i.test(raw)) return raw.replace(/\/graphql$/i, '/graphql-kb');
    return `${raw}/graphql-kb`;
  }

  // initArg is an optional Partial<AIAgentDiscoveryClientConfig> override
  protected async buildClient(_key: DiscoveryKey, initArg?: unknown): Promise<AIAgentDiscoveryClient> {
    const overrideConfig = (initArg || {}) as Partial<AIAgentDiscoveryClientConfig>;

    // Get configuration from environment variables or provided config
    // Note: endpoint should be the full discovery GraphQL URL (e.g., https://api.example.com/graphql-kb)
    let discoveryUrl = this.normalizeDiscoveryUrl(overrideConfig.endpoint);
    if (!discoveryUrl) {
      // Try environment variable
      discoveryUrl = this.normalizeDiscoveryUrl(process.env.AGENTIC_TRUST_DISCOVERY_URL);
    }

    const apiKey =
      overrideConfig.apiKey ??
      process.env.GRAPHQL_ACCESS_CODE ??
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
      timeout: overrideConfig.timeout,
      headers: overrideConfig.headers,
    };

    return new AIAgentDiscoveryClient(clientConfig);
  }
}

const discoveryDomainClient = new DiscoveryDomainClient();

/**
 * Get or create the AIAgentDiscoveryClient singleton
 * Initializes from environment variables or provided config
 */
export async function getDiscoveryClient(
  config?: Partial<AIAgentDiscoveryClientConfig>
): Promise<AIAgentDiscoveryClient> {
  const key: DiscoveryKey = 'global';

  // If a config override is provided, reset and re‑initialize with that config
  if (config) {
    discoveryDomainClient.reset(key);
    return discoveryDomainClient.get(key, config);
  }

  return discoveryDomainClient.get(key);
}

/**
 * Check if discovery client is initialized
 */
export function isDiscoveryClientInitialized(): boolean {
  return discoveryDomainClient.isInitialized('global');
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetDiscoveryClient(): void {
  discoveryDomainClient.reset();
}

