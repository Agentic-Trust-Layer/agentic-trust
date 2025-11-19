'use client';

import { useEffect, useState } from 'react';
import { type AgentCard, type AgentSkill, type MessageRequest } from '@agentic-trust/core';
import { buildDid8004 } from '@agentic-trust/core';

// Plain agent data type from API (not Agent instances)
type AgentData = {
  agentId?: number;
  chainId?: number;
  agentName?: string;
  a2aEndpoint?: string;
  createdAtTime?: string;
  updatedAtTime?: string;
};

const DEFAULT_CHAIN_ID = 11155111;

export default function Home() {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentData | null>(null);
  const [agentCard, setAgentCard] = useState<AgentCard | null>(null);
  const [endpoint, setEndpoint] = useState<{ providerId: string; endpoint: string; method?: string } | null>(null);
  const [message, setMessage] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<AgentSkill | null>(null);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<{ 
    response?: { response?: string; skill?: string }; 
    messageId?: string;
    [key: string]: unknown;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [loadingAgentCard, setLoadingAgentCard] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<boolean | null>(null);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);

  // Fetch agents on component mount
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch('/api/agents');
        if (!response.ok) {
          throw new Error('Failed to fetch agents');
        }
        const data = await response.json();
        setAgents(data.agents || []);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
  }, []);

  /**
   * Request feedbackAuth from provider and submit feedback
   * @param agentName - Agent name (ENS name, optional if agentId+chainId provided)
   * @param agentId - Agent ID (required if agentName not provided)
   * @param chainId - Chain ID (required if agentName not provided)
   * @param score - Rating score (1-100)
   * @param comment - Feedback comment
   * @param taskId - Optional task ID
   * @param contextId - Optional context ID
   */
  const requestFeedbackAuthAndSubmit = async (
    agentName: string | undefined,
    agentId: string | undefined,
    chainId: number | undefined,
    score: number,
    comment: string,
    taskId?: string,
    contextId?: string
  ) => {
    if (!agentName && (!agentId || !chainId)) {
      throw new Error('Either agentName or both agentId and chainId are required');
    }

    // Get client address
    const addressResponse = await fetch('/api/client-address');
    if (!addressResponse.ok) {
      throw new Error('Failed to get client address');
    }
    const addressData = await addressResponse.json();
    const clientAddress = addressData.clientAddress;

    if (!clientAddress) {
      throw new Error('Client address not available');
    }

    // Request feedbackAuth from provider
    const feedbackAuthParams = new URLSearchParams({
      clientAddress,
      ...(agentName ? { agentName } : {}),
      ...(agentId ? { agentId } : {}),
      ...(chainId ? { chainId: chainId.toString() } : {}),
    });

    const feedbackAuthResponse = await fetch(`/api/feedback-auth?${feedbackAuthParams.toString()}`);
    if (!feedbackAuthResponse.ok) {
      const errorData = await feedbackAuthResponse.json();
      throw new Error(errorData.message || errorData.error || 'Failed to get feedback auth');
    }

    const feedbackAuthData = await feedbackAuthResponse.json();
    const feedbackAuthId = feedbackAuthData.feedbackAuthId;
    const resolvedAgentId = feedbackAuthData.agentId || agentId;
    const resolvedChainId = feedbackAuthData.chainId || chainId;

    if (!feedbackAuthId) {
      throw new Error('No feedbackAuth returned by provider');
    }

    if (!resolvedAgentId) {
      throw new Error('Agent ID is required');
    }

    // Submit feedback
    const feedbackResponse = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentId: resolvedAgentId,
        chainId: resolvedChainId,
        score,
        feedback: comment,
        feedbackAuth: feedbackAuthId,
        clientAddress,
        ...(taskId && { taskId }),
        ...(contextId && { contextId }),
        ...(agentName && { agentName }),
      }),
    });

    if (!feedbackResponse.ok) {
      const errorData = await feedbackResponse.json();
      throw new Error(errorData.message || errorData.error || 'Failed to submit feedback');
    }

    const feedbackResult = await feedbackResponse.json();
    console.info('Feedback submitted successfully:', feedbackResult);
    return feedbackResult;
  };

  /**
   * Submit feedback with existing feedbackAuth
   * @param feedbackAuth - The feedbackAuth signature/ID
   * @param agentId - Agent ID
   * @param clientAddress - Client address
   * @param score - Rating score (1-100)
   * @param comment - Feedback comment
   */
  const handleFeedbackAuth = async (
    feedbackAuth: string,
    agentId: string,
    clientAddress: string,
    score: number = 85,
    comment: string = 'Feedback submitted via web client'
  ) => {
    if (!feedbackAuth || !agentId || !clientAddress) {
      throw new Error('Missing required feedback auth data: feedbackAuth, agentId, or clientAddress');
    }

    // Ensure signature is a string (hex format)
    if (typeof feedbackAuth !== 'string' || !feedbackAuth.startsWith('0x')) {
      throw new Error(`Invalid signature format. Expected hex string starting with 0x, got: ${typeof feedbackAuth}`);
    }

    console.info("Submitting feedback via server-side API...");

    // Submit feedback via server-side API route
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentId: agentId,
        score,
        feedback: comment,
        feedbackAuth: feedbackAuth,
        clientAddress: clientAddress,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || errorData.error || 'Failed to submit feedback');
    }

    const feedbackResult = await response.json();
    console.info('Feedback submitted successfully:', feedbackResult);
    return feedbackResult;
  };

  const handleSendMessage = async () => {
    // Add alert to verify function is called (for debugging)
    console.log("🚀 handleSendMessage called", { selectedAgent, endpoint, message });
    console.info("handleSendMessage", selectedAgent, endpoint, message);
    console.warn("⚠️ handleSendMessage - This should be visible in browser console");
    
    if (!selectedAgent || !endpoint || !message.trim()) {
      setError('Please select an agent, discover endpoint, and enter a message');
      return;
    }
    
    console.log("✅ Validation passed, proceeding with message send");

    try {
      setSending(true);
      setError(null);
      setResponse(null);

      if (!selectedAgent.agentId) {
        throw new Error('Agent ID is required');
      }

      // Build message request with optional skill targeting
      const messageRequest: MessageRequest = {
        message: message,
        payload: {
          source: 'web-client',
          timestamp: new Date().toISOString(),
        },
      };

      // If a skill is selected (e.g., general_movie_chat), add it to the request
      if (selectedSkill) {
        messageRequest.skillId = selectedSkill.id;
        messageRequest.payload = {
          ...messageRequest.payload,
          skillId: selectedSkill.id,
          skillName: selectedSkill.name,
        };
      }

      const agentChainId =
        typeof selectedAgent.chainId === 'number' && Number.isFinite(selectedAgent.chainId)
          ? selectedAgent.chainId
          : DEFAULT_CHAIN_ID;
      const agentDid = buildDid8004(agentChainId, selectedAgent.agentId);

      // Send message via server-side API
      const response = await fetch(`/api/agents/${agentDid}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageRequest),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to send message');
      }

      const data = await response.json();
      console.log("data returned from send message", JSON.stringify(data, null, 2));


      setResponse(data);

      console.log("data returned", JSON.stringify(data.response, null, 2));
      
      // If the response contains a feedback auth signature, automatically call giveClientFeedback
      if (data.response?.skill === 'agent.feedback.requestAuth' && data.response?.feedbackAuth) {
        console.log("process feedback auth request.............. ")
        try {
          // Get client address from server-side API
          const addressResponse = await fetch('/api/client-address');
          if (!addressResponse.ok) {
            throw new Error('Failed to get client address');
          }
          const addressData = await addressResponse.json();
          const clientAddress = addressData.clientAddress;

          console.log("&&&&&&&&&& clientAddress", clientAddress);
          
          if (!clientAddress) {
            throw new Error('Client address not available');
          }
          
          if (!selectedAgent?.agentId) {
            throw new Error('Agent ID not available');
          }
          
          await handleFeedbackAuth(data.response.feedbackAuth, selectedAgent.agentId.toString(), clientAddress);
        } catch (feedbackError) {
          console.error('Failed to submit feedback with auth:', feedbackError);
          // Don't throw - we still show the response
          setError(`Feedback auth received but failed to submit: ${feedbackError instanceof Error ? feedbackError.message : 'Unknown error'}`);
        }
      }
      
      setMessage(''); // Clear message after successful send
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackComment.trim()) {
      setError('Please enter a comment');
      return;
    }

    if (!selectedAgent) {
      setError('Please select an agent first');
      return;
    }

    setSubmittingFeedback(true);
    setError(null);
    setFeedbackSuccess(false);

    try {
      const agentName = selectedAgent.agentName || undefined;
      const agentId = selectedAgent.agentId?.toString();
      const chainId = selectedAgent.chainId;

      // Convert 1-5 star rating to 0-100 score
      const score = feedbackRating * 20;

      // Use agentName if available, otherwise pass undefined and let the API resolve by agentId+chainId
      await requestFeedbackAuthAndSubmit(
        agentName || undefined,
        agentId,
        chainId,
        score,
        feedbackComment
      );

      setFeedbackSuccess(true);
      setFeedbackComment('');
      setFeedbackRating(5);

      // Close dialog after a short delay
      setTimeout(() => {
        setFeedbackSuccess(false);
        setShowFeedbackDialog(false);
      }, 1500);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: 'bold' }}>
        Agent Client - Discover & Interact with Agents
      </h1>

      {loading && (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          Discovering agents...
        </div>
      )}

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

      {!loading && agents.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
            Available Agents
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '1rem',
            }}
          >
            {agents.map((agent) => (
              <div
                key={`${agent.chainId}-${agent.agentId}`}
                onClick={() => setSelectedAgent(agent)}
                style={{
                  padding: '1.5rem',
                  border: `2px solid ${selectedAgent?.agentId === agent.agentId ? '#667eea' : '#e5e7eb'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: selectedAgent?.agentId === agent.agentId ? '#f3f4f6' : 'white',
                  transition: 'all 0.2s',
                }}
              >
                <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                  {agent.agentName || `Agent #${agent.agentId}`}
                </h3>
                <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                  Chain ID: {agent.chainId || DEFAULT_CHAIN_ID}
                </p>
                {agent.a2aEndpoint && (
                  <p style={{ color: '#6b7280', fontSize: '0.875rem', wordBreak: 'break-all' }}>
                    Endpoint: {agent.a2aEndpoint}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && agents.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
          No agents found. Agents will appear here once they are registered.
        </div>
      )}

      {/* Feedback Dialog */}
      {showFeedbackDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={() => !submittingFeedback && setShowFeedbackDialog(false)}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              borderRadius: '12px',
              padding: '2rem',
              maxWidth: '500px',
              width: '100%',
              border: '1px solid #374151',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white', marginBottom: '1rem' }}>
              Give Feedback
            </h2>
            {selectedAgent?.agentName && (
              <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '1rem' }}>
                Agent: {selectedAgent.agentName}
              </p>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#d1d5db', marginBottom: '0.5rem' }}>
                Rating
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setFeedbackRating(num)}
                    disabled={submittingFeedback}
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '8px',
                      fontWeight: 600,
                      cursor: submittingFeedback ? 'not-allowed' : 'pointer',
                      backgroundColor: feedbackRating === num ? '#667eea' : '#374151',
                      color: 'white',
                      border: 'none',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#d1d5db', marginBottom: '0.5rem' }}>
                Comment
              </label>
              <textarea
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                placeholder="Enter your feedback..."
                disabled={submittingFeedback}
                style={{
                  width: '100%',
                  backgroundColor: '#374151',
                  color: 'white',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  border: '1px solid #4b5563',
                  resize: 'vertical',
                  minHeight: '100px',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {feedbackSuccess && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  backgroundColor: 'rgba(34, 197, 94, 0.2)',
                  border: '1px solid #22c55e',
                  borderRadius: '8px',
                }}
              >
                <p style={{ color: '#86efac', fontSize: '0.875rem' }}>Feedback submitted successfully!</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowFeedbackDialog(false)}
                disabled={submittingFeedback}
                style={{
                  flex: 1,
                  padding: '0.5rem 1rem',
                  backgroundColor: '#374151',
                  color: 'white',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: submittingFeedback ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: submittingFeedback ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFeedbackSubmit}
                disabled={submittingFeedback || !feedbackComment.trim()}
                style={{
                  flex: 1,
                  padding: '0.5rem 1rem',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: submittingFeedback || !feedbackComment.trim() ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: submittingFeedback || !feedbackComment.trim() ? 0.6 : 1,
                }}
              >
                {submittingFeedback ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Button */}
      {selectedAgent && (
        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => setShowFeedbackDialog(true)}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '1rem',
            }}
          >
            💬 Give Feedback
          </button>
        </div>
      )}

    </main>
  );
}
