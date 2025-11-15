'use client';

import { useState } from 'react';
import { useWeb3Auth } from './Web3AuthProvider';
import { useWallet } from './WalletProvider';
import { grayscalePalette as palette } from '@/styles/palette';

const neutralButtonStyle = (disabled?: boolean) => ({
  padding: '1rem',
  backgroundColor: disabled ? palette.accentMuted : palette.accent,
  color: palette.surface,
  border: `1px solid ${palette.borderStrong}`,
  borderRadius: '8px',
  fontSize: '1rem',
  fontWeight: 'bold',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.65 : 1,
});

type LoginModalProps = {
  onClose?: () => void;
};

export function LoginModal({ onClose }: LoginModalProps) {
  const { connect, loading } = useWeb3Auth();
  const {
    connect: walletConnect,
    connected: walletConnected,
    loading: walletLoading,
  } = useWallet();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSocialLogin = async (
    provider: 'google' | 'facebook' | 'twitter' | 'github',
  ) => {
    try {
      setConnecting(true);
      setError(null);
      await connect('social', provider);
      // Provider will clear connecting when it finishes routing.
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to connect';
      if (!errorMessage.toLowerCase().includes('cancelled')) {
        setError(errorMessage);
      }
      setConnecting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          position: 'relative',
          padding: '3rem',
          backgroundColor: palette.surface,
          borderRadius: '12px',
          border: `1px solid ${palette.border}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          maxWidth: '500px',
          width: '100%',
        }}
      >
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '1rem',
              right: '1rem',
              border: 'none',
              background: 'transparent',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: palette.textMuted,
            }}
            aria-label="Close login modal"
          >
            ×
          </button>
        )}

        <h1
          style={{
            marginBottom: '2rem',
            fontSize: '2rem',
            fontWeight: 'bold',
            textAlign: 'center',
          }}
        >
          Agent Trust Admin Login
        </h1>

        {error && (
          <div
            style={{
              marginBottom: '1.5rem',
              padding: '1rem',
              backgroundColor: palette.dangerSurface,
              borderRadius: '4px',
              color: palette.dangerText,
              border: `1px solid ${palette.borderStrong}`,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <button
            onClick={() => handleSocialLogin('google')}
            disabled={loading || connecting}
            style={neutralButtonStyle(loading || connecting)}
          >
            {connecting ? 'Connecting...' : 'Continue with Google'}
          </button>

          <button
            onClick={() => handleSocialLogin('github')}
            disabled={loading || connecting}
            style={neutralButtonStyle(loading || connecting)}
          >
            {connecting ? 'Connecting...' : 'Continue with GitHub'}
          </button>

          <button
            onClick={() => handleSocialLogin('twitter')}
            disabled={loading || connecting}
            style={neutralButtonStyle(loading || connecting)}
          >
            {connecting ? 'Connecting...' : 'Continue with Twitter'}
          </button>

          <button
            onClick={() => handleSocialLogin('facebook')}
            disabled={loading || connecting}
            style={neutralButtonStyle(loading || connecting)}
          >
            {connecting ? 'Connecting...' : 'Continue with Facebook'}
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              margin: '1rem 0',
            }}
          >
            <div
              style={{ flex: 1, height: '1px', backgroundColor: palette.border }}
            />
            <span style={{ color: palette.textMuted }}>OR</span>
            <div
              style={{ flex: 1, height: '1px', backgroundColor: palette.border }}
            />
          </div>

          <button
            onClick={async () => {
              try {
                setConnecting(true);
                setError(null);
                await walletConnect();
                setConnecting(false);
              } catch (err) {
                const errorMessage =
                  err instanceof Error
                    ? err.message
                    : 'Failed to connect wallet';
                setError(errorMessage);
                setConnecting(false);
              }
            }}
            disabled={walletLoading || connecting || walletConnected}
            style={neutralButtonStyle(walletLoading || connecting || walletConnected)}
          >
            {walletConnected
              ? 'Wallet Connected'
              : walletLoading || connecting
              ? 'Connecting...'
              : 'Connect Direct Wallet'}
          </button>
        </div>

        <p
          style={{
            marginTop: '2rem',
            fontSize: '0.85rem',
            color: palette.textMuted,
            textAlign: 'center',
          }}
        >
          Secure authentication powered by Web3Auth or direct wallet connection
        </p>
      </div>
    </div>
  );
}

type HomePageProps = {
  onNavigateAgents: () => void;
  onOpenAdminTools?: () => void;
  isConnected?: boolean;
};

export function HomePage({ onNavigateAgents, onOpenAdminTools, isConnected }: HomePageProps) {
  return (
    <section
      style={{
        padding: '3rem',
        background: 'linear-gradient(135deg, #f6f6f6, #e7e7e7)',
        borderRadius: '24px',
        border: `1px solid ${palette.border}`,
        boxShadow: '0 24px 60px rgba(15,23,42,0.12)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '2rem',
          alignItems: 'center',
        }}
      >
        <div>
          <p
            style={{
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: palette.textMuted,
              fontWeight: 700,
              marginBottom: '0.75rem',
            }}
          >
            Agentic Trust Layer
          </p>
          <h2
            style={{
              fontSize: '2.75rem',
              margin: 0,
              color: palette.textPrimary,
              lineHeight: 1.2,
            }}
          >
            On-chain identity tooling for ERC-8004 agents.
          </h2>
          <p style={{ marginTop: '1rem', fontSize: '1.1rem', color: palette.textSecondary }}>
            Register, discover, and manage AI agents with verifiable ownership,
            ENS integration, and cross-chain support. This console exposes the
            same primitives that power the public Agent Explorer.
          </p>
          <div
            style={{
              marginTop: '1.5rem',
              display: 'flex',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
        <button
              onClick={onNavigateAgents}
              style={{
                padding: '0.9rem 2rem',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: palette.accent,
                color: palette.surface,
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
          Get Started Exploring
            </button>
            {isConnected && onOpenAdminTools && (
              <button
                onClick={onOpenAdminTools}
                style={{
                  padding: '0.9rem 2rem',
                  borderRadius: '999px',
                  border: `1px solid ${palette.borderStrong}`,
                  backgroundColor: palette.surface,
                  color: palette.textPrimary,
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Create Agent
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            backgroundColor: palette.surface,
            borderRadius: '20px',
            padding: '1.5rem',
            border: `1px solid ${palette.border}`,
            boxShadow: '0 16px 40px rgba(15,23,42,0.08)',
          }}
        >
          <h3
            style={{
              marginTop: 0,
              marginBottom: '1rem',
              color: palette.textPrimary,
              fontSize: '1.25rem',
            }}
          >
            What you can do here
          </h3>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              color: palette.textSecondary,
            }}
          >
            <li>• Mint ERC-8004 agents with deterministic AA or EOA accounts.</li>
            <li>• Assign ENS subdomains and manage discovery metadata.</li>
            <li>• Query the discovery indexer with structured filters.</li>
            <li>• Transfer, refresh, and audit agent data across chains.</li>
          </ul>
          <div
            style={{
              marginTop: '1.25rem',
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              color: palette.textSecondary,
              fontSize: '0.95rem',
            }}
          >
            <span>Need full admin access?</span>
            <a
              href="/admin-tools?mode=create"
              style={{
                color: palette.accent,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Open the Admin Tools console →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

