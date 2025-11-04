'use client';

import { useEffect, useState } from 'react';
import type {
  Challenge,
  SignedChallenge,
  VerificationResult,
} from '@agentic-trust/core';

export default function VerifyPage() {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [signedChallenge, setSignedChallenge] = useState<SignedChallenge | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agentDid, setAgentDid] = useState('');
  const [keyId, setKeyId] = useState('');
  const [algorithm, setAlgorithm] = useState<'ES256K' | 'EdDSA' | 'eth_signMessage'>('ES256K');

  useEffect(() => {
    // You would typically get these from your agent
    // For demo purposes, these are input fields
  }, []);

  const handleCreateChallenge = async () => {
    try {
      setLoading(true);
      setError(null);
      setVerificationResult(null);

      if (!agentDid.trim()) {
        setError('Please enter an agent DID');
        return;
      }

      const audience = window.location.origin;

      const response = await fetch('/api/verify/challenge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentDid: agentDid.trim(),
          audience,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to create challenge');
      }

      const challengeData = await response.json();
      setChallenge(challengeData);
      setSignedChallenge(null);
    } catch (err) {
      console.error('Failed to create challenge:', err);
      setError(err instanceof Error ? err.message : 'Failed to create challenge');
    } finally {
      setLoading(false);
    }
  };

  const handleSignChallenge = async () => {
    try {
      setLoading(true);
      setError(null);
      setVerificationResult(null);

      if (!challenge) {
        setError('Please create a challenge first');
        return;
      }

      if (!keyId.trim()) {
        setError('Please enter a key ID');
        return;
      }

      const response = await fetch('/api/verify/sign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          challenge,
          keyId: keyId.trim(),
          algorithm,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to sign challenge');
      }

      const signedData = await response.json();
      setSignedChallenge(signedData);
    } catch (err) {
      console.error('Failed to sign challenge:', err);
      setError(err instanceof Error ? err.message : 'Failed to sign challenge');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!signedChallenge) {
        setError('Please sign the challenge first');
        return;
      }

      const audience = window.location.origin;

      const response = await fetch('/api/verify/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signedChallenge,
          audience,
          nonce: challenge?.nonce,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to verify');
      }

      const result = await response.json();
      setVerificationResult(result);
    } catch (err) {
      console.error('Failed to verify:', err);
      setError(err instanceof Error ? err.message : 'Failed to verify');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: 'bold' }}>
        Agent Verification
      </h1>

      {error && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#fee',
            border: '1px solid #fcc',
            borderRadius: '4px',
            marginBottom: '1rem',
            color: '#c33',
          }}
        >
          Error: {error}
        </div>
      )}

      {verificationResult && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: verificationResult.valid ? '#efe' : '#fee',
            border: `1px solid ${verificationResult.valid ? '#cfc' : '#fcc'}`,
            borderRadius: '4px',
            marginBottom: '1rem',
            color: verificationResult.valid ? '#2d7d2d' : '#c33',
          }}
        >
          <strong>
            {verificationResult.valid ? '✓ Verification Successful' : '✗ Verification Failed'}
          </strong>
          {verificationResult.error && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
              {verificationResult.error}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gap: '2rem' }}>
        {/* Challenge Creation */}
        <div
          style={{
            padding: '1.5rem',
            backgroundColor: '#fff',
            borderRadius: '8px',
            border: '1px solid #ddd',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>1. Create Challenge</h2>
          
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Agent DID:
            </label>
            <input
              type="text"
              value={agentDid}
              onChange={(e) => setAgentDid(e.target.value)}
              placeholder="did:agent:client:1:0x123..."
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '1rem',
              }}
            />
          </div>

          <button
            onClick={handleCreateChallenge}
            disabled={loading || !agentDid.trim()}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: loading || !agentDid.trim() ? '#ccc' : '#0066cc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: loading || !agentDid.trim() ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: 'bold',
            }}
          >
            Create Challenge
          </button>

          {challenge && (
            <div
              style={{
                marginTop: '1rem',
                padding: '1rem',
                backgroundColor: '#f5f5f5',
                borderRadius: '4px',
              }}
            >
              <div style={{ fontSize: '0.9rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Challenge:
              </div>
              <pre
                style={{
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {challenge.challenge}
              </pre>
            </div>
          )}
        </div>

        {/* Signing */}
        {challenge && (
          <div
            style={{
              padding: '1.5rem',
              backgroundColor: '#fff',
              borderRadius: '8px',
              border: '1px solid #ddd',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>2. Sign Challenge</h2>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Key ID (kid):
              </label>
              <input
                type="text"
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                placeholder="key-id-from-your-agent"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Algorithm:
              </label>
              <select
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value as typeof algorithm)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                }}
              >
                <option value="ES256K">ES256K (secp256k1)</option>
                <option value="EdDSA">EdDSA (Ed25519)</option>
                <option value="eth_signMessage">eth_signMessage</option>
              </select>
            </div>

            <button
              onClick={handleSignChallenge}
              disabled={loading || !keyId.trim()}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: loading || !keyId.trim() ? '#ccc' : '#0066cc',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: loading || !keyId.trim() ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Sign Challenge
            </button>

            {signedChallenge && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  backgroundColor: '#f5f5f5',
                  borderRadius: '4px',
                }}
              >
                <div style={{ fontSize: '0.9rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                  Signed Challenge:
                </div>
                <pre
                  style={{
                    fontSize: '0.85rem',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {JSON.stringify(signedChallenge, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Verification */}
        {signedChallenge && (
          <div
            style={{
              padding: '1.5rem',
              backgroundColor: '#fff',
              borderRadius: '8px',
              border: '1px solid #ddd',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>3. Verify Signature</h2>

            <button
              onClick={handleVerify}
              disabled={loading}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: loading ? '#ccc' : '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Verify Agent
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

