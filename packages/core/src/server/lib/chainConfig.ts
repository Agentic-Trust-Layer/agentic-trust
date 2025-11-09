/**
 * Centralized Chain Configuration
 *
 * This module provides chain-specific configuration and utilities
 * used throughout the AgenticTrust system.
 */

import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';

// Re-export chains for convenience
export { sepolia, baseSepolia, optimismSepolia };

/**
 * Chain configuration mapping
 */
export const CHAIN_CONFIG = {
  11155111: { // Ethereum Sepolia
    suffix: 'SEPOLIA',
    name: 'sepolia'
  },
  84532: { // Base Sepolia
    suffix: 'BASE_SEPOLIA',
    name: 'baseSepolia'
  },
  11155420: { // Optimism Sepolia
    suffix: 'OPTIMISM_SEPOLIA',
    name: 'optimismSepolia'
  }
} as const;

export type SupportedChainId = keyof typeof CHAIN_CONFIG;

/**
 * Default chain ID used when no chain is specified
 */
export const DEFAULT_CHAIN_ID: SupportedChainId = 11155111; // Ethereum Sepolia

const SERVER_CHAIN_RPC_ENV: Partial<Record<SupportedChainId, string | undefined>> = {
  11155111: process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA,
  84532: process.env.AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA,
  11155420: process.env.AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA,
} as const;

const CLIENT_CHAIN_RPC_ENV: Partial<Record<SupportedChainId, string | undefined>> = {
  11155111: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA,
  84532: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA,
  11155420: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA,
} as const;

const SERVER_CHAIN_BUNDLER_ENV: Partial<Record<SupportedChainId, string | undefined>> = {
  11155111: process.env.AGENTIC_TRUST_BUNDLER_URL_SEPOLIA,
  84532: process.env.AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA,
  11155420: process.env.AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA,
} as const;

const CLIENT_CHAIN_BUNDLER_ENV: Partial<Record<SupportedChainId, string | undefined>> = {
  11155111: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA,
  84532: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA,
  11155420: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA,
} as const;

/**
 * Get chain-specific environment variable
 * @param baseName - Base environment variable name (e.g., 'AGENTIC_TRUST_RPC_URL')
 * @param chainId - Chain ID to get configuration for
 * @returns Chain-specific environment variable value or fallback to base name
 */
export function getChainEnvVar(baseName: string, chainId: number): string {
  const chainConfig = CHAIN_CONFIG[chainId as SupportedChainId];
  if (chainConfig) {
    const chainSpecificKey = `${baseName}_${chainConfig.suffix}`;
    const fallbackKey = baseName;
    return process.env[chainSpecificKey] || process.env[fallbackKey] || '';
  }
  return process.env[baseName] || '';
}

/**
 * Get chain-specific contract address
 * @param baseName - Base environment variable name (e.g., 'AGENTIC_TRUST_ENS_REGISTRY')
 * @param chainId - Chain ID to get configuration for
 * @returns Chain-specific contract address or fallback to base name
 */
export function getChainContractAddress(baseName: string, chainId: number): `0x${string}` | undefined {
  const value = getChainEnvVar(baseName, chainId);
  return value ? (value.startsWith('0x') ? value as `0x${string}` : `0x${value}` as `0x${string}`) : undefined;
}

/**
 * Get chain object by chainId
 * @param chainId - Chain ID to get chain object for
 * @returns viem Chain object
 * @throws Error if chainId is not supported
 */
export function getChainById(chainId: number): any {
  const chainConfig = CHAIN_CONFIG[chainId as SupportedChainId];
  if (!chainConfig) {
    throw new Error(`Unsupported chainId: ${chainId}. Supported chains: ${Object.keys(CHAIN_CONFIG).join(', ')}`);
  }

  const chainName = chainConfig.name;
  switch (chainName) {
    case 'sepolia':
      return sepolia;
    case 'baseSepolia':
      return baseSepolia;
    case 'optimismSepolia':
      return optimismSepolia;
    default:
      throw new Error(`Chain ${chainName} not implemented`);
  }
}

/**
 * Get all supported chain IDs
 * @returns Array of supported chain IDs
 */
export function getSupportedChainIds(): number[] {
  return Object.keys(CHAIN_CONFIG).map(id => parseInt(id, 10));
}

/**
 * Check if a chain ID is supported
 * @param chainId - Chain ID to check
 * @returns True if the chain ID is supported
 */
export function isChainSupported(chainId: number): boolean {
  return chainId in CHAIN_CONFIG;
}

/**
 * Get chain configuration by chain ID
 * @param chainId - Chain ID to get configuration for
 * @returns Chain configuration object or null if not supported
 */
export function getChainConfig(chainId: number): typeof CHAIN_CONFIG[SupportedChainId] | null {
  return CHAIN_CONFIG[chainId as SupportedChainId] || null;
}

/**
 * Get chain-specific RPC URL (accessible from both server and client)
 *
 * Requires chain-specific environment variables - throws error if not found:
 * Browser: NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_{CHAIN_SUFFIX}
 * Server: AGENTIC_TRUST_RPC_URL_{CHAIN_SUFFIX} (preferred) or NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_{CHAIN_SUFFIX}
 * No generic fallbacks - only chain-specific variables are checked
 *
 * @param chainId - Chain ID to get RPC URL for
 * @returns RPC URL string
 */
export function getChainRpcUrl(chainId: number): string {
  const chainConfig = CHAIN_CONFIG[chainId as SupportedChainId];
  if (chainConfig) {
    // Determine if we're running in browser or server
    const isBrowser = typeof window !== 'undefined';

    const serverValue = SERVER_CHAIN_RPC_ENV[chainId as SupportedChainId];
    const clientValue = CLIENT_CHAIN_RPC_ENV[chainId as SupportedChainId];

    if (isBrowser) {
      console.log(`[getChainRpcUrl] Browser mode - checking NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_${chainConfig.suffix}:`, clientValue ? 'found' : 'not found');
      if (clientValue) return clientValue;
    } else {
      console.log(`[getChainRpcUrl] Server mode - checking AGENTIC_TRUST_RPC_URL_${chainConfig.suffix}:`, serverValue ? 'found' : 'not found');
      if (serverValue) return serverValue;

      console.log(`[getChainRpcUrl] Server mode - checking NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_${chainConfig.suffix}:`, clientValue ? 'found' : 'not found');
      if (clientValue) return clientValue;
    }

    // Debug: Log chain-specific environment variables
    console.log(`[getChainRpcUrl] Environment: ${isBrowser ? 'browser' : 'server'}`);
    console.log(`[getChainRpcUrl] Looking for chain-specific variables for ${chainConfig.name} (${chainId}):`);
    console.log(`  AGENTIC_TRUST_RPC_URL_${chainConfig.suffix}: ${serverValue ? 'set (' + serverValue.substring(0, 20) + '...)' : 'not set'}`);
    console.log(`  NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_${chainConfig.suffix}: ${clientValue ? 'set (' + clientValue.substring(0, 20) + '...)' : 'not set'}`);

    // Log all AGENTIC_TRUST variables for debugging
    const allMatchingKeys = Object.keys(process.env).filter(key =>
      key.startsWith('AGENTIC_TRUST') || key.startsWith('NEXT_PUBLIC_AGENTIC_TRUST')
    );
    console.log(`  Total AGENTIC_TRUST variables found: ${allMatchingKeys.length}`);

    // No generic fallbacks - throw error if chain-specific variable not configured
    const expectedVar = isBrowser
      ? `NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_${chainConfig.suffix}`
      : `AGENTIC_TRUST_RPC_URL_${chainConfig.suffix}`;

    throw new Error(
      `Missing required RPC URL for chain ${chainId} (${chainConfig.name}). ` +
      `Set ${expectedVar} environment variable.`
    );
  }
  throw new Error(`Unsupported chain ID: ${chainId}`);
}

/**
 * Get chain-specific bundler URL (accessible from both server and client)
 * @param chainId - Chain ID to get bundler URL for
 * @returns Bundler URL string
 */
export function getChainBundlerUrl(chainId: number): string {
  const chainConfig = CHAIN_CONFIG[chainId as SupportedChainId];
  if (chainConfig) {
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser) {
      const clientValue = CLIENT_CHAIN_BUNDLER_ENV[chainId as SupportedChainId];
      if (clientValue) return clientValue;
    } else {
      const serverValue = SERVER_CHAIN_BUNDLER_ENV[chainId as SupportedChainId];
      if (serverValue) return serverValue;

      const clientValue = CLIENT_CHAIN_BUNDLER_ENV[chainId as SupportedChainId];
      if (clientValue) return clientValue;
    }

    const expectedVar = isBrowser
      ? `NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_${chainConfig.suffix}`
      : `AGENTIC_TRUST_BUNDLER_URL_${chainConfig.suffix}`;
    throw new Error(
      `Missing required bundler URL for chain ${chainId} (${chainConfig.name}). ` +
      `Set ${expectedVar} environment variable.`
    );
  }
  throw new Error(`Unsupported chain ID: ${chainId}`);
}

/**
 * Check if private key mode is enabled (accessible from both server and client)
 * @returns True if private key mode is enabled
 */
export function isPrivateKeyMode(): boolean {
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_USE_PRIVATE_KEY === 'true';
}

/**
 * Get ENS organization name (accessible from both server and client)
 * @returns ENS organization name
 */
export function getEnsOrgName(): string {
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_ENS_ORG_NAME || '8004-agent';
}

/**
 * Get Web3Auth client ID (accessible from both server and client)
 * @returns Web3Auth client ID
 */
export function getWeb3AuthClientId(): string {
  return process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID || '';
}

/**
 * Get Web3Auth network (accessible from both server and client)
 * @returns Web3Auth network
 */
export function getWeb3AuthNetwork(): string {
  return process.env.NEXT_PUBLIC_WEB3AUTH_NETWORK || 'sapphire_devnet';
}
