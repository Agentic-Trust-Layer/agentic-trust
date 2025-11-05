/**
 * Direct Viem-based wallet connection (bypasses Web3Auth)
 * Provides standard MetaMask/EIP-1193 wallet connection
 */

import { createWalletClient, custom, type WalletClient, type Address } from 'viem';
import { sepolia } from 'viem/chains';

// Wallet client instance
let walletClient: WalletClient | null = null;

/**
 * Connect to MetaMask or other EIP-1193 wallet
 */
export async function connectWallet(): Promise<Address> {
  if (typeof window === 'undefined') {
    throw new Error('Wallet connection can only be used on the client-side');
  }

  // Check if ethereum provider is available
  if (!window.ethereum) {
    throw new Error('No Ethereum wallet found. Please install MetaMask or another Web3 wallet.');
  }

  // Request account access
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts found. Please unlock your wallet.');
  }

  const address = accounts[0] as Address;

  // Create wallet client
  walletClient = createWalletClient({
    account: address,
    chain: sepolia,
    transport: custom(window.ethereum),
  });

  return address;
}

/**
 * Get the connected wallet address
 */
export async function getWalletAddress(): Promise<Address | null> {
  if (typeof window === 'undefined' || !window.ethereum) {
    return null;
  }

  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) {
      return accounts[0] as Address;
    }
  } catch (error) {
    console.error('Error getting wallet address:', error);
  }

  return null;
}

/**
 * Disconnect wallet
 */
export async function disconnectWallet(): Promise<void> {
  walletClient = null;
  
  // Note: EIP-1193 doesn't have a standard disconnect method
  // The wallet client is just cleared from memory
  // The browser extension connection remains active
}

/**
 * Check if wallet is connected
 */
export async function isWalletConnected(): Promise<boolean> {
  const address = await getWalletAddress();
  return address !== null;
}

/**
 * Get the wallet client instance
 */
export function getWalletClient(): WalletClient | null {
  return walletClient;
}

// Extend Window interface for ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, handler: (...args: any[]) => void) => void;
      removeListener: (event: string, handler: (...args: any[]) => void) => void;
      isMetaMask?: boolean;
    };
  }
}

