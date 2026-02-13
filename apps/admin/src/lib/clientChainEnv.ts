'use client';

/**
 * Client-side helpers for chain-specific environment variables.
 *
 * These read from NEXT_PUBLIC_* env vars so Next.js can inline them
 * at build time. Avoids dynamic `process.env[...]` access on the client.
 */

type ClientChainEnv = {
  bundlerUrl?: string;
  rpcUrl?: string;
  identityRegistry?: `0x${string}`;
  reputationRegistry?: `0x${string}`;
  validationRegistry?: `0x${string}`;
};

const DEFAULT_CHAIN_ENV: ClientChainEnv = {
  bundlerUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL,
  rpcUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL,
  identityRegistry: process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY as `0x${string}` | undefined,
  reputationRegistry: process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY as `0x${string}` | undefined,
  validationRegistry: process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY as `0x${string}` | undefined,
};

const CHAIN_SPECIFIC_ENV: Record<number, ClientChainEnv> = {
  11155111: {
    bundlerUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA ?? DEFAULT_CHAIN_ENV.bundlerUrl,
    rpcUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA ?? DEFAULT_CHAIN_ENV.rpcUrl,
    identityRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA ??
      DEFAULT_CHAIN_ENV.identityRegistry) as `0x${string}` | undefined,
    reputationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA ??
      DEFAULT_CHAIN_ENV.reputationRegistry) as `0x${string}` | undefined,
    validationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_SEPOLIA ??
      DEFAULT_CHAIN_ENV.validationRegistry) as `0x${string}` | undefined,
  },
  84532: {
    bundlerUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA ?? DEFAULT_CHAIN_ENV.bundlerUrl,
    rpcUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA ?? DEFAULT_CHAIN_ENV.rpcUrl,
    identityRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_BASE_SEPOLIA ??
      DEFAULT_CHAIN_ENV.identityRegistry) as `0x${string}` | undefined,
    reputationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_BASE_SEPOLIA ??
      DEFAULT_CHAIN_ENV.reputationRegistry) as `0x${string}` | undefined,
    validationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_BASE_SEPOLIA ??
      DEFAULT_CHAIN_ENV.validationRegistry) as `0x${string}` | undefined,
  },
  11155420: {
    bundlerUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA ?? DEFAULT_CHAIN_ENV.bundlerUrl,
    rpcUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA ?? DEFAULT_CHAIN_ENV.rpcUrl,
    identityRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_OPTIMISM_SEPOLIA ??
      DEFAULT_CHAIN_ENV.identityRegistry) as `0x${string}` | undefined,
    reputationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_OPTIMISM_SEPOLIA ??
      DEFAULT_CHAIN_ENV.reputationRegistry) as `0x${string}` | undefined,
    validationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_OPTIMISM_SEPOLIA ??
      DEFAULT_CHAIN_ENV.validationRegistry) as `0x${string}` | undefined,
  },
  59144: {
    bundlerUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_LINEA ?? DEFAULT_CHAIN_ENV.bundlerUrl,
    rpcUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_LINEA ?? DEFAULT_CHAIN_ENV.rpcUrl,
    identityRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_LINEA ??
      DEFAULT_CHAIN_ENV.identityRegistry) as `0x${string}` | undefined,
    reputationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_LINEA ??
      DEFAULT_CHAIN_ENV.reputationRegistry) as `0x${string}` | undefined,
    validationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_LINEA ??
      DEFAULT_CHAIN_ENV.validationRegistry) as `0x${string}` | undefined,
  },
  59141: {
    bundlerUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_LINEA_SEPOLIA ?? DEFAULT_CHAIN_ENV.bundlerUrl,
    rpcUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_LINEA_SEPOLIA ?? DEFAULT_CHAIN_ENV.rpcUrl,
    identityRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_LINEA_SEPOLIA ??
      DEFAULT_CHAIN_ENV.identityRegistry) as `0x${string}` | undefined,
    reputationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_LINEA_SEPOLIA ??
      DEFAULT_CHAIN_ENV.reputationRegistry) as `0x${string}` | undefined,
    validationRegistry: (process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_LINEA_SEPOLIA ??
      DEFAULT_CHAIN_ENV.validationRegistry) as `0x${string}` | undefined,
  },
};

export function getClientChainEnv(chainId: number): ClientChainEnv {
  return {
    ...DEFAULT_CHAIN_ENV,
    ...CHAIN_SPECIFIC_ENV[chainId],
  };
}

export function getClientBundlerUrl(chainId: number): string | undefined {
  return getClientChainEnv(chainId).bundlerUrl;
}

export function getClientRpcUrl(chainId: number): string | undefined {
  return getClientChainEnv(chainId).rpcUrl;
}

export function getClientRegistryAddresses(chainId: number): {
  identityRegistry?: `0x${string}`;
  reputationRegistry?: `0x${string}`;
  validationRegistry?: `0x${string}`;
} {
  const { identityRegistry, reputationRegistry, validationRegistry } = getClientChainEnv(chainId);
  return { identityRegistry, reputationRegistry, validationRegistry };
}

