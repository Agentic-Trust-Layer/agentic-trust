'use client';

import { useMemo, useState } from 'react';
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
  const feedbackList = useMemo(
    () => (Array.isArray(feedbackItems) ? feedbackItems : []),
    [feedbackItems],
  );

  const pendingValidations = validations?.pending ?? [];
  const completedValidations = validations?.completed ?? [];

  return (
    <section
      style={{
        backgroundColor: palette.surface,
        borderRadius: '16px',
        border: `1px solid ${palette.border}`,
        padding: '1.5rem',
        boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '1.5rem',
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
                padding: '0.65rem 1.25rem',
                borderRadius: '999px',
                border: `1px solid ${isActive ? palette.accent : palette.border}`,
                backgroundColor: isActive ? palette.accent : palette.surface,
                color: isActive ? '#fff' : palette.textPrimary,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 0.2s, color 0.2s',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>Identity</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '0.75rem',
                fontSize: '0.9rem',
              }}
            >
              <div>
                <strong>Agent ID</strong>
                <div style={{ fontFamily: 'monospace' }}>{agent.agentId}</div>
              </div>
              <div>
                <strong>Chain</strong>
                <div>{agent.chainId}</div>
              </div>
              <div>
                <strong>Owner</strong>
                <div style={{ fontFamily: 'monospace' }}>
                  {shorten(agent.agentAccount)}
                </div>
              </div>
              <div>
                <strong>Created</strong>
                <div>{formatRelativeTime(agent.createdAtTime)}</div>
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>Endpoints</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '0.75rem',
                fontSize: '0.9rem',
              }}
            >
              <div>
                <strong>A2A</strong>
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
                <strong>MCP</strong>
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

          <div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>Description</h3>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              {agent.description || 'No description provided.'}
            </p>
          </div>
        </div>
      )}

      {activeTab === 'feedback' && (
        <div>
          <p style={{ color: palette.textSecondary, marginTop: 0 }}>
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
          <p style={{ color: palette.textSecondary, marginTop: 0 }}>
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
                <h4 style={{ marginTop: 0 }}>
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
                      <li key={item.requestHash ?? idx}>
                        <code>{item.requestHash}</code> — response {item.response}
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
                <h4 style={{ marginTop: 0 }}>
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
                      <li key={item.requestHash ?? idx}>
                        <code>{item.requestHash}</code> — awaiting response
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default AgentDetailsTabs;
