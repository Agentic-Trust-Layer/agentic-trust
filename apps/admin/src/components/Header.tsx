'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/agents', label: 'Agents' },
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

  return (
    <header
      style={{
        padding: '1.5rem 2rem',
        borderBottom: '1px solid #e2e8f0',
        backgroundColor: '#fff',
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
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit', minWidth: '240px' }}>
          <p
            style={{
              margin: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontSize: '0.8rem',
              color: '#94a3b8',
            }}
          >
            OrgTrust.eth
          </p>
          <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800 }}>
            Agent Explorer
          </h1>
        </Link>

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
              <Link
                href="/admin-tools?mode=create"
                style={{
                  textDecoration: 'none',
                  padding: '0.45rem 1.25rem',
                  borderRadius: '999px',
                  border: '1px solid #cbd5f5',
                  backgroundColor: pathname.startsWith('/admin-tools') ? '#1d4ed8' : '#f8fafc',
                  color: pathname.startsWith('/admin-tools') ? '#fff' : '#1e293b',
                  fontWeight: 600,
                  fontSize: '0.95rem',
                }}
              >
                Create Agent
              </Link>
            )}
            {NAV_ITEMS.map(item => {
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
                    padding: '0.45rem 1.25rem',
                    borderRadius: '999px',
                    border: '1px solid #cbd5f5',
                    backgroundColor: isActive ? '#1d4ed8' : '#f8fafc',
                    color: isActive ? '#fff' : '#1e293b',
                    fontWeight: 600,
                    fontSize: '0.95rem',
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
                padding: '0.45rem 1rem',
                backgroundColor: '#0f172a',
                color: '#fff',
                borderRadius: '999px',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              Server-admin mode
            </div>
          ) : isConnected ? (
            <div style={{ position: 'relative' }} className="account-dropdown">
              <details>
                <summary
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: '0.45rem 0.9rem',
                    borderRadius: '999px',
                    border: '1px solid #94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    backgroundColor: '#f8fafc',
                    fontWeight: 600,
                  }}
                >
                  <span style={{ fontSize: '0.85rem', color: '#059669' }}>Connected</span>
                  <span style={{ fontFamily: 'monospace', color: '#1f2937' }}>
                    {displayAddress ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}` : ''}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#475569' }}>▾</span>
                </summary>
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    marginTop: '0.5rem',
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.1)',
                    minWidth: '220px',
                    zIndex: 5,
                    padding: '0.75rem 1rem',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Connected
                  </p>
                  <p style={{ margin: '0.35rem 0 0.75rem', fontFamily: 'monospace', fontSize: '0.9rem', color: '#0f172a' }}>
                    {displayAddress ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}` : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (displayAddress) {
                        navigator.clipboard.writeText(displayAddress).catch(() => {});
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      backgroundColor: '#f8fafc',
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Copy Address
                  </button>
                  <a
                    href={displayAddress ? `https://etherscan.io/address/${displayAddress}` : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      textAlign: 'center',
                      padding: '0.5rem',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      backgroundColor: '#f8fafc',
                      fontWeight: 600,
                      color: '#1d4ed8',
                      textDecoration: 'none',
                      marginBottom: '0.5rem',
                    }}
                  >
                    View on Explorer
                  </a>
                  <button
                    type="button"
                    onClick={onDisconnect}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: '#dc2626',
                      color: '#fff',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </details>
            </div>
          ) : (
            <button
              onClick={onConnect}
              disabled={disableConnect}
              style={{
                padding: '0.5rem 1.5rem',
                backgroundColor: disableConnect ? '#93c5fd' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: disableConnect ? 'not-allowed' : 'pointer',
                opacity: disableConnect ? 0.7 : 1,
              }}
            >
              Connect
            </button>
          )}

          {rightSlot}
        </div>
      </div>
    </header>
  );
}

