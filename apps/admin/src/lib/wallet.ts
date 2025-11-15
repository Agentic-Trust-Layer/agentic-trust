/**
 * Direct Viem-based wallet connection (bypasses Web3Auth)
 * Provides standard MetaMask/EIP-1193 wallet connection
 */

import { createWalletClient, custom, type WalletClient, type Address } from 'viem';
import { sepolia } from 'viem/chains';

// Wallet client instance
let walletClient: WalletClient | null = null;

// Track pending connection request to prevent duplicate requests
let pendingConnectionRequest: Promise<Address> | null = null;

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

  // Store reference to avoid TypeScript issues
  const ethereumProvider = window.ethereum;

  // If there's already a pending connection request, wait for it (with timeout)
  if (pendingConnectionRequest) {
    console.info('A connection request is already pending, waiting for it to complete...');
    try {
      // Wait for the existing pending request to complete
      // Add a timeout to prevent waiting forever
      const address = await Promise.race([
        pendingConnectionRequest,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Connection request timeout')), 35000)
        ),
      ]);
      return address;
    } catch (error: any) {
      // If the pending request failed or timed out, clear it
      pendingConnectionRequest = null;
      
      // Check if wallet might have connected anyway (user approved while we waited)
      try {
        const accounts = await ethereumProvider.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
          const address = accounts[0] as Address;
          walletClient = createWalletClient({
            account: address,
            chain: sepolia,
            transport: custom(ethereumProvider),
          });
          return address;
        }
      } catch (checkError) {
        // Wallet not connected, continue to make a new request
      }
      
      // If the error was about timeout or pending request, continue to try a new request
      // Otherwise, re-throw the error
      if (!error?.message?.includes('timeout') && !error?.message?.includes('pending')) {
        throw error;
      }
      // Continue to make a new request
    }
  }

  // First, try to get accounts without requesting (in case already connected)
  try {
    const existingAccounts = await ethereumProvider.request({ method: 'eth_accounts' });
    if (existingAccounts && existingAccounts.length > 0) {
      const address = existingAccounts[0] as Address;
      // Create wallet client with existing connection
      walletClient = createWalletClient({
        account: address,
        chain: sepolia,
        transport: custom(ethereumProvider),
      });
      return address;
    }
  } catch (error) {
    // If eth_accounts fails, continue to request access
    console.warn('Failed to get existing accounts, requesting access:', error);
  }

  // Create a promise for the connection request
  pendingConnectionRequest = (async () => {
    try {
      // Request account access
      const accounts = await ethereumProvider.request({ method: 'eth_requestAccounts' });
      
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found. Please unlock your wallet.');
      }

      const address = accounts[0] as Address;

      // Create wallet client
      walletClient = createWalletClient({
        account: address,
        chain: sepolia,
        transport: custom(ethereumProvider),
      });

      return address;
    } catch (error: any) {
      // Handle specific error codes
      if (error?.code === -32002) {
        // Request already pending - this means MetaMask is showing a popup
        // Wait and poll for the connection instead of throwing immediately
        console.info('Wallet connection request pending, waiting for user approval...');
        
        // Wait a bit longer for the user to approve
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Poll for connection (check every 500ms, up to 30 seconds)
        const maxAttempts = 60; // 60 attempts * 500ms = 30 seconds
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const accounts = await ethereumProvider.request({ method: 'eth_accounts' });
            if (accounts && accounts.length > 0) {
              const address = accounts[0] as Address;
              walletClient = createWalletClient({
                account: address,
                chain: sepolia,
                transport: custom(ethereumProvider),
              });
              return address;
            }
          } catch (pollError) {
            // Continue polling
          }
          
          // Wait before next poll
          if (attempt < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // If we get here, the user didn't approve or rejected after 30 seconds
        // Don't throw an error - just return null or let the user try again
        // The user might still be in the process of approving
        console.warn('Wallet connection polling timeout - user may still be approving request');
        throw new Error(
          'Connection request is pending in your wallet. Please check your MetaMask extension and approve the connection request. You can try again after approving.'
        );
      }
      // Re-throw other errors
      throw error;
    } finally {
      // Clear pending request when done (success or failure)
      pendingConnectionRequest = null;
    }
  })();

  return pendingConnectionRequest;
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
  
  // Attempt to revoke permissions so MetaMask shows as disconnected
  if (typeof window !== 'undefined' && window.ethereum?.request) {
    try {
      await window.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
      // Verify revocation by triggering accounts check
      await window.ethereum.request({ method: 'eth_accounts' });
    } catch (error) {
      console.warn('Unable to revoke wallet permissions (disconnect). User may need to disconnect manually.', error);
    }
  }
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

