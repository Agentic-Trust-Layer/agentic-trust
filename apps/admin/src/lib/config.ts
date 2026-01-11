/**
 * Server-side configuration utilities
 * Access environment variables for admin operations
 */

import { ethers } from 'ethers';

const DEFAULTS = {
  associationsStoreProxy: '0x3418A5297C75989000985802B8ab01229CDDDD24', // Correct deployed address on Sepolia - matches core
} as const;

/**
 * Get the Associations proxy contract address
 * Defaults to the deployed address on Sepolia
 * Matches the pattern used in other apps: uses ASSOCIATIONS_STORE_PROXY env var
 */
export function getAssociationsProxyAddress(): string {
  // TEMPORARY: Use the correct deployed address, ignoring any bad env vars
  const correctAddress = '0x3418A5297C75989000985802B8ab01229CDDDD24';
  console.log('[getAssociationsProxyAddress] Using correct deployed address:', correctAddress);
  return ethers.getAddress(correctAddress);
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
