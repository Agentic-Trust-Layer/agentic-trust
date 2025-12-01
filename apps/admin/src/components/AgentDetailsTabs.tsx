'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { AgentsPageAgent } from './AgentsPage';
import { grayscalePalette as palette } from '@/styles/palette';

type FeedbackSummary = {
  count?: number | string;
  averageScore?: number;
} | null;

export type AgentDetailsFeedbackSummary = FeedbackSummary;

type ValidationEntry = {
  agentId?: string | null;
  requestHash?: string | null;
  validatorAddress?: string | null;
  response?: number | null;
  responseHash?: string | null;
  lastUpdate?: number | null;
  tag?: string | null;
};

export type AgentDetailsValidationsSummary = {
  pending: ValidationEntry[];
  completed: ValidationEntry[];
};

type AgentDetailsTabsProps = {
  agent: AgentsPageAgent;
  feedbackItems: unknown[];
  feedbackSummary: AgentDetailsFeedbackSummary;
  validations: AgentDetailsValidationsSummary | null;
};

const TAB_DEFS = [
  { id: 'overview', label: 'Overview' },
  { id: 'registration', label: 'Registration' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'validation', label: 'Validation' },
] as const;

type TabId = (typeof TAB_DEFS)[number]['id'];

const shorten = (value?: string | null) => {
  if (!value) return '—';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
};

const formatRelativeTime = (timestamp?: number | null) => {
  if (!timestamp) return 'Unknown';
  const secondsAgo = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(timestamp));
  const days = Math.floor(secondsAgo / 86400);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hours = Math.floor(secondsAgo / 3600);
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(secondsAgo / 60);
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return `${secondsAgo} second${secondsAgo === 1 ? '' : 's'} ago`;
};

const AgentDetailsTabs = ({
  agent,
  feedbackItems,
  feedbackSummary,
  validations,
}: AgentDetailsTabsProps) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [registrationData, setRegistrationData] = useState<string | null>(null);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  const feedbackList = useMemo(
    () => (Array.isArray(feedbackItems) ? feedbackItems : []),
    [feedbackItems],
  );

  const pendingValidations = validations?.pending ?? [];
  const completedValidations = validations?.completed ?? [];

  // Normalize IPFS/Arweave URLs to HTTP
  const normalizeResourceUrl = useCallback((src?: string | null): string | null => {
    if (!src) {
      return null;
    }
    let value = src.trim();
    if (!value) {
      return null;
    }
    try {
      value = decodeURIComponent(value);
    } catch {
      // ignore
    }
    if (value.startsWith('ipfs://')) {
      const path = value.slice('ipfs://'.length).replace(/^ipfs\//i, '');
      return `https://ipfs.io/ipfs/${path}`;
    }
    if (value.startsWith('ar://')) {
      return `https://arweave.net/${value.slice('ar://'.length)}`;
    }
    return value;
  }, []);

  // Load registration data when registration tab is selected
  useEffect(() => {
    if (activeTab === 'registration' && agent.tokenUri && !registrationData && !registrationLoading) {
      setRegistrationLoading(true);
      setRegistrationError(null);
      const normalizedUri = normalizeResourceUrl(agent.tokenUri);
      if (!normalizedUri) {
        setRegistrationError('Invalid token URI');
        setRegistrationLoading(false);
        return;
      }
      fetch(normalizedUri)
        .then((response) => {
          if (!response.ok) {
            throw new Error('Failed to fetch registration data');
          }
          return response.text();
        })
        .then((text) => {
          setRegistrationData(text);
          setRegistrationLoading(false);
        })
        .catch((error) => {
          console.error('Failed to load registration:', error);
          setRegistrationError(error instanceof Error ? error.message : 'Failed to load registration data');
          setRegistrationLoading(false);
        });
    }
  }, [activeTab, agent.tokenUri, registrationData, registrationLoading, normalizeResourceUrl]);

  return (
    <section
      style={{
        backgroundColor: palette.surface,
        borderRadius: '16px',
        border: `1px solid ${palette.border}`,
        boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
        overflow: 'hidden',
      }}
    >
      {/* Tab Navigation */}
      <div
        style={{
          display: 'flex',
          borderBottom: `2px solid ${palette.border}`,
          backgroundColor: palette.surfaceMuted,
          overflowX: 'auto',
        }}
      >
        {TAB_DEFS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '1rem 1.5rem',
                border: 'none',
                borderBottom: `3px solid ${isActive ? palette.accent : 'transparent'}`,
                backgroundColor: 'transparent',
                color: isActive ? palette.accent : palette.textSecondary,
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                fontSize: '0.95rem',
                whiteSpace: 'nowrap',
                position: 'relative',
                minWidth: '120px',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = palette.textPrimary;
                  e.currentTarget.style.backgroundColor = palette.surface;
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = palette.textSecondary;
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div style={{ padding: '1.5rem' }}>
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 600 }}>Identity</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '0.75rem',
                  fontSize: '0.9rem',
                }}
              >
                <div>
                  <strong style={{ color: palette.textSecondary }}>Agent ID</strong>
                  <div style={{ fontFamily: 'monospace', marginTop: '0.25rem' }}>{agent.agentId}</div>
                </div>
                <div>
                  <strong style={{ color: palette.textSecondary }}>Chain</strong>
                  <div style={{ marginTop: '0.25rem' }}>{agent.chainId}</div>
                </div>
                <div>
                  <strong style={{ color: palette.textSecondary }}>Owner</strong>
                  <div style={{ fontFamily: 'monospace', marginTop: '0.25rem' }}>
                    {shorten(agent.agentAccount)}
                  </div>
                </div>
                <div>
                  <strong style={{ color: palette.textSecondary }}>Created</strong>
                  <div style={{ marginTop: '0.25rem' }}>{formatRelativeTime(agent.createdAtTime)}</div>
                </div>
              </div>
            </div>

            <div>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 600 }}>Endpoints</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: '0.75rem',
                  fontSize: '0.9rem',
                }}
              >
                <div>
                  <strong style={{ color: palette.textSecondary }}>A2A</strong>
                  <p
                    style={{
                      margin: '0.25rem 0 0',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      color: palette.textSecondary,
                    }}
                  >
                    {agent.a2aEndpoint || '—'}
                  </p>
                </div>
                <div>
                  <strong style={{ color: palette.textSecondary }}>MCP</strong>
                  <p
                    style={{
                      margin: '0.25rem 0 0',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      color: palette.textSecondary,
                    }}
                  >
                    {agent.agentAccountEndpoint || '—'}
                  </p>
                </div>
              </div>
            </div>

            {agent.description && (
              <div>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 600 }}>Description</h3>
                <p style={{ margin: 0, lineHeight: 1.6, color: palette.textPrimary }}>
                  {agent.description}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'registration' && (
          <div>
            {!agent.tokenUri ? (
              <p style={{ color: palette.textSecondary, margin: 0 }}>
                No registration data available for this agent.
              </p>
            ) : registrationLoading ? (
              <p style={{ color: palette.textSecondary, margin: 0 }}>
                Loading registration data...
              </p>
            ) : registrationError ? (
              <p style={{ color: palette.dangerText, margin: 0 }}>
                {registrationError}
              </p>
            ) : registrationData ? (
              <div
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: '12px',
                  padding: '1rem',
                  backgroundColor: palette.surfaceMuted,
                  maxHeight: '600px',
                  overflow: 'auto',
                }}
              >
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: '0.85rem',
                    margin: 0,
                    color: palette.textPrimary,
                  }}
                >
                  {registrationData}
                </pre>
              </div>
            ) : (
              <p style={{ color: palette.textSecondary, margin: 0 }}>
                No registration data available.
              </p>
            )}
          </div>
        )}

        {activeTab === 'feedback' && (
          <div>
            <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
              Feedback entries and aggregated reputation summary for this agent.
            </p>
            {feedbackSummary && (
              <div
                style={{
                  display: 'flex',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  fontSize: '0.9rem',
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  backgroundColor: palette.surfaceMuted,
                  borderRadius: '8px',
                }}
              >
                <span>
                  <strong>Feedback count:</strong>{' '}
                  {feedbackSummary?.count ?? '0'}
                </span>
                <span>
                  <strong>Average score:</strong>{' '}
                  {typeof feedbackSummary?.averageScore === 'number'
                    ? feedbackSummary.averageScore.toFixed(2)
                    : 'N/A'}
                </span>
              </div>
            )}
            <div
              style={{
                border: `1px solid ${palette.border}`,
                borderRadius: '12px',
                padding: '1rem',
                maxHeight: 500,
                overflow: 'auto',
                backgroundColor: palette.surfaceMuted,
              }}
            >
              {feedbackList.length === 0 ? (
                <p style={{ color: palette.textSecondary, margin: 0 }}>
                  No feedback entries found for this agent.
                </p>
              ) : (
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  {feedbackList.map((item, idx) => {
                    const record = item as any;
                    return (
                      <li
                        key={record.id ?? record.index ?? idx}
                        style={{
                          border: `1px solid ${palette.border}`,
                          borderRadius: '10px',
                          padding: '0.75rem',
                          backgroundColor: palette.surface,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            marginBottom: '0.35rem',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                          }}
                        >
                          <span>Score: {record.score ?? 'N/A'}</span>
                          {record.isRevoked && (
                            <span style={{ color: palette.dangerText }}>Revoked</span>
                          )}
                        </div>
                        {record.clientAddress && (
                          <div
                            style={{
                              fontFamily: 'monospace',
                              fontSize: '0.8rem',
                              color: palette.textSecondary,
                              marginBottom: record.feedbackUri ? '0.35rem' : 0,
                              wordBreak: 'break-all',
                            }}
                          >
                            {record.clientAddress}
                          </div>
                        )}
                        {record.feedbackUri && (
                          <a
                            href={record.feedbackUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '0.8rem',
                              color: palette.accent,
                              textDecoration: 'none',
                              wordBreak: 'break-all',
                            }}
                          >
                            View feedback details
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeTab === 'validation' && (
          <div>
            <p style={{ color: palette.textSecondary, marginTop: 0, marginBottom: '1rem' }}>
              Pending and completed validations for this agent from the on-chain
              validation registry.
            </p>
            {!validations ? (
              <p style={{ color: palette.textSecondary }}>
                Unable to load validation data.
              </p>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '1rem',
                }}
              >
                <div
                  style={{
                    border: `1px solid ${palette.border}`,
                    borderRadius: '12px',
                    padding: '1rem',
                    backgroundColor: palette.surfaceMuted,
                  }}
                >
                  <h4 style={{ marginTop: 0, fontSize: '1rem', fontWeight: 600 }}>
                    Completed ({completedValidations.length})
                  </h4>
                  {completedValidations.length === 0 ? (
                    <p style={{ color: palette.textSecondary, margin: 0 }}>
                      No completed validations.
                    </p>
                  ) : (
                    <ul
                      style={{
                        listStyle: 'disc',
                        paddingLeft: '1.2rem',
                        margin: 0,
                        fontSize: '0.85rem',
                      }}
                    >
                      {completedValidations.map((item, idx) => (
                        <li key={item.requestHash ?? idx} style={{ marginBottom: '0.5rem' }}>
                          <code style={{ fontFamily: 'monospace' }}>{item.requestHash}</code> — response {item.response}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div
                  style={{
                    border: `1px solid ${palette.border}`,
                    borderRadius: '12px',
                    padding: '1rem',
                    backgroundColor: palette.surfaceMuted,
                  }}
                >
                  <h4 style={{ marginTop: 0, fontSize: '1rem', fontWeight: 600 }}>
                    Pending ({pendingValidations.length})
                  </h4>
                  {pendingValidations.length === 0 ? (
                    <p style={{ color: palette.textSecondary, margin: 0 }}>
                      No pending validations.
                    </p>
                  ) : (
                    <ul
                      style={{
                        listStyle: 'disc',
                        paddingLeft: '1.2rem',
                        margin: 0,
                        fontSize: '0.85rem',
                      }}
                    >
                      {pendingValidations.map((item, idx) => (
                        <li key={item.requestHash ?? idx} style={{ marginBottom: '0.5rem' }}>
                          <code style={{ fontFamily: 'monospace' }}>{item.requestHash}</code> — awaiting response
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default AgentDetailsTabs;
