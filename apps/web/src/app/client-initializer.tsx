'use client';

import { useEffect, useState } from 'react';
import { initAgenticTrustClient } from '@/lib/init-client';

interface ClientInitializerProps {
  children: React.ReactNode;
}

/**
 * Client Initializer Component
 * 
 * Initializes the AgenticTrustClient with a Veramo agent on app load
 */
export function ClientInitializer({ children }: ClientInitializerProps) {
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function initialize() {
      try {
        await initAgenticTrustClient();
        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize AgenticTrustClient:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to initialize AgenticTrustClient'
        );
      }
    }

    initialize();
  }, []);

  if (error) {
    return (
      <div
        style={{
          padding: '2rem',
          textAlign: 'center',
          maxWidth: '600px',
          margin: '0 auto',
        }}
      >
        <h1 style={{ color: '#c33', marginBottom: '1rem' }}>
          Initialization Error
        </h1>
        <p style={{ color: '#666', marginBottom: '1rem' }}>{error}</p>
        <p style={{ fontSize: '0.9rem', color: '#999' }}>
          Please ensure your Veramo agent is properly configured in{' '}
          <code>src/lib/veramo.ts</code>
        </p>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div
        style={{
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div>Initializing AgenticTrustClient...</div>
      </div>
    );
  }

  return <>{children}</>;
}

