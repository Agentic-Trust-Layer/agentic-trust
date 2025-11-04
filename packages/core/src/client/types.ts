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
  /** Identity registry contract address */
  identityRegistry?: `0x${string}`;
  /** Reputation registry contract address */
  reputationRegistry?: `0x${string}`;
  /** Reputation client configuration (optional) */
  reputation?: {
    /** Viem public client */
    publicClient: any;
    /** Viem wallet client */
    walletClient: any;
    /** Client account address */
    clientAccount: `0x${string}`;
    /** Agent account address */
    agentAccount: `0x${string}`;
    /** Identity registry contract address */
    identityRegistry?: `0x${string}`;
    /** Reputation registry contract address */
    reputationRegistry: `0x${string}`;
    /** ENS registry contract address */
    ensRegistry: `0x${string}`;
  };
  /** Session package configuration (optional) */
  sessionPackage?: {
    /** Path to session package JSON file */
    filePath?: string;
    /** Session package object (if already loaded) */
    package?: import('./sessionPackage').SessionPackage;
    /** ENS registry contract address (required if using session package) */
    ensRegistry: `0x${string}`;
  };
}

