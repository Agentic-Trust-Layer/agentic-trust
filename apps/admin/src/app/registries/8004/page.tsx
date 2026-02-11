'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { grayscalePalette as palette } from '@/styles/palette';

type RegistryRow = {
  ecosystem: 'Ethereum' | 'Base' | 'Linea';
  network: 'Mainnet' | 'Testnet';
  chainId: number;
  identityRegistry?: string | null;
  reputationRegistry?: string | null;
  validationRegistry?: string | null;
};

function normalizeAddr(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (!v.startsWith('0x')) return v;
  if (v.length !== 42) return v;
  return v;
}

function renderAddr(addr: string | null | undefined) {
  const safe = normalizeAddr(addr);
  return (
    <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', userSelect: 'text' }}>
      {safe ?? '—'}
    </span>
  );
}

export default function Registries8004Page() {
  const {
    isConnected,
    privateKeyMode,
    loading,
    walletAddress,
    openLoginModal,
    handleDisconnect,
  } = useAuth();

  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setRowsLoading(true);
    setRowsError(null);
    (async () => {
      try {
        const res = await fetch('/api/registries/8004', { cache: 'no-store', signal: controller.signal });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          throw new Error(json?.message || json?.error || `Failed to load registries (${res.status})`);
        }
        const nextRows = Array.isArray(json?.registries) ? (json.registries as RegistryRow[]) : [];
        if (!cancelled) setRows(nextRows);
      } catch (e) {
        if (cancelled) return;
        setRows([]);
        setRowsError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setRowsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const grouped = useMemo(() => {
    const out: Record<string, RegistryRow[]> = {};
    for (const r of rows) {
      const key = r.ecosystem;
      out[key] = out[key] ?? [];
      out[key]!.push(r);
    }
    return out as Record<'Ethereum' | 'Base' | 'Linea', RegistryRow[]>;
  }, [rows]);

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
        <div
          style={{
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ color: palette.textSecondary, fontSize: '0.9rem' }}>Administration</div>
            <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.6rem' }}>ERC-8004 Registries</h1>
            <div style={{ marginTop: '0.5rem', color: palette.textSecondary, lineHeight: 1.4 }}>
              Identity Registry + Reputation Registry + Validation Registry addresses by network.
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              window.location.href = '/agent-registration/8004-eoa';
            }}
            style={{
              padding: '0.55rem 0.85rem',
              borderRadius: '10px',
              border: `1px solid ${palette.borderStrong}`,
              background: palette.accent,
              color: palette.surface,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Agent ERC-8004 Registration
          </button>
        </div>

        <div style={{ marginBottom: '1rem', color: palette.textSecondary, fontSize: '0.9rem' }}>
          {rowsLoading ? (
            <>Loading registry addresses…</>
          ) : rowsError ? (
            <>
              Failed to load registries: <code style={{ color: palette.dangerText }}>{rowsError}</code>
            </>
          ) : (
            <>
              Registry addresses come from server configuration. Missing entries show <code>—</code>.
            </>
          )}
        </div>

        {(['Ethereum', 'Base', 'Linea'] as const).map((ecosystem) => {
          const items = grouped[ecosystem] ?? [];
          return (
            <section
              key={ecosystem}
              style={{
                border: `1px solid ${palette.border}`,
                borderRadius: '12px',
                padding: '1rem',
                background: palette.surface,
                marginBottom: '1rem',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{ecosystem}</h2>
              <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                  <thead>
                    <tr>
                      {['Network', 'Chain ID', 'Identity Registry', 'Reputation Registry', 'Validation Registry'].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            padding: '0.6rem 0.5rem',
                            borderBottom: `1px solid ${palette.border}`,
                            color: palette.textSecondary,
                            fontSize: '0.85rem',
                            fontWeight: 800,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={`${r.ecosystem}:${r.network}:${r.chainId}`}>
                        <td style={{ padding: '0.65rem 0.5rem', borderBottom: `1px solid ${palette.border}` }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '999px',
                              border: `1px solid ${palette.borderStrong}`,
                              background: palette.surfaceMuted,
                              fontSize: '0.85rem',
                              fontWeight: 800,
                            }}
                          >
                            {r.network === 'Mainnet' ? 'Mainnet' : 'Testnet'}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', borderBottom: `1px solid ${palette.border}` }}>
                          <span style={{ fontFamily: 'monospace' }}>{r.chainId}</span>
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', borderBottom: `1px solid ${palette.border}` }}>
                          {renderAddr(r.identityRegistry)}
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', borderBottom: `1px solid ${palette.border}` }}>
                          {renderAddr(r.reputationRegistry)}
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem', borderBottom: `1px solid ${palette.border}` }}>
                          {renderAddr(r.validationRegistry)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}

