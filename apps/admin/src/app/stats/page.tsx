'use client';

// Avoid static prerendering for this route to speed up `next build` page-data collection.
export const dynamic = 'force-dynamic';

import React from 'react';

import { Header } from '@/components/Header';
import { StatsPage } from '@/components/StatsPage';
import { useAuth } from '@/components/AuthProvider';

export default function StatsRoute() {
  const {
    isConnected,
    privateKeyMode,
    loading,
    walletAddress,
    openLoginModal,
    handleDisconnect,
  } = useAuth();

  return (
    <>
      <Header
        displayAddress={walletAddress ?? null}
        privateKeyMode={privateKeyMode}
        isConnected={isConnected}
        onConnect={openLoginModal}
        onDisconnect={handleDisconnect}
        disableConnect={loading}
      />
      <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <StatsPage />
      </main>
    </>
  );
}

