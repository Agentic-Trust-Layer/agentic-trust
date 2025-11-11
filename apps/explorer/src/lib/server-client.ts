import {
  AgenticTrustClient,
  DEFAULT_CHAIN_ID,
  getChainEnvVar,
  getChainRpcUrl,
  type ApiClientConfig,
} from '@agentic-trust/core/server';

let explorerClient: AgenticTrustClient | null = null;
let initializing: Promise<AgenticTrustClient> | null = null;

export async function getExplorerClient(): Promise<AgenticTrustClient> {
  if (explorerClient) {
    return explorerClient;
  }

  if (initializing) {
    return initializing;
  }

  initializing = (async () => {
    try {
      const discoveryUrl = process.env.AGENTIC_TRUST_DISCOVERY_URL;
      if (!discoveryUrl) {
        throw new Error('Missing required environment variable: AGENTIC_TRUST_DISCOVERY_URL');
      }

      const config: ApiClientConfig = {
        graphQLUrl: discoveryUrl,
        timeout: 20000,
        headers: {
          Accept: 'application/json',
        },
      };

      const apiKey =
        process.env.AGENTIC_TRUST_DISCOVERY_API_KEY ??
        process.env.NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_API_KEY;
      if (apiKey) {
        config.apiKey = apiKey;
      }

      const rpcUrl = getChainRpcUrl(DEFAULT_CHAIN_ID);
      if (rpcUrl) {
        config.rpcUrl = rpcUrl;
      }

      const identityRegistry = getChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', DEFAULT_CHAIN_ID);
      if (identityRegistry) {
        config.identityRegistry = identityRegistry as `0x${string}`;
      }

      explorerClient = await AgenticTrustClient.create(config);
      return explorerClient;
    } finally {
      initializing = null;
    }
  })();

  return initializing;
}

export function resetExplorerClient(): void {
  explorerClient = null;
  initializing = null;
}

