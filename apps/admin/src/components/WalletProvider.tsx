'use client';

import { useEffect, useState, createContext, useContext, ReactNode } from 'react';
import { connectWallet, getWalletAddress, disconnectWallet, isWalletConnected } from '@/lib/wallet';
import type { Address } from 'viem';

interface WalletContextType {
  connected: boolean;
  address: Address | null;
  loading: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<Address | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Only run on client-side
    if (typeof window === 'undefined') {
      setLoading(false);
      return;
    }

    async function checkConnection() {
      try {
        const isConnected = await isWalletConnected();
        if (isConnected) {
          const addr = await getWalletAddress();
          setAddress(addr);
          setConnected(true);
          
          // Store address in session for server-side use
          // Note: For direct wallet, we can't get private key
          // The server will need to use the wallet's signing capabilities
          if (addr) {
            await fetch('/api/auth/wallet-address', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: addr }),
            });
          }
        }
      } catch (error) {
        console.error('Error checking wallet connection:', error);
      } finally {
        setLoading(false);
      }
    }

    // Add a small delay to ensure window is fully available
    const timer = setTimeout(() => {
      checkConnection();
    }, 100);

    // Listen for account changes
    if (window.ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          setConnected(false);
          setAddress(null);
        } else {
          setAddress(accounts[0] as Address);
          setConnected(true);
        }
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);

      return () => {
        clearTimeout(timer);
        if (window.ethereum) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        }
      };
    }

    return () => clearTimeout(timer);
  }, []);

  async function connect() {
    try {
      setLoading(true);
      const addr = await connectWallet();
      setAddress(addr);
      setConnected(true);
      
      // Store address in session
      await fetch('/api/auth/wallet-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr }),
      });
    } catch (error) {
      console.error('Error connecting wallet:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    try {
      setLoading(true);
      await disconnectWallet();
      
      // Clear session
      await fetch('/api/auth/wallet-address', {
        method: 'DELETE',
      });

      setConnected(false);
      setAddress(null);
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <WalletContext.Provider value={{ connected, address, loading, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

