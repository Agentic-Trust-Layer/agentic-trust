'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { AgentsPageAgent } from './AgentsPage';
import { grayscalePalette as palette } from '@/styles/palette';

type FeedbackSummary = {
  count?: number | string;
  averageScore?: number;
} | null;

export type AgentDetailsFeedbackSummary = FeedbackSummary;

export type ValidationEntry = {
  agentId?: string | null;
  requestHash?: string | null;
  validatorAddress?: string | null;
  response?: number | null;
  responseHash?: string | null;
  lastUpdate?: number | null;
  tag?: string | null;
  // Augmented fields from GraphQL
  txHash?: string | null;
  blockNumber?: number | null;
  timestamp?: number | null;
  requestUri?: string | null;
  requestJson?: string | null;
  responseUri?: string | null;
  responseJson?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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

function formatJsonIfPossible(text: string | null | undefined): string | null {
  if (!text) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

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
                            flexDirection: 'column',
                            gap: '0.5rem',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              flexWrap: 'wrap',
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
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Client:</strong>{' '}
                              <code style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{shorten(record.clientAddress)}</code>
                            </div>
                          )}
                          {record.comment && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Comment:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{record.comment}</span>
                            </div>
                          )}
                          {typeof record.ratingPct === 'number' && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Rating:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{record.ratingPct}%</span>
                            </div>
                          )}
                          {record.txHash && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>TX Hash:</strong>{' '}
                              <code style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{shorten(record.txHash)}</code>
                            </div>
                          )}
                          {record.blockNumber && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Block:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{record.blockNumber}</span>
                            </div>
                          )}
                          {(record.timestamp || record.createdAt) && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Time:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{formatRelativeTime(record.timestamp ?? (record.createdAt ? new Date(record.createdAt).getTime() / 1000 : null))}</span>
                            </div>
                          )}
                          {typeof record.responseCount === 'number' && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Responses:</strong>{' '}
                              <span style={{ fontSize: '0.85rem' }}>{record.responseCount}</span>
                            </div>
                          )}
                          {record.feedbackUri && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Feedback URI:</strong>{' '}
                              <a
                                href={record.feedbackUri}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: '0.85rem',
                                  color: palette.accent,
                                  textDecoration: 'none',
                                  wordBreak: 'break-all',
                                }}
                              >
                                {record.feedbackUri}
                              </a>
                            </div>
                          )}
                          {record.feedbackJson && (
                            <div>
                              <strong style={{ fontSize: '0.85rem', color: palette.textSecondary }}>Feedback JSON:</strong>
                              <pre
                                style={{
                                  margin: '0.5rem 0 0',
                                  padding: '0.5rem',
                                  backgroundColor: palette.background,
                                  borderRadius: '4px',
                                  fontSize: '0.75em',
                                  overflow: 'auto',
                                  maxHeight: '200px',
                                  fontFamily: 'ui-monospace, monospace',
                                }}
                              >
                                {(() => {
                                  try {
                                    return JSON.stringify(JSON.parse(record.feedbackJson), null, 2);
                                  } catch {
                                    return record.feedbackJson;
                                  }
                                })()}
                              </pre>
                            </div>
                          )}
                        </div>
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
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                }}
              >
                <div>
                  <h4
                    style={{
                      margin: '0 0 0.5rem',
                      fontSize: '0.9rem',
                    }}
                  >
                    Completed validations ({completedValidations.length})
                  </h4>
                  {completedValidations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {completedValidations.map((item: any, index) => (
                        <div
                          key={index}
                          style={{
                            border: `1px solid ${palette.border}`,
                            borderRadius: '8px',
                            padding: '0.75rem',
                            backgroundColor: palette.surfaceMuted,
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {item.requestHash && (
                              <div>
                                <strong>Request Hash:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.requestHash.length > 20 ? `${item.requestHash.slice(0, 10)}…${item.requestHash.slice(-8)}` : item.requestHash}
                                </code>
                              </div>
                            )}
                            {item.response !== undefined && (
                              <div>
                                <strong>Response:</strong> {item.response}
                              </div>
                            )}
                            {item.tag && (
                              <div>
                                <strong>Tag:</strong> {item.tag}
                              </div>
                            )}
                            {item.txHash && (
                              <div>
                                <strong>TX Hash:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.txHash.length > 20 ? `${item.txHash.slice(0, 10)}…${item.txHash.slice(-8)}` : item.txHash}
                                </code>
                              </div>
                            )}
                            {item.blockNumber && (
                              <div>
                                <strong>Block:</strong> {item.blockNumber}
                              </div>
                            )}
                            {item.timestamp && (
                              <div>
                                <strong>Timestamp:</strong> {new Date(Number(item.timestamp) * 1000).toLocaleString()}
                              </div>
                            )}
                            {item.validatorAddress && (
                              <div>
                                <strong>Validator:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.validatorAddress.length > 20 ? `${item.validatorAddress.slice(0, 10)}…${item.validatorAddress.slice(-8)}` : item.validatorAddress}
                                </code>
                              </div>
                            )}
                            {item.requestUri && (
                              <div>
                                <strong>Request URI:</strong>{' '}
                                <a href={item.requestUri} target="_blank" rel="noopener noreferrer" style={{ color: palette.accent, wordBreak: 'break-all', fontSize: '0.85em' }}>
                                  {item.requestUri}
                                </a>
                              </div>
                            )}
                            {item.requestJson && (
                              <div>
                                <strong>Request JSON:</strong>
                                <pre
                                  style={{
                                    margin: '0.5rem 0 0',
                                    padding: '0.5rem',
                                    backgroundColor: palette.background,
                                    borderRadius: '4px',
                                    fontSize: '0.75em',
                                    overflow: 'auto',
                                    maxHeight: '200px',
                                    fontFamily: 'ui-monospace, monospace',
                                  }}
                                >
                                  {formatJsonIfPossible(item.requestJson)}
                                </pre>
                              </div>
                            )}
                            {item.responseUri && (
                              <div>
                                <strong>Response URI:</strong>{' '}
                                <a href={item.responseUri} target="_blank" rel="noopener noreferrer" style={{ color: palette.accent, wordBreak: 'break-all', fontSize: '0.85em' }}>
                                  {item.responseUri}
                                </a>
                              </div>
                            )}
                            {item.responseJson && (
                              <div>
                                <strong>Response JSON:</strong>
                                <pre
                                  style={{
                                    margin: '0.5rem 0 0',
                                    padding: '0.5rem',
                                    backgroundColor: palette.background,
                                    borderRadius: '4px',
                                    fontSize: '0.75em',
                                    overflow: 'auto',
                                    maxHeight: '200px',
                                    fontFamily: 'ui-monospace, monospace',
                                  }}
                                >
                                  {formatJsonIfPossible(item.responseJson)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: palette.textSecondary, margin: 0 }}>
                      No completed validations.
                    </p>
                  )}
                </div>
                <div>
                  <h4
                    style={{
                      margin: '0 0 0.5rem',
                      fontSize: '0.9rem',
                    }}
                  >
                    Pending validations ({pendingValidations.length})
                  </h4>
                  {pendingValidations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {pendingValidations.map((item: any, index) => (
                        <div
                          key={index}
                          style={{
                            border: `1px solid ${palette.border}`,
                            borderRadius: '8px',
                            padding: '0.75rem',
                            backgroundColor: palette.surfaceMuted,
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {item.requestHash && (
                              <div>
                                <strong>Request Hash:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.requestHash.length > 20 ? `${item.requestHash.slice(0, 10)}…${item.requestHash.slice(-8)}` : item.requestHash}
                                </code>
                              </div>
                            )}
                            <div style={{ color: palette.textSecondary }}>
                              <strong>Status:</strong> Awaiting response
                            </div>
                            {item.tag && (
                              <div>
                                <strong>Tag:</strong> {item.tag}
                              </div>
                            )}
                            {item.validatorAddress && (
                              <div>
                                <strong>Validator:</strong>{' '}
                                <code style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                                  {item.validatorAddress.length > 20 ? `${item.validatorAddress.slice(0, 10)}…${item.validatorAddress.slice(-8)}` : item.validatorAddress}
                                </code>
                              </div>
                            )}
                            {item.lastUpdate && (
                              <div>
                                <strong>Last Update:</strong> {new Date(Number(item.lastUpdate) * 1000).toLocaleString()}
                              </div>
                            )}
                            {item.requestUri && (
                              <div>
                                <strong>Request URI:</strong>{' '}
                                <a href={item.requestUri} target="_blank" rel="noopener noreferrer" style={{ color: palette.accent, wordBreak: 'break-all', fontSize: '0.85em' }}>
                                  {item.requestUri}
                                </a>
                              </div>
                            )}
                            {item.requestJson && (
                              <div>
                                <strong>Request JSON:</strong>
                                <pre
                                  style={{
                                    margin: '0.5rem 0 0',
                                    padding: '0.5rem',
                                    backgroundColor: palette.background,
                                    borderRadius: '4px',
                                    fontSize: '0.75em',
                                    overflow: 'auto',
                                    maxHeight: '200px',
                                    fontFamily: 'ui-monospace, monospace',
                                  }}
                                >
                                  {formatJsonIfPossible(item.requestJson)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: palette.textSecondary, margin: 0 }}>
                      No pending validations.
                    </p>
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
