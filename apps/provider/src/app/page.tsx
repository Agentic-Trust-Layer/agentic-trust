'use client';

import { useState, useEffect } from 'react';

export default function ProviderPage() {
  const [endpointInfo, setEndpointInfo] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch endpoint info
    async function fetchEndpointInfo() {
      try {
        const response = await fetch('/api/a2a');
        const data = await response.json();
        setEndpointInfo(data);
      } catch (error) {
        console.error('Failed to fetch endpoint info:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchEndpointInfo();
  }, []);

  return (
    <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: 'bold' }}>
        Agent Provider
      </h1>

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          Loading provider info...
        </div>
      ) : (
        <>
          {endpointInfo && (
            <div
              style={{
                padding: '1.5rem',
                backgroundColor: '#fff',
                borderRadius: '8px',
                border: '1px solid #ddd',
                marginBottom: '2rem',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              }}
            >
              <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>
                Provider Information
              </h2>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div>
                  <strong>Provider ID:</strong> {endpointInfo.providerId}
                </div>
                <div>
                  <strong>Agent Name:</strong> {endpointInfo.agentName}
                </div>
                <div>
                  <strong>A2A Endpoint:</strong>
                  <code
                    style={{
                      display: 'block',
                      padding: '0.5rem',
                      backgroundColor: '#f5f5f5',
                      borderRadius: '4px',
                      marginTop: '0.25rem',
                      fontFamily: 'monospace',
                      fontSize: '0.9rem',
                    }}
                  >
                    {endpointInfo.endpoint}
                  </code>
                </div>
                <div>
                  <strong>Method:</strong> {endpointInfo.method}
                </div>
                {endpointInfo.capabilities && (
                  <div>
                    <strong>Capabilities:</strong>{' '}
                    {endpointInfo.capabilities.join(', ')}
                  </div>
                )}
              </div>
            </div>
          )}

          <div
            style={{
              padding: '1.5rem',
              backgroundColor: '#fff',
              borderRadius: '8px',
              border: '1px solid #ddd',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>
              A2A Messages Log
            </h2>
            <div style={{ fontSize: '0.9rem', color: '#666' }}>
              {messages.length === 0 ? (
                <div>No messages received yet. Messages will appear here when agents send A2A requests.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '0.75rem',
                        backgroundColor: '#f9f9f9',
                        borderRadius: '4px',
                        border: '1px solid #eee',
                      }}
                    >
                      <div><strong>From:</strong> {msg.fromAgentId}</div>
                      <div><strong>To:</strong> {msg.toAgentId}</div>
                      {msg.message && <div><strong>Message:</strong> {msg.message}</div>}
                      <div style={{ fontSize: '0.85rem', color: '#999', marginTop: '0.25rem' }}>
                        {new Date(msg.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

