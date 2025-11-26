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
    name: 'sepolia',
    displayName: 'Ethereum Sepolia',
    layer: 'L1' as const,
  },
  84532: { // Base Sepolia
    suffix: 'BASE_SEPOLIA',
    name: 'baseSepolia',
    displayName: 'Base Sepolia',
    layer: 'L2' as const,
  },
  11155420: { // Optimism Sepolia
    suffix: 'OPTIMISM_SEPOLIA',
    name: 'optimismSepolia',
    displayName: 'Optimism Sepolia',
    layer: 'L2' as const,
  },
} as const;

export type SupportedChainId = keyof typeof CHAIN_CONFIG;
export type ChainLayer = 'L1' | 'L2';

export function getChainLayer(chainId: number): ChainLayer {
  const cfg = CHAIN_CONFIG[chainId as SupportedChainId];
  if (!cfg) throw new Error(`Unsupported chainId: ${chainId}`);
  return cfg.layer;
}

export function isL1(chainId: number): boolean {
  return getChainLayer(chainId) === 'L1';
}

export function isL2(chainId: number): boolean {
  return getChainLayer(chainId) === 'L2';
}

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

// ENS chain-specific variables
const SERVER_CHAIN_ENS_PRIVKEY_ENV: Partial<Record<SupportedChainId, string | undefined>> = {
  11155111: process.env.AGENTIC_TRUST_ENS_PRIVATE_KEY_SEPOLIA,
  84532: process.env.AGENTIC_TRUST_ENS_PRIVATE_KEY_BASE_SEPOLIA,
  11155420: process.env.AGENTIC_TRUST_ENS_PRIVATE_KEY_OPTIMISM_SEPOLIA,
} as const;

const SERVER_CHAIN_ENS_ORG_ADDRESS_ENV: Partial<Record<SupportedChainId, string | undefined>> = {
  11155111: process.env.AGENTIC_TRUST_ENS_ORG_ADDRESS_SEPOLIA,
  84532: process.env.AGENTIC_TRUST_ENS_ORG_ADDRESS_BASE_SEPOLIA,
  11155420: process.env.AGENTIC_TRUST_ENS_ORG_ADDRESS_OPTIMISM_SEPOLIA,
} as const;

const CLIENT_CHAIN_ENS_ORG_NAME_ENV: Partial<Record<SupportedChainId, string | undefined>> = {
  11155111: process.env.NEXT_PUBLIC_AGENTIC_TRUST_ENS_ORG_NAME_SEPOLIA,
  84532: process.env.NEXT_PUBLIC_AGENTIC_TRUST_ENS_ORG_NAME_BASE_SEPOLIA,
  11155420: process.env.NEXT_PUBLIC_AGENTIC_TRUST_ENS_ORG_NAME_OPTIMISM_SEPOLIA,
} as const;

/**
 * Get chain-specific environment variable
 * @param baseName - Base environment variable name (e.g., 'AGENTIC_TRUST_RPC_URL')
 * @param chainId - Chain ID to get configuration for
 * @returns Chain-specific environment variable value or fallback to base name
 */
export function getChainEnvVarDetails(baseName: string, chainId: number): {
  value: string;
  chainKey: string;
  fallbackKey: string;
  usedKey: string;
} {
  const cfg = CHAIN_CONFIG[chainId as SupportedChainId];
  const chainKey = cfg ? `${baseName}_${cfg.suffix}` : `${baseName}_${chainId}`;
  const fallbackKey = baseName;
  const chainValue = cfg ? process.env[chainKey] : undefined;
  const fallbackValue = process.env[fallbackKey];
  const value = chainValue ?? fallbackValue ?? '';
  const usedKey = chainValue ? chainKey : fallbackValue ? fallbackKey : chainKey;
  return {
    value,
    chainKey: cfg ? chainKey : fallbackKey,
    fallbackKey,
    usedKey,
  };
}

export function getChainEnvVar(baseName: string, chainId: number): string {
  return getChainEnvVarDetails(baseName, chainId).value;
}

type ChainEnvVarNames = {
  rpcServer: string;
  rpcClient: string;
  bundlerServer: string;
  bundlerClient: string;
  ensOrgAddressServer: string;
  ensOrgNameClient: string;
  ensPrivateKeyServer: string;
};

export function getChainEnvVarNames(chainId: number): ChainEnvVarNames {
  const cfg = CHAIN_CONFIG[chainId as SupportedChainId];
  if (!cfg) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }
  return {
    rpcServer: `AGENTIC_TRUST_RPC_URL_${cfg.suffix}`,
    rpcClient: `NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_${cfg.suffix}`,
    bundlerServer: `AGENTIC_TRUST_BUNDLER_URL_${cfg.suffix}`,
    bundlerClient: `NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_${cfg.suffix}`,
    ensOrgAddressServer: `AGENTIC_TRUST_ENS_ORG_ADDRESS_${cfg.suffix}`,
    ensOrgNameClient: `NEXT_PUBLIC_AGENTIC_TRUST_ENS_ORG_NAME_${cfg.suffix}`,
    ensPrivateKeyServer: `AGENTIC_TRUST_ENS_PRIVATE_KEY_${cfg.suffix}`,
  };
}

export function requireChainEnvVar(baseName: string, chainId: number): string {
  const { value, chainKey } = getChainEnvVarDetails(baseName, chainId);
  if (!value) {
    throw new Error(`Missing required environment variable: ${chainKey}`);
  }
  return value;
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

    // Read directly from process.env at runtime instead of using cached values
    // This ensures we get the current value even if env vars were loaded after module initialization
    let serverValue: string | undefined;
    let clientValue: string | undefined;
    
    if (chainId === 11155111) {
      serverValue = process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA;
      clientValue = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA;
    } else if (chainId === 84532) {
      serverValue = process.env.AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA;
      clientValue = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA;
    } else if (chainId === 11155420) {
      serverValue = process.env.AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA;
      clientValue = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA;
    }

    if (isBrowser) {
      if (clientValue) return clientValue;
    } else {
      if (serverValue) return serverValue;
      if (clientValue) return clientValue;
    }

    // Log all AGENTIC_TRUST variables for debugging
    const allMatchingKeys = Object.keys(process.env).filter(key =>
      key.startsWith('AGENTIC_TRUST') || key.startsWith('NEXT_PUBLIC_AGENTIC_TRUST')
    );

    // No generic fallbacks - throw error if chain-specific variable not configured
    const envNames = getChainEnvVarNames(chainId);
    const mask = (val?: string) => (val ? '<set>' : '<missing>');
    const expectedVar = isBrowser ? envNames.rpcClient : envNames.rpcServer;
    console.error(
      `[chainConfig] Missing RPC URL for chain ${chainId} (${chainConfig.name}). Checked env vars ` +
        `${envNames.rpcServer}=${mask(serverValue)} and ${envNames.rpcClient}=${mask(clientValue)}. ` +
        `Set ${isBrowser ? envNames.rpcClient : `${envNames.rpcServer} (server) or ${envNames.rpcClient}`}.`,
    );
    throw new Error(
      `Missing required RPC URL for chain ${chainId} (${chainConfig.name}). ` +
      `Set ${expectedVar} environment variable.`
    );
  }
  throw new Error(`Unsupported chain ID: ${chainId}`);
}

export interface ChainDisplayMetadata {
  chainId: number;
  chainIdHex: `0x${string}`;
  chainName: string;
  displayName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

export function getChainIdHex(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}` as `0x${string}`;
}

export function getChainDisplayMetadata(chainId: number): ChainDisplayMetadata {
  const chainConfig = CHAIN_CONFIG[chainId as SupportedChainId];
  if (!chainConfig) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const chain = getChainById(chainId);
  const chainIdHex = getChainIdHex(chainId);
  const rpcUrl = getChainRpcUrl(chainId);
  const nativeCurrency = chain.nativeCurrency ?? {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  };

  const blockExplorerUrls: string[] = [];
  const defaultExplorerUrl = chain.blockExplorers?.default?.url;
  if (defaultExplorerUrl) {
    blockExplorerUrls.push(defaultExplorerUrl);
  }

  return {
    chainId,
    chainIdHex,
    chainName: chain.name,
    displayName: chainConfig.displayName || chain.name,
    nativeCurrency,
    rpcUrls: [rpcUrl],
    blockExplorerUrls,
  };
}

export interface Web3AuthChainSettings {
  chainNamespace: 'eip155';
  chainId: `0x${string}`;
  rpcTarget: string;
  displayName: string;
  blockExplorerUrl?: string;
  ticker: string;
  tickerName: string;
  decimals: number;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

export function getWeb3AuthChainSettings(chainId: number): Web3AuthChainSettings {
  const metadata = getChainDisplayMetadata(chainId);
  const nativeCurrency = metadata.nativeCurrency;
  const rpcTarget = metadata.rpcUrls[0];

  if (!rpcTarget) {
    throw new Error(`Missing RPC URL for Web3Auth chain ${chainId}`);
  }

  return {
    chainNamespace: 'eip155',
    chainId: metadata.chainIdHex,
    rpcTarget,
    displayName: metadata.displayName,
    blockExplorerUrl: metadata.blockExplorerUrls[0],
    ticker: nativeCurrency.symbol ?? 'ETH',
    tickerName: nativeCurrency.name ?? 'Ether',
    decimals: nativeCurrency.decimals ?? 18,
    nativeCurrency,
    rpcUrls: metadata.rpcUrls,
    blockExplorerUrls: metadata.blockExplorerUrls,
  };
}

/**
 * Get chain-specific bundler URL (accessible from both server and client)
 * @param chainId - Chain ID to get bundler URL for
 * @returns Bundler URL string
 */
export function getChainBundlerUrl(chainId: number): string {
  const chainConfig = CHAIN_CONFIG[chainId as SupportedChainId];
  if (chainConfig) {
    // Determine if we're running in browser or server
    const isBrowser = typeof window !== 'undefined';

    // Read directly from process.env at runtime instead of using cached values
    // This ensures we get the current value even if env vars were loaded after module initialization
    let serverValue: string | undefined;
    let clientValue: string | undefined;
    
    if (chainId === 11155111) {
      serverValue = process.env.AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
      clientValue = process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
      // Debug logging
      console.log(`[chainConfig] getChainBundlerUrl: chainId=${chainId}, serverValue=${serverValue ? `<set (length: ${serverValue.length})>` : '<missing>'}, clientValue=${clientValue ? `<set>` : '<missing>'}`);
    } else if (chainId === 84532) {
      serverValue = process.env.AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA;
      clientValue = process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA;
    } else if (chainId === 11155420) {
      serverValue = process.env.AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA;
      clientValue = process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA;
    }

    if (isBrowser) {
      if (clientValue) return clientValue;
    } else {
      // Server: try server env var first, then client env var as fallback
      if (serverValue) return serverValue;
      if (clientValue) return clientValue;
    }

    const envNames = getChainEnvVarNames(chainId);
    const mask = (val?: string) => (val ? '<set>' : '<missing>');
    const expectedVar = isBrowser ? envNames.bundlerClient : envNames.bundlerServer;
    console.error(
      `[chainConfig] Missing bundler URL for chain ${chainId} (${chainConfig.name}). Checked env vars ` +
        `${envNames.bundlerServer}=${mask(serverValue)} ` +
        `and ${envNames.bundlerClient}=${mask(clientValue)}.`,
    );
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
  console.log("isPrivateKeyMode: ", process.env.NEXT_PUBLIC_AGENTIC_TRUST_USE_PRIVATE_KEY);
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_USE_PRIVATE_KEY === 'true';
}

/**
 * Get ENS organization name (accessible from both server and client), chain-specific.
 * Throws if not configured.
 * @param chainId - target chain (defaults to DEFAULT_CHAIN_ID)
 */
export function getEnsOrgName(chainId?: number): string {
  const target = (chainId ?? DEFAULT_CHAIN_ID) as SupportedChainId;
  const chainConfig = CHAIN_CONFIG[target];
  const isBrowser = typeof window !== 'undefined';
  const clientValue = CLIENT_CHAIN_ENS_ORG_NAME_ENV[target];
  if (clientValue) return clientValue;
  // Allow server to also read NEXT_PUBLIC_ value (consistency with RPC logic)
  if (!isBrowser && clientValue) return clientValue;
  const expectedVar = `NEXT_PUBLIC_AGENTIC_TRUST_ENS_ORG_NAME_${chainConfig.suffix}`;
  throw new Error(`Missing required ENS org name for chain ${target} (${chainConfig.name}). Set ${expectedVar}.`);
}

/**
 * Get ENS org address (server-only), chain-specific. Throws if not configured.
 */
export function getEnsOrgAddress(chainId: number): `0x${string}` {
  const target = chainId as SupportedChainId;
  const chainConfig = CHAIN_CONFIG[target];
  const value = SERVER_CHAIN_ENS_ORG_ADDRESS_ENV[target];
  if (value && value.startsWith('0x') && value.length === 42) return value as `0x${string}`;
  const expectedVar = `AGENTIC_TRUST_ENS_ORG_ADDRESS_${chainConfig.suffix}`;
  throw new Error(`Missing required ENS org address for chain ${target} (${chainConfig.name}). Set ${expectedVar}.`);
}

/**
 * Get ENS private key (server-only), chain-specific. Throws if not configured.
 */
export function getEnsPrivateKey(chainId: number): string {
  const target = chainId as SupportedChainId;
  const chainConfig = CHAIN_CONFIG[target];
  const value = SERVER_CHAIN_ENS_PRIVKEY_ENV[target];
  if (value) return value.startsWith('0x') ? value : `0x${value}`;
  const expectedVar = `AGENTIC_TRUST_ENS_PRIVATE_KEY_${chainConfig.suffix}`;
  throw new Error(`Missing required ENS private key for chain ${target} (${chainConfig.name}). Set ${expectedVar}.`);
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
