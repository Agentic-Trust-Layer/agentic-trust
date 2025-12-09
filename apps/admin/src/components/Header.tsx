'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { useCallback, useMemo, useState, useEffect, type ReactNode } from 'react';
import { grayscalePalette as palette } from '@/styles/palette';

const NAV_ITEMS = [
  { href: '/agents', label: 'Agents' },
  { href: '/agent-discovery', label: 'Agent Discovery' },
  { href: '/stats', label: 'Stats' },
];

type HeaderProps = {
  displayAddress?: string | null;
  privateKeyMode: boolean;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void | Promise<void>;
  disableConnect?: boolean;
  rightSlot?: ReactNode;
};

export function Header({
  displayAddress,
  privateKeyMode,
  isConnected,
  onConnect,
  onDisconnect,
  disableConnect,
  rightSlot,
}: HeaderProps) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [graphLoading, setGraphLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [navigatingToRegistration, setNavigatingToRegistration] = useState(false);

  const shortAddress = useMemo(() => {
    if (!displayAddress || displayAddress.length < 10) return displayAddress ?? '';
    return `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}`;
  }, [displayAddress]);

  const canRequestGraphql = Boolean(displayAddress);

  // detect mobile width
  useEffect(() => {
    const onResize = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth <= 640);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const graphiqlFallback = useMemo(() => {
    const candidates = [
      process.env.NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_URL,
      process.env.AGENTIC_TRUST_DISCOVERY_URL,
      process.env.NEXT_PUBLIC_GRAPHQL_API_URL,
      process.env.GRAPHQL_API_URL,
    ];
    const raw = candidates.find(value => typeof value === 'string' && value?.trim());
    if (!raw) {
      return 'https://agentictrust.io/graphiql';
    }
    return raw
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/(graphql|graphiql)\/?$/i, '/graphiql');
  }, []);

  const navItems = useMemo(() => {
    if (isMobile) {
      return NAV_ITEMS.filter(item => item.href !== '/stats');
    }
    return NAV_ITEMS;
  }, [isMobile]);

  const handleOpenGraphQL = useCallback(async () => {
    if (!displayAddress) {
      alert('Connect a wallet or log in to open the GraphQL explorer.');
      return;
    }
    setGraphLoading(true);
    try {
      const response = await fetch('/api/getAccessCode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: displayAddress }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof payload?.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : 'Failed to fetch GraphQL access code.';
        throw new Error(message);
      }

      const accessCode = typeof payload?.accessCode === 'string' ? payload.accessCode.trim() : '';
      if (!accessCode) {
        throw new Error('GraphQL access code was not returned by the server.');
      }

      const graphiqlUrl =
        typeof payload?.graphiqlUrl === 'string' && payload.graphiqlUrl.trim().length > 0
          ? payload.graphiqlUrl.trim()
          : graphiqlFallback;

      const target = `${graphiqlUrl.replace(/\/+$/, '')}?accessCode=${encodeURIComponent(
        accessCode,
      )}`;
      window.open(target, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('[Header] Failed to open GraphQL explorer', error);
      alert(error instanceof Error ? error.message : 'Unable to open GraphQL explorer.');
    } finally {
      setGraphLoading(false);
    }
  }, [displayAddress, graphiqlFallback]);

  return (
    <>
    <header
      style={{
        padding: '0.9rem 2rem 1.3rem',
        borderBottom: `1px solid ${palette.border}`,
        backgroundColor: palette.surface,
        color: palette.textPrimary,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            href="/"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              minWidth: isMobile ? '160px' : '240px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <Image
              src="/8004Agent.png"
              alt="Agentic Trust Community"
              width={64}
              height={64}
              style={{
                height: isMobile ? 40 : 48,
                width: 'auto',
                objectFit: 'cover',
              }}
              priority
            />
            <h1
              style={{
                margin: 0,
                fontSize: isMobile ? '1.35rem' : '2rem',
                fontWeight: 500,
              }}
            >
              Agentic Trust Community
            </h1>
          </Link>
          {!isMobile && (
          <button
            type="button"
            onClick={handleOpenGraphQL}
            disabled={!canRequestGraphql || graphLoading}
            style={{
              padding: '0.4rem 1rem',
              borderRadius: '999px',
              border: `1px solid ${palette.borderStrong}`,
              backgroundColor: canRequestGraphql && !graphLoading ? palette.surfaceMuted : palette.border,
              color: palette.textPrimary,
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: canRequestGraphql && !graphLoading ? 'pointer' : 'not-allowed',
              opacity: canRequestGraphql && !graphLoading ? 1 : 0.6,
            }}
            title={
              canRequestGraphql
                ? 'Open Agentic Trust Community GraphQL explorer'
                : 'Connect to request a GraphQL access code'
            }
          >
            {graphLoading ? 'Opening…' : 'GraphQL'}
          </button>
          )}
        </div>

        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >

          
          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            {isConnected && (
              <button
                onClick={async () => {
                  setNavigatingToRegistration(true);
                  router.push('/agent-registration');
                  // Keep loading state for a short time to show spinner
                  setTimeout(() => setNavigatingToRegistration(false), 1000);
                }}
                disabled={navigatingToRegistration}
                style={{
                  textDecoration: 'none',
                  padding: isMobile ? '0.45rem 0.9rem' : '0.45rem 1.25rem',
                  borderRadius: '999px',
                  border: `1px solid ${palette.borderStrong}`,
                  backgroundColor: pathname.startsWith('/agent-registration') ? palette.accent : palette.surfaceMuted,
                  color: pathname.startsWith('/agent-registration') ? palette.surface : palette.textPrimary,
                  fontWeight: 600,
                  fontSize: isMobile ? '0.9rem' : '0.95rem',
                  cursor: navigatingToRegistration ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  opacity: navigatingToRegistration ? 0.7 : 1,
                }}
              >
                {navigatingToRegistration && (
                  <div
                    style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid currentColor',
                      borderTop: '2px solid transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                )}
                {isMobile ? 'Register' : 'Agent Registration'}
              </button>
            )}
            {navItems.map(item => {
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    textDecoration: 'none',
                    padding: isMobile ? '0.45rem 0.9rem' : '0.45rem 1.25rem',
                    borderRadius: '999px',
                    border: `1px solid ${palette.borderStrong}`,
                    backgroundColor: isActive ? palette.accent : palette.surfaceMuted,
                    color: isActive ? palette.surface : palette.textPrimary,
                    fontWeight: 600,
                    fontSize: isMobile ? '0.9rem' : '0.95rem',
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {privateKeyMode ? (
            <div
              style={{
                padding: isMobile ? '0.35rem 0.75rem' : '0.45rem 1rem',
                backgroundColor: palette.accent,
                color: palette.surface,
                borderRadius: '999px',
                fontSize: isMobile ? '0.8rem' : '0.85rem',
                fontWeight: 600,
              }}
            >
              Server-admin mode
            </div>
          ) : isConnected ? (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowAccountMenu(prev => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: isMobile ? '0.35rem 0.9rem' : '0.45rem 1.2rem',
                  backgroundColor: palette.surfaceMuted,
                  color: palette.textPrimary,
                  borderRadius: '999px',
                  border: `1px solid ${palette.borderStrong}`,
                  fontWeight: 600,
                  fontSize: isMobile ? '0.85rem' : '0.9rem',
                  cursor: 'pointer',
                  minWidth: isMobile ? undefined : '180px',
                  justifyContent: isMobile ? 'center' : 'flex-start',
                }}
                title={displayAddress || 'Connected wallet'}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '999px',
                    backgroundColor: '#22c55e',
                  }}
                />
                <span style={{ fontFamily: 'monospace' }}>
                  {shortAddress || 'Connected'}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>▾</span>
              </button>
              {showAccountMenu && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    marginTop: '0.4rem',
                    backgroundColor: palette.surface,
                    borderRadius: '10px',
                    border: `1px solid ${palette.border}`,
                    boxShadow: '0 10px 25px rgba(15,23,42,0.35)',
                    minWidth: '200px',
                    zIndex: 20,
                    overflow: 'hidden',
                  }}
                >
                  {displayAddress && (
                    <div
                      style={{
                        padding: '0.6rem 0.85rem',
                        borderBottom: `1px solid ${palette.border}`,
                        fontSize: '0.8rem',
                        color: palette.textSecondary,
                        wordBreak: 'break-all',
                        fontFamily: 'monospace',
                        backgroundColor: palette.surfaceMuted,
                      }}
                    >
                      {displayAddress}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowAccountMenu(false);
                      void onDisconnect();
                    }}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.85rem',
                      backgroundColor: 'transparent',
                      border: 'none',
                      textAlign: 'left',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      color: palette.dangerText,
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            isMobile ? (
              <button
                onClick={onConnect}
                aria-label="Connect"
                title="Connect"
                disabled={disableConnect}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '999px',
                  border: `1px solid ${palette.borderStrong}`,
                  backgroundColor: disableConnect ? palette.borderStrong : palette.accent,
                  color: palette.surface,
                  fontWeight: 700,
                  cursor: disableConnect ? 'not-allowed' : 'pointer',
                  opacity: disableConnect ? 0.7 : 1,
                }}
              >
                🔌
              </button>
            ) : (
              <button
                onClick={onConnect}
                disabled={disableConnect}
                style={{
                  padding: '0.5rem 1.5rem',
                  backgroundColor: disableConnect ? palette.borderStrong : palette.accent,
                  color: palette.surface,
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  cursor: disableConnect ? 'not-allowed' : 'pointer',
                  opacity: disableConnect ? 0.7 : 1,
                }}
              >
                Connect
              </button>
            )
          )}

          {rightSlot}
        </div>
      </div>
    </header>
    <style>{`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}    </style>
    </>
  );
}

