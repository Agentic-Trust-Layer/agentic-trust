'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useWeb3Auth } from './Web3AuthProvider';
import { useWallet } from './WalletProvider';
import { LoginModal } from './HomePage';

type AuthContextValue = {
  isConnected: boolean;
  privateKeyMode: boolean;
  loading: boolean;
  walletAddress: string | null;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  handleDisconnect: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const web3AuthCtx = useWeb3Auth() as any;
  const { disconnect: web3AuthDisconnect } = web3AuthCtx || {};
  const {
    connected: eoaConnected,
    address: eoaAddress,
    privateKeyMode,
    loading,
    disconnect: walletDisconnect,
  } = useWallet();

  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    if ((eoaConnected || privateKeyMode) && showLoginModal) {
      setShowLoginModal(false);
    }
  }, [eoaConnected, privateKeyMode, showLoginModal]);

  const handleDisconnect = useCallback(async () => {
    try {
      await web3AuthDisconnect?.();
    } catch {
      // ignore
    }
    try {
      await walletDisconnect();
    } catch {
      // ignore
    }
    if (privateKeyMode) {
      try {
        await fetch('/api/auth/session', { method: 'DELETE' });
        window.location.reload();
      } catch (error) {
        console.error('Error clearing session:', error);
      }
    }
  }, [privateKeyMode, walletDisconnect, web3AuthDisconnect]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isConnected: Boolean(eoaConnected),
      privateKeyMode,
      loading,
      walletAddress: eoaAddress ?? null,
      openLoginModal: () => setShowLoginModal(true),
      closeLoginModal: () => setShowLoginModal(false),
      handleDisconnect,
    }),
    [eoaConnected, privateKeyMode, loading, eoaAddress, handleDisconnect],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {showLoginModal && !privateKeyMode && (
        <LoginModal onClose={() => setShowLoginModal(false)} />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}


