'use client';

import Link from 'next/link';
import { grayscalePalette as palette } from '@/styles/palette';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';

export default function EnsLandingPage() {
  const auth = useAuth();

  return (
    <>
      <Header
        displayAddress={auth.walletAddress ?? null}
        privateKeyMode={auth.privateKeyMode}
        isConnected={auth.isConnected}
        onConnect={auth.openLoginModal}
        onDisconnect={auth.handleDisconnect}
        disableConnect={auth.loading}
      />

      <main style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: '1.6rem' }}>ENS</h1>
        <p style={{ marginTop: '0.5rem', color: palette.textSecondary }}>
          Debug/inspect agent ENS records.
        </p>

        <div style={{ marginTop: '1.25rem', display: 'grid', gridTemplateColumns: '1fr', gap: '0.9rem' }}>
          <Link
            href="/ens/details"
            style={{
              textDecoration: 'none',
              border: `1px solid ${palette.border}`,
              borderRadius: 12,
              padding: '1rem',
              backgroundColor: palette.surface,
              color: palette.textPrimary,
              display: 'block',
            }}
          >
            <div style={{ fontWeight: 900 }}>ENS Details</div>
            <div style={{ marginTop: '0.25rem', color: palette.textSecondary, fontSize: '0.95rem' }}>
              Uses core client lookup + best-effort identity.
            </div>
          </Link>

          <Link
            href="/ens/linea"
            style={{
              textDecoration: 'none',
              border: `1px solid ${palette.border}`,
              borderRadius: 12,
              padding: '1rem',
              backgroundColor: palette.surface,
              color: palette.textPrimary,
              display: 'block',
            }}
          >
            <div style={{ fontWeight: 900 }}>ENS Agent View</div>
            <div style={{ marginTop: '0.25rem', color: palette.textSecondary, fontSize: '0.95rem' }}>
              Direct ENS client reads (useful for L2 / Linea).
            </div>
          </Link>
        </div>
      </main>
    </>
  );
}

