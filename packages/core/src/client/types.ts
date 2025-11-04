import type { VeramoAgent } from './veramo';

/**
 * Configuration for AgenticTrust API client
 */
export interface ApiClientConfig {
  /** Veramo agent instance - optional, will be created automatically if not provided */
  veramoAgent?: VeramoAgent;
  /** Base URL for the GraphQL API endpoint */
  baseUrl?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Ethereum private key (hex string with or without 0x prefix) - if not provided, a key will be generated for the session */
  privateKey?: string;
  /** Ethereum RPC URLs for DID resolution (optional) */
  ethereumRpcUrl?: string;
  sepoliaRpcUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Additional headers to include in requests */
  headers?: Record<string, string>;
}

