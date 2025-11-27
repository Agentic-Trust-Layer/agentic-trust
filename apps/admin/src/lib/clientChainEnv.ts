'use client';

/**
 * Client-side helpers for chain-specific environment variables.
 *
 * These read from NEXT_PUBLIC_* env vars so Next.js can inline them
 * at build time. Avoids dynamic `process.env[...]` access on the client.
 */

const CLIENT_CHAIN_ENV: Record<
  number,
  {
    bundlerUrl?: string;
    rpcUrl?: string;
  }
> = {
  // Sepolia
  11155111: {
    bundlerUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA,
    rpcUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA,
  },
  // Base Sepolia
  84532: {
    bundlerUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA,
    rpcUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA,
  },
  // Optimism Sepolia
  11155420: {
    bundlerUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA,
    rpcUrl: process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA,
  },
};

export function getClientBundlerUrl(chainId: number): string | undefined {
  return CLIENT_CHAIN_ENV[chainId]?.bundlerUrl;
}

export function getClientRpcUrl(chainId: number): string | undefined {
  return CLIENT_CHAIN_ENV[chainId]?.rpcUrl;
}


