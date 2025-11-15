'use client';

import type { DiscoverResponse } from '@agentic-trust/core/server';

type Agent = DiscoverResponse['agents'][number] & {
  contractAddress?: string | null;
};

type ChainOption = {
  id: number;
  label: string;
};

export type AgentsPageFilters = {
  chainId: string;
  address: string;
  name: string;
  agentId: string;
};

type AgentsPageProps = {
  agents: Agent[];
  filters: AgentsPageFilters;
  chainOptions: ChainOption[];
  loading: boolean;
  ownedMap?: Record<string, boolean>;
  onFilterChange: <K extends keyof AgentsPageFilters>(
    key: K,
    value: AgentsPageFilters[K],
  ) => void;
  onSearch: () => void;
  onClear: () => void;
  onEditAgent?: (agent: Agent) => void;
};

export function AgentsPage({
  agents,
  filters,
  chainOptions,
  loading,
  ownedMap = {},
  onFilterChange,
  onSearch,
  onClear,
  onEditAgent,
}: AgentsPageProps) {
  const EXPLORER_BY_CHAIN: Record<number, string> = {
    1: 'https://etherscan.io',
    11155111: 'https://sepolia.etherscan.io',
    84532: 'https://sepolia.basescan.org',
    11155420: 'https://sepolia-optimism.etherscan.io',
  };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>


      <div
        style={{
          backgroundColor: '#fff',
          padding: '1.5rem',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 8px 20px rgba(15,23,42,0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              flex: '1 1 220px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1rem',
            }}
          >
            <select
              value={filters.chainId}
              onChange={event => onFilterChange('chainId', event.target.value)}
              aria-label="Chain"
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5f5',
                backgroundColor: '#fdfdff',
                fontWeight: 600,
                color: '#0f172a',
                boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
              }}
            >
              <option value="all">Chain (All)</option>
              {chainOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>

            <input
              value={filters.address}
              onChange={event => onFilterChange('address', event.target.value)}
              placeholder="Agent address"
              aria-label="Agent address"
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5f5',
                backgroundColor: '#fdfdff',
                boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
              }}
            />

            <input
              value={filters.name}
              onChange={event => onFilterChange('name', event.target.value)}
              placeholder="Agent name"
              aria-label="Agent name"
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5f5',
                backgroundColor: '#fdfdff',
                boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
              }}
            />

            <input
              value={filters.agentId}
              onChange={event => onFilterChange('agentId', event.target.value)}
              placeholder="Agent ID"
              aria-label="Agent ID"
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5f5',
                backgroundColor: '#fdfdff',
                boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              marginLeft: 'auto',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={onSearch}
              disabled={loading}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
            <button
              onClick={onClear}
              disabled={loading}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#f1f5f9',
                color: '#0f172a',
                border: 'none',
                borderRadius: '10px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>


        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {agents.length === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '2rem',
                textAlign: 'center',
                borderRadius: '12px',
                border: '1px dashed #cbd5f5',
                color: '#475569',
              }}
            >
              {loading ? 'Loading agents...' : 'No agents found for the selected filters.'}
            </div>
          )}

          {agents.map(agent => {
            const ownershipKey = `${agent.chainId}:${agent.agentId}`;
            const isOwned = Boolean(ownedMap[ownershipKey]);
            const imageUrl =
              typeof agent.image === 'string' && agent.image.trim()
                ? agent.image.trim()
                : null;
            const explorerBase = EXPLORER_BY_CHAIN[agent.chainId] ?? 'https://etherscan.io';
            const nftUrl =
              typeof agent.contractAddress === 'string' && agent.contractAddress
                ? `${explorerBase}/token/${agent.contractAddress}?a=${agent.agentId}`
                : null;
            return (
              <article
                key={`${agent.chainId}-${agent.agentId}`}
                style={{
                  borderRadius: '16px',
                  border: '1px solid #e2e8f0',
                  padding: '1.5rem',
                  backgroundColor: '#fff',
                  boxShadow: '0 6px 16px rgba(15,23,42,0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  position: 'relative',
                }}
              >
                {isOwned && (
                  <button
                    type="button"
                    onClick={() => onEditAgent?.(agent)}
                    aria-label={`Edit agent ${agent.agentId}`}
                    title="Edit agent"
                    style={{
                      position: 'absolute',
                      top: '0.75rem',
                      right: '0.75rem',
                      width: '32px',
                      height: '32px',
                      borderRadius: '999px',
                      border: '1px solid #cbd5f5',
                      backgroundColor: '#ffffffee',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(15,23,42,0.15)',
                    }}
                  >
                    ✏️
                  </button>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                  <div style={{ display: 'flex', gap: '0.85rem' }}>
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={agent.agentName || 'Agent'}
                        style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: '12px',
                          objectFit: 'cover',
                          border: '1px solid #e2e8f0',
                        }}
                      />
                    )}
                    <div>
                      {nftUrl ? (
                        <a
                          href={nftUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-block',
                            fontSize: '0.8rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: '#2563eb',
                            marginBottom: '0.25rem',
                            textDecoration: 'none',
                            fontWeight: 600,
                          }}
                        >
                          Agent #{agent.agentId}
                        </a>
                      ) : (
                        <p
                          style={{
                            fontSize: '0.8rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: '#94a3b8',
                            marginBottom: '0.25rem',
                          }}
                        >
                          Agent #{agent.agentId}
                        </p>
                      )}
                      <h4 style={{ margin: 0, fontSize: '1.3rem' }}>
                        {agent.agentName || 'Unnamed Agent'}
                      </h4>
                    </div>
                  </div>
                  <span
                    style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '999px',
                      backgroundColor: '#eef2ff',
                      color: '#4338ca',
                      fontSize: '0.85rem',
                      alignSelf: 'flex-start',
                    }}
                  >
                    Chain {agent.chainId}
                  </span>
                </div>
                <p
                  style={{
                    margin: 0,
                    color: '#475569',
                    minHeight: '3.5rem',
                  }}
                >
                  {agent.description || 'No description provided.'}
                </p>
                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      padding: '0.3rem 0.75rem',
                      backgroundColor: '#ecfeff',
                      color: '#0e7490',
                      borderRadius: '999px',
                      fontSize: '0.8rem',
                    }}
                  >
                    On-chain Identity
                  </span>
                  {typeof agent.agentAccount === 'string' && agent.agentAccount && (
                    <a
                      href={`${explorerBase}/address/${agent.agentAccount}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '0.3rem 0.75rem',
                        backgroundColor: '#fef2f2',
                        color: '#b91c1c',
                        borderRadius: '999px',
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        textDecoration: 'none',
                      }}
                    >
                      {agent.agentAccount.slice(0, 6)}...{agent.agentAccount.slice(-4)}
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

