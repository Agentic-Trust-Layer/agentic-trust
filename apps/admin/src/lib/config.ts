/**
 * Server-side configuration utilities
 * Access environment variables for admin operations
 */

import { ethers } from 'ethers';

const DEFAULTS = {
  // Sepolia AssociationsStore proxy (upstream AssociatedAccounts deployment)
  associationsStoreProxy: '0x3d282c9E5054E3d819639246C177676A98cB0a1E',
} as const;

/**
 * Get the Associations proxy contract address
 * Defaults to the deployed address on Sepolia
 * Matches the pattern used in other apps: uses ASSOCIATIONS_STORE_PROXY env var
 */
export function getAssociationsProxyAddress(): string {
  const addr = (process.env.ASSOCIATIONS_STORE_PROXY ?? DEFAULTS.associationsStoreProxy).trim();
  return ethers.getAddress(addr);
}

/**
 * Get admin private key from environment
 */
export function getAdminPrivateKey(): string {
  const key = process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY;
  
  if (!key) {
    throw new Error(
      'AGENTIC_TRUST_ADMIN_PRIVATE_KEY or ADMIN_PRIVATE_KEY environment variable is required'
    );
  }
  
  // Normalize to ensure 0x prefix
  return key.startsWith('0x') ? key : `0x${key}`;
}

/**
 * Get Sepolia RPC URL
 */
export function getSepoliaRpcUrl(): string {
  const url =
    process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA ||
    process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA ||
    process.env.AGENTIC_TRUST_RPC_URL ||
    process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL;
  
  if (!url) {
    throw new Error(
      'RPC URL not found. Set AGENTIC_TRUST_RPC_URL_SEPOLIA or AGENTIC_TRUST_RPC_URL'
    );
  }
  
  return url;
}
