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

  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackTag1, setFeedbackTag1] = useState('');
  const [feedbackTag2, setFeedbackTag2] = useState('');
  const [showFeedbackListDialog, setShowFeedbackListDialog] = useState(false);
  const [feedbackListLoading, setFeedbackListLoading] = useState(false);
  const [feedbackListError, setFeedbackListError] = useState<string | null>(null);
  const [feedbackList, setFeedbackList] = useState<any[] | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<{ count: string | number; averageScore: number } | null>(null);
  const [feedbackSkills, setFeedbackSkills] = useState<AgentSkill[]>([]);
  const [feedbackSkillId, setFeedbackSkillId] = useState<string>('');
  const [feedbackContext, setFeedbackContext] = useState('');
  const [feedbackCapability, setFeedbackCapability] = useState('');
  const [feedbackJsonByUri, setFeedbackJsonByUri] = useState<Record<string, { loading: boolean; error: string | null; data: any | null }>>({});

  // Fetch agents (optionally with a query)
  const fetchAgents = async (query?: string) => {
    try {
      setLoading(true);
      setError(null);

      const trimmed = query?.trim();
      const payload =
        trimmed && trimmed.length > 0
          ? { query: trimmed, page: 1, pageSize: 50 }
          : {};

      const response = await fetch('/api/agents/search', {
        method: Object.keys(payload).length > 0 ? 'POST' : 'GET',
        headers: Object.keys(payload).length > 0 ? { 'Content-Type': 'application/json' } : undefined,
        body: Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined,
      });

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

  // Initial load
  useEffect(() => {
    fetchAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load agent.json when opening the feedback dialog so we can
  // populate skill dropdowns from the agent's declared skills.
  useEffect(() => {
    const loadCard = async () => {
      if (!showFeedbackDialog || !selectedAgent || !selectedAgent.agentId) {
        return;
      }

      try {
        const agentChainId =
          typeof selectedAgent.chainId === 'number' && Number.isFinite(selectedAgent.chainId)
            ? selectedAgent.chainId
            : DEFAULT_CHAIN_ID;
        const did = buildDid8004(agentChainId, selectedAgent.agentId);

        const response = await fetch(
          `/api/agents/${encodeURIComponent(did)}/card`,
        );
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        const card = data.card as AgentCard | undefined;
        if (card) {
          setAgentCard(card);
          const skills = Array.isArray(card.skills) ? card.skills : [];
          setFeedbackSkills(skills);
          if (skills.length > 0 && !feedbackSkillId) {
            setFeedbackSkillId(skills[0].id);
          }
        }
      } catch {
        // Best-effort only; dialog will still work without skills.
      }
    };

    void loadCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFeedbackDialog, selectedAgent]);

  /**
   * Request feedbackAuth from provider and submit feedback
   * @param agentName - Agent name (ENS name, optional if agentId+chainId provided)
   * @param agentId - Agent ID (required if agentName not provided)
   * @param chainId - Chain ID (required if agentName not provided)
   * @param score - Rating score (1-100)
   * @param comment - Feedback comment
   * @param taskId - Optional task ID
   * @param contextId - Optional context ID
   * @param tag1 - Optional feedback tag1
   * @param tag2 - Optional feedback tag2
   * @param skill - Optional skill identifier from agent.json
   * @param context - Optional feedback context
   * @param capability - Optional capability label
   */
  const requestFeedbackAuthAndSubmit = async (
    agentName: string | undefined,
    agentId: string | undefined,
    chainId: number | undefined,
    score: number,
    comment: string,
    taskId?: string,
    contextId?: string,
    tag1?: string,
    tag2?: string,
    skill?: string,
    context?: string,
    capability?: string,
  ) => {
    if (!agentId || !chainId) {
      throw new Error('Agent ID and chain ID are required to request feedback auth');
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
      agentId,
      chainId: chainId.toString(),
      ...(agentName ? { agentName } : {}),
    });

    const didForAuth = buildDid8004(chainId, agentId);
    const feedbackAuthResponse = await fetch(
      `/api/agents/${encodeURIComponent(
        didForAuth,
      )}/feedback-auth?${feedbackAuthParams.toString()}`,
    );
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

    // Build DID for direct server-side feedback submission
    const didForFeedback = buildDid8004(resolvedChainId, resolvedAgentId);

    // Submit feedback directly via server-side API route
    const feedbackResponse = await fetch(
      `/api/agents/${encodeURIComponent(didForFeedback)}/feedback-direct`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          score,
          feedback: comment,
          feedbackAuth: feedbackAuthId,
          clientAddress,
          ...(taskId && { taskId }),
          ...(contextId && { contextId }),
          ...(agentName && { agentName }),
          ...(tag1 && { tag1 }),
          ...(tag2 && { tag2 }),
          ...(skill && { skill }),
          ...(context && { context }),
          ...(capability && { capability }),
        }),
      },
    );

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
    comment: string = 'Feedback submitted via web client',
    tag1?: string,
    tag2?: string,
  ) => {
    if (!feedbackAuth || !agentId || !clientAddress) {
      throw new Error('Missing required feedback auth data: feedbackAuth, agentId, or clientAddress');
    }

    // Ensure signature is a string (hex format)
    if (typeof feedbackAuth !== 'string' || !feedbackAuth.startsWith('0x')) {
      throw new Error(`Invalid signature format. Expected hex string starting with 0x, got: ${typeof feedbackAuth}`);
    }

    console.info("Submitting feedback via server-side API...");

    // Build DID for direct server-side feedback submission
    const directChainId = DEFAULT_CHAIN_ID; // Fallback chain, or derive if you have it in scope
    const didForDirect = buildDid8004(directChainId, agentId);

    // Submit feedback via server-side API route
    const response = await fetch(
      `/api/agents/${encodeURIComponent(didForDirect)}/feedback-direct`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          score,
          feedback: comment,
          feedbackAuth: feedbackAuth,
          clientAddress: clientAddress,
          ...(tag1 && { tag1 }),
          ...(tag2 && { tag2 }),
        }),
      },
    );

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
      if (data.response?.skill === 'oasf:trust.feedback.authorization' && data.response?.feedbackAuth) {
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
        feedbackComment,
        undefined,
        undefined,
        feedbackTag1 || undefined,
        feedbackTag2 || undefined,
        feedbackSkillId || undefined,
        feedbackContext || undefined,
        feedbackCapability || undefined,
      );

      setFeedbackSuccess(true);
      setFeedbackComment('');
      setFeedbackRating(5);
      setFeedbackTag1('');
      setFeedbackTag2('');
      setFeedbackSkillId('');
      setFeedbackContext('');
      setFeedbackCapability('');

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

  const openFeedbackListForSelectedAgent = async () => {
    if (!selectedAgent || !selectedAgent.agentId) {
      setError('Please select an agent first');
      return;
    }

    try {
      setShowFeedbackListDialog(true);
      setFeedbackListLoading(true);
      setFeedbackListError(null);
      setFeedbackList(null);
      setFeedbackSummary(null);

      const agentChainId =
        typeof selectedAgent.chainId === 'number' && Number.isFinite(selectedAgent.chainId)
          ? selectedAgent.chainId
          : DEFAULT_CHAIN_ID;
      const agentDid = buildDid8004(agentChainId, selectedAgent.agentId);

      const response = await fetch(
        `/api/agents/${encodeURIComponent(agentDid)}/feedback?includeRevoked=true`,
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to load feedback');
      }

      const data = await response.json();
      setFeedbackList(Array.isArray(data.feedback) ? data.feedback : []);
      setFeedbackSummary(data.summary ?? null);
    } catch (err) {
      console.error('Failed to load feedback list:', err);
      setFeedbackListError(
        err instanceof Error ? err.message : 'Failed to load feedback',
      );
    } finally {
      setFeedbackListLoading(false);
    }
  };

  const ensureFeedbackJsonLoaded = async (uri: string | undefined) => {
    if (!uri) return;

    const existing = feedbackJsonByUri[uri];
    if (existing && (existing.loading || existing.data || existing.error)) {
      return;
    }

    setFeedbackJsonByUri(prev => ({
      ...prev,
      [uri]: { loading: true, error: null, data: null },
    }));

    try {
      const json = await loadFeedbackJson(uri);
      setFeedbackJsonByUri(prev => ({
        ...prev,
        [uri]: { loading: false, error: null, data: json },
      }));
    } catch (error: any) {
      setFeedbackJsonByUri(prev => ({
        ...prev,
        [uri]: {
          loading: false,
          error: error?.message ?? 'Failed to load feedback JSON',
          data: null,
        },
      }));
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

      {!loading && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
            Available Agents
          </h2>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  fetchAgents(searchQuery);
                }
              }}
              placeholder="Search agents by name, endpoint, or metadata"
              aria-label="Search agents"
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
              }}
            />
            <button
              type="button"
              onClick={() => fetchAgents(searchQuery)}
              disabled={loading}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#4f46e5',
                color: 'white',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
          {agents.length > 0 ? (
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
                <p style={{ color: '#374151', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                  Agent ID: {agent.agentId ?? 'Unknown'}
                </p>
                <p style={{ color: '#374151', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  DID: {buildDid8004(agent.chainId ?? DEFAULT_CHAIN_ID, agent.agentId ?? 0)}
                </p>
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
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
              No agents found. Agents will appear here once they are registered.
            </div>
          )}
        </div>
      )}

      {/* Give Feedback Dialog */}
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

            {feedbackSkills.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: '#d1d5db',
                    marginBottom: '0.5rem',
                  }}
                >
                  Skill (optional)
                </label>
                <select
                  value={feedbackSkillId}
                  onChange={e => setFeedbackSkillId(e.target.value)}
                  disabled={submittingFeedback}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #4b5563',
                    backgroundColor: '#111827',
                    color: 'white',
                    fontSize: '0.875rem',
                  }}
                >
                  <option value="">Select a skill…</option>
                  {feedbackSkills.map(skill => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name || skill.id}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.75rem' }}>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#d1d5db',
                    marginBottom: '0.25rem',
                  }}
                >
                  Tag 1 (optional)
                </label>
                <input
                  type="text"
                  value={feedbackTag1}
                  onChange={e => setFeedbackTag1(e.target.value)}
                  placeholder="e.g. quality, speed"
                  disabled={submittingFeedback}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #4b5563',
                    backgroundColor: '#111827',
                    color: 'white',
                    fontSize: '0.875rem',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#d1d5db',
                    marginBottom: '0.25rem',
                  }}
                >
                  Tag 2 (optional)
                </label>
                <input
                  type="text"
                  value={feedbackTag2}
                  onChange={e => setFeedbackTag2(e.target.value)}
                  placeholder="e.g. helpful, safe"
                  disabled={submittingFeedback}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #4b5563',
                    backgroundColor: '#111827',
                    color: 'white',
                    fontSize: '0.875rem',
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.75rem' }}>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#d1d5db',
                    marginBottom: '0.25rem',
                  }}
                >
                  Context (optional)
                </label>
                <input
                  type="text"
                  value={feedbackContext}
                  onChange={e => setFeedbackContext(e.target.value)}
                  placeholder="e.g. enterprise, research"
                  disabled={submittingFeedback}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #4b5563',
                    backgroundColor: '#111827',
                    color: 'white',
                    fontSize: '0.875rem',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#d1d5db',
                    marginBottom: '0.25rem',
                  }}
                >
                  Capability (optional)
                </label>
                <input
                  type="text"
                  value={feedbackCapability}
                  onChange={e => setFeedbackCapability(e.target.value)}
                  placeholder="e.g. problem_solving"
                  disabled={submittingFeedback}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #4b5563',
                    backgroundColor: '#111827',
                    color: 'white',
                    fontSize: '0.875rem',
                  }}
                />
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

      {/* View Feedback Dialog */}
      {showFeedbackListDialog && (
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
          onClick={() => setShowFeedbackListDialog(false)}
        >
          <div
            style={{
              backgroundColor: '#111827',
              borderRadius: '12px',
              padding: '1.5rem',
              maxWidth: '720px',
              width: '100%',
              border: '1px solid #374151',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 'bold',
                color: 'white',
                marginBottom: '0.75rem',
              }}
            >
              Feedback for{' '}
              {selectedAgent?.agentName || `Agent #${selectedAgent?.agentId}`}
            </h2>

            {feedbackSummary && (
              <div
                style={{
                  display: 'flex',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  marginBottom: '0.75rem',
                  fontSize: '0.875rem',
                  color: '#e5e7eb',
                }}
              >
                <span>
                  <strong>Count:</strong> {feedbackSummary.count}
                </span>
                <span>
                  <strong>Average score:</strong> {feedbackSummary.averageScore}
                </span>
              </div>
            )}

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                borderRadius: '8px',
                border: '1px solid #374151',
                padding: '0.75rem',
                backgroundColor: '#020617',
              }}
            >
              {feedbackListLoading ? (
                <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                  Loading feedback…
                </div>
              ) : feedbackListError ? (
                <div style={{ color: '#fca5a5', fontSize: '0.875rem' }}>
                  {feedbackListError}
                </div>
              ) : !feedbackList || feedbackList.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                  No feedback entries found for this agent.
                </div>
              ) : (
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    fontSize: '0.85rem',
                  }}
                >
                  {feedbackList.map((item, index) => {
                    const record = item as any;
                    const clientAddress = record.clientAddress as string | undefined;
                    const score = record.score as number | undefined;
                    const isRevoked = record.isRevoked as boolean | undefined;
                    const feedbackUri = record.feedbackUri as string | undefined;
                    const tag1 = record.tag1 as string | undefined;
                    const tag2 = record.tag2 as string | undefined;
                    const feedbackHash = record.feedbackHash as string | undefined;
                    const createdAtTime = record.createdAtTime as
                      | string
                      | number
                      | undefined;
                    const indexValue = record.index as number | string | undefined;
                    const recordAgentId = record.agentId as
                      | string
                      | number
                      | undefined;
                    const recordChainId = record.chainId as number | undefined;

                    return (
                      <li
                        key={record.index ?? index}
                        style={{
                          padding: '0.6rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid #374151',
                          backgroundColor: '#020617',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            marginBottom: '0.25rem',
                          }}
                        >
                          <span>
                            <strong>Score:</strong>{' '}
                            {typeof score === 'number' ? score : 'N/A'}
                          </span>
                          {typeof isRevoked === 'boolean' && isRevoked && (
                            <span style={{ color: '#fca5a5', fontWeight: 600 }}>
                              Revoked
                            </span>
                          )}
                        </div>
                        {clientAddress && (
                          <div
                            style={{
                              fontFamily: 'monospace',
                              fontSize: '0.78rem',
                              color: '#9ca3af',
                              marginBottom:
                                feedbackUri ||
                                tag1 ||
                                tag2 ||
                                createdAtTime ||
                                feedbackHash
                                  ? '0.25rem'
                                  : 0,
                              wordBreak: 'break-all',
                            }}
                          >
                            {clientAddress}
                          </div>
                        )}
                        {(tag1 || tag2 || createdAtTime || feedbackHash) && (
                          <div
                            style={{
                              fontSize: '0.78rem',
                              color: '#e5e7eb',
                              marginBottom: feedbackUri ? '0.25rem' : 0,
                            }}
                          >
                            {tag1 && (
                              <span>
                                <strong>Tag1:</strong> {tag1}{' '}
                              </span>
                            )}
                            {tag2 && (
                              <span>
                                <strong>Tag2:</strong> {tag2}{' '}
                              </span>
                            )}
                            {createdAtTime !== undefined && createdAtTime !== null && (
                              <span>
                                <strong>Created:</strong>{' '}
                                {String(createdAtTime)}{' '}
                              </span>
                            )}
                            {feedbackHash && (
                              <span>
                                <strong>Hash:</strong>{' '}
                                {feedbackHash.length > 18
                                  ? `${feedbackHash.slice(0, 10)}…${feedbackHash.slice(
                                      -6,
                                    )}`
                                  : feedbackHash}
                              </span>
                            )}
                          </div>
                        )}
                        {feedbackUri && (
                          <details
                            onToggle={event => {
                              const el = event.currentTarget as HTMLDetailsElement;
                              if (el.open) {
                                void ensureFeedbackJsonLoaded(feedbackUri);
                              }
                            }}
                            style={{
                              marginTop: '0.25rem',
                              fontSize: '0.78rem',
                              color: '#9ca3af',
                            }}
                          >
                            <summary style={{ cursor: 'pointer' }}>
                              Feedback JSON (IPFS)
                            </summary>
                            <div
                              style={{
                                marginTop: '0.25rem',
                                borderRadius: '6px',
                                backgroundColor: '#020617',
                                padding: '0.4rem 0.5rem',
                                border: '1px solid #1f2937',
                                maxHeight: '260px',
                                overflow: 'auto',
                              }}
                            >
                              {(() => {
                                const state = feedbackJsonByUri[feedbackUri];
                                if (!state || state.loading) {
                                  return (
                                    <span style={{ color: '#9ca3af' }}>
                                      Loading feedback JSON…
                                    </span>
                                  );
                                }
                                if (state.error) {
                                  return (
                                    <span style={{ color: '#fca5a5' }}>
                                      {state.error}
                                    </span>
                                  );
                                }
                                if (!state.data) {
                                  return (
                                    <span style={{ color: '#9ca3af' }}>
                                      No JSON data available.
                                    </span>
                                  );
                                }
                                return (
                                  <pre
                                    style={{
                                      margin: 0,
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {JSON.stringify(state.data, null, 2)}
                                  </pre>
                                );
                              })()}
                            </div>
                          </details>
                        )}
                        {(indexValue !== undefined ||
                          recordAgentId !== undefined ||
                          recordChainId !== undefined) && (
                          <div
                            style={{
                              marginTop: '0.25rem',
                              fontSize: '0.75rem',
                              color: '#6b7280',
                            }}
                          >
                            {indexValue !== undefined && (
                              <span>
                                <strong>Index:</strong> {String(indexValue)}{' '}
                              </span>
                            )}
                            {recordAgentId !== undefined && (
                              <span>
                                <strong>AgentId:</strong> {String(recordAgentId)}{' '}
                              </span>
                            )}
                            {recordChainId !== undefined && (
                              <span>
                                <strong>Chain:</strong> {recordChainId}
                              </span>
                            )}
                          </div>
                        )}
                        <details
                          style={{
                            marginTop: '0.35rem',
                            fontSize: '0.75rem',
                            color: '#9ca3af',
                          }}
                        >
                          <summary style={{ cursor: 'pointer' }}>
                            Raw entry
                          </summary>
                          <pre
                            style={{
                              marginTop: '0.25rem',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {JSON.stringify(record, null, 2)}
                          </pre>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div
              style={{
                marginTop: '0.75rem',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                onClick={() => setShowFeedbackListDialog(false)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#374151',
                  color: 'white',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Buttons */}
      {selectedAgent && (
        <div
          style={{
            marginTop: '2rem',
            display: 'flex',
            justifyContent: 'center',
            gap: '0.75rem',
          }}
        >
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
          <button
            type="button"
            onClick={() => openFeedbackListForSelectedAgent()}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#111827',
              color: 'white',
              borderRadius: '8px',
              border: '1px solid #4b5563',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '1rem',
            }}
          >
            📊 View Feedback
          </button>
        </div>
      )}

    </main>
  );
}

async function loadFeedbackJson(uri: string): Promise<any> {
  const trimmed = uri?.trim();
  if (!trimmed) {
    throw new Error('Feedback URI is empty.');
  }

  // Basic ipfs:// handling – map to a public gateway
  let resolvedUrl = trimmed;
  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length);
    resolvedUrl = `https://ipfs.io/ipfs/${path}`;
  }

  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch feedback JSON (HTTP ${response.status}).`);
  }

  // Try to parse as JSON; fall back to text if needed
  try {
    return await response.json();
  } catch {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
}
