'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { grayscalePalette as palette } from '@/styles/palette';

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
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit', minWidth: '240px' }}>
          <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 500 }}>
            Agentic Trust
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
                  border: `1px solid ${palette.borderStrong}`,
                  backgroundColor: pathname.startsWith('/admin-tools') ? palette.accent : palette.surfaceMuted,
                  color: pathname.startsWith('/admin-tools') ? palette.surface : palette.textPrimary,
                  fontWeight: 600,
                  fontSize: '0.95rem',
                }}
              >
                Register Agent
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
                    border: `1px solid ${palette.borderStrong}`,
                    backgroundColor: isActive ? palette.accent : palette.surfaceMuted,
                    color: isActive ? palette.surface : palette.textPrimary,
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
                backgroundColor: palette.accent,
                color: palette.surface,
                borderRadius: '999px',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              Server-admin mode
            </div>
          ) : isConnected ? (
            <button
              type="button"
              onClick={onDisconnect}
              style={{
                padding: '0.5rem 1.25rem',
                backgroundColor: palette.accent,
                color: palette.surface,
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Disconnect
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
          )}

          {rightSlot}
        </div>
      </div>
    </header>
  );
}

