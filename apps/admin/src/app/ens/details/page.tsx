'use client';

import { useCallback, useMemo, useState } from 'react';
import { grayscalePalette as palette } from '@/styles/palette';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';

type EnsAgentResult =
  | {
      ok: true;
      chainId: number;
      ensName: string;
      account: string | null;
      agentUrl: string | null;
      image: string | null;
      description: string | null;
      identity: unknown;
    }
  | { ok: false; error: string };

export default function EnsDetailsPage() {
  const auth = useAuth();

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object';

  const [chainId, setChainId] = useState<number>(59144);
  const [org, setOrg] = useState('8004-agent.eth');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EnsAgentResult | null>(null);
  const [listing, setListing] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const fullNamePreview = useMemo(() => {
    const n = name.trim().toLowerCase();
    const o = org.trim().toLowerCase();
    if (!n) return '';
    if (n.includes('.')) return n.endsWith('.eth') ? n : `${n}.eth`;
    const cleanOrg = o.endsWith('.eth') ? o.slice(0, -4) : o;
    return cleanOrg ? `${n}.${cleanOrg}.eth` : '';
  }, [name, org]);

  const lookup = useCallback(async () => {
    const n = name.trim();
    if (!n) return;
    setLoading(true);
    setResult(null);
    try {
      const resp = await fetch(
        `/api/ens/agent?chainId=${encodeURIComponent(String(chainId))}&name=${encodeURIComponent(n)}&org=${encodeURIComponent(org)}`,
      );
      const json = (await resp.json().catch(() => null)) as EnsAgentResult | null;
      if (!json) throw new Error('Empty response');
      setResult(json);
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'Lookup failed' });
    } finally {
      setLoading(false);
    }
  }, [name, org, chainId]);

  const listSubdomains = useCallback(async () => {
    setListing(true);
    setListError(null);
    setLabels([]);
    try {
      const resp = await fetch(
        `/api/ens/org/subdomains?chainId=${encodeURIComponent(String(chainId))}&org=${encodeURIComponent(org)}`,
      );
      const json = (await resp.json().catch(() => null)) as unknown;
      if (!resp.ok || !isRecord(json) || json.ok !== true) {
        const error =
          isRecord(json) && typeof json.error === 'string' && json.error.trim() ? json.error.trim() : 'Failed to list subdomains';
        throw new Error(error);
      }
      const nextLabels = Array.isArray(json.labels) ? json.labels.filter((v): v is string => typeof v === 'string') : [];
      setLabels(nextLabels);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to list subdomains');
    } finally {
      setListing(false);
    }
  }, [chainId, org]);

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
        <h1 style={{ margin: 0, fontSize: '1.6rem' }}>ENS Details</h1>
        <p style={{ marginTop: '0.5rem', color: palette.textSecondary }}>
          Looks up agent info from the ENS registry/resolver on the selected chain (L1 or L2).
        </p>

        <div
          style={{
            marginTop: '1.25rem',
            border: `1px solid ${palette.border}`,
            borderRadius: 12,
            padding: '1rem',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 1fr',
              gap: '0.75rem',
              alignItems: 'center',
            }}
          >
            <label style={{ fontWeight: 700, color: palette.textSecondary }}>Chain</label>
            <select
              value={String(chainId)}
              onChange={(e) => setChainId(Number(e.target.value))}
              style={{ padding: '0.55rem 0.7rem', borderRadius: 10, border: `1px solid ${palette.border}` }}
            >
              <option value="1">Ethereum Mainnet</option>
              <option value="11155111">Ethereum Sepolia</option>
              <option value="59144">Linea Mainnet</option>
              <option value="59141">Linea Sepolia</option>
            </select>

            <label style={{ fontWeight: 700, color: palette.textSecondary }}>Org</label>
            <input
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="8004-agent.eth"
              style={{ padding: '0.55rem 0.7rem', borderRadius: 10, border: `1px solid ${palette.border}` }}
            />

            <label style={{ fontWeight: 700, color: palette.textSecondary }}>ENS name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="test  (or test.8004-agent.eth)"
              style={{ padding: '0.55rem 0.7rem', borderRadius: 10, border: `1px solid ${palette.border}` }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookup();
              }}
            />
          </div>

          <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => void lookup()}
              disabled={loading || !name.trim()}
              style={{
                padding: '0.6rem 1rem',
                borderRadius: 10,
                border: 'none',
                backgroundColor: palette.accent,
                color: palette.surface,
                fontWeight: 800,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Looking up…' : 'Lookup'}
            </button>
            <button
              type="button"
              onClick={() => void listSubdomains()}
              disabled={listing}
              style={{
                padding: '0.6rem 1rem',
                borderRadius: 10,
                border: `1px solid ${palette.borderStrong}`,
                backgroundColor: palette.surfaceMuted,
                color: palette.textPrimary,
                fontWeight: 800,
                cursor: listing ? 'not-allowed' : 'pointer',
                opacity: listing ? 0.7 : 1,
              }}
              title="List subdomains under the org (best-effort; requires registry events with label strings)"
            >
              {listing ? 'Listing…' : 'List agents'}
            </button>
            {fullNamePreview ? (
              <span style={{ fontFamily: 'monospace', color: palette.textSecondary }}>{fullNamePreview}</span>
            ) : null}
          </div>
        </div>

        {(listError || labels.length > 0) && (
          <div
            style={{
              marginTop: '1.25rem',
              border: `1px solid ${palette.border}`,
              borderRadius: 12,
              padding: '1rem',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Agents under org</h3>
            {listError ? (
              <div style={{ marginTop: '0.75rem', color: palette.dangerText, fontWeight: 700 }}>{listError}</div>
            ) : labels.length === 0 ? (
              <div style={{ marginTop: '0.75rem', color: palette.textSecondary }}>No subdomains found.</div>
            ) : (
              <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '1fr', gap: '0.35rem' }}>
                {labels.slice(0, 500).map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setName(label);
                      void lookup();
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '0.45rem 0.6rem',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surface,
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      color: palette.textPrimary,
                    }}
                    title="Click to lookup details"
                  >
                    {label}
                  </button>
                ))}
                {labels.length > 500 ? (
                  <div style={{ marginTop: '0.5rem', color: palette.textSecondary }}>Showing first 500.</div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {result && (
          <div
            style={{
              marginTop: '1.25rem',
              border: `1px solid ${palette.border}`,
              borderRadius: 12,
              padding: '1rem',
            }}
          >
            {'ok' in result && result.ok ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem' }}>
                <div>
                  <span style={{ fontWeight: 800 }}>ENS</span>{' '}
                  <span style={{ fontFamily: 'monospace' }}>{result.ensName}</span>
                </div>
                <div>
                  <span style={{ fontWeight: 800 }}>Account</span>{' '}
                  <span style={{ fontFamily: 'monospace' }}>{result.account ?? '(none)'}</span>
                </div>
                <div>
                  <span style={{ fontWeight: 800 }}>Agent URL</span>{' '}
                  <span style={{ fontFamily: 'monospace' }}>{result.agentUrl ?? '(none)'}</span>
                </div>
                <div>
                  <span style={{ fontWeight: 800 }}>Image</span>{' '}
                  <span style={{ fontFamily: 'monospace' }}>{result.image ?? '(none)'}</span>
                </div>
                <div>
                  <span style={{ fontWeight: 800 }}>Description</span>{' '}
                  <span style={{ whiteSpace: 'pre-wrap' }}>{result.description ?? '(none)'}</span>
                </div>
                <details>
                  <summary style={{ fontWeight: 800, cursor: 'pointer' }}>Raw identity</summary>
                  <pre
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.75rem',
                      borderRadius: 12,
                      border: `1px solid ${palette.border}`,
                      backgroundColor: palette.surfaceMuted,
                      overflowX: 'auto',
                      fontSize: '0.85rem',
                    }}
                  >
                    {JSON.stringify(result.identity ?? null, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <div style={{ color: palette.dangerText, fontWeight: 800 }}>{'error' in result ? result.error : 'Lookup failed'}</div>
            )}
          </div>
        )}
      </main>
    </>
  );
}

