'use client';

import { useEffect, useState } from 'react';
import type { AgentCard, AgentSkill, MessageRequest } from '@agentic-trust/core';

// Plain agent data type from API (not Agent instances)
type AgentData = {
  agentId?: number;
  agentName?: string;
  a2aEndpoint?: string;
  createdAtTime?: string;
  updatedAtTime?: string;
};

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

  useEffect(() => {
    async function fetchAgents() {
      try {
        setLoading(true);
        setError(null);
        
        console.info('************* Fetching agents via API *************');
        const response = await fetch('/api/agents');
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || errorData.error || 'Failed to fetch agents');
        }
        
        const data = await response.json();
        setAgents(data.agents || []);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      } finally {
        setLoading(false);
      }
    }

    fetchAgents();
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      // If search is empty, fetch all agents
      try {
        const response = await fetch('/api/agents');
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || errorData.error || 'Failed to fetch agents');
        }
        const data = await response.json();
        setAgents(data.agents || []);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      }
      return;
    }

    try {
      setIsSearching(true);
      setError(null);
      
      console.info("search agents via API", searchQuery.trim());
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to search agents');
      }
      
      const data = await response.json();
      setAgents(data.agents || []);
    } catch (err) {
      console.error('Failed to search agents:', err);
      setError(err instanceof Error ? err.message : 'Failed to search agents');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleDiscoverEndpoint = async (agent: AgentData) => {
    try {
      setSelectedAgent(agent);
      setEndpoint(null);
      setAgentCard(null);
      setSelectedSkill(null);
      setError(null);
      setLoadingAgentCard(true);
      setVerificationResult(null); // Reset verification result when selecting new agent
      
      if (!agent.agentId) {
        throw new Error('Agent ID is required');
      }
      
      // Fetch agent card via server-side API
      const response = await fetch(`/api/agents/${agent.agentId}/card`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to fetch agent card');
      }
      
      const data = await response.json();
      
      if (data.card) {
        setAgentCard(data.card);
        
        if (data.supportsProtocol && data.endpoint) {
          setEndpoint(data.endpoint);
        } else {
          setError('Agent does not support messaging protocol (missing skills or endpoint)');
        }
      } else {
        setError('Could not fetch agent card from endpoint');
      }
    } catch (err) {
      console.error('Failed to discover endpoint:', err);
      setError(err instanceof Error ? err.message : 'Failed to discover endpoint');
    } finally {
      setLoadingAgentCard(false);
    }
  };

  const handleFeedbackAuth = async (authResponse: Record<string, unknown>) => {
    // Extract feedback auth data from response
    console.info("authResponse", JSON.stringify(authResponse, null, 2));
    
    // Extract the signature from the response (feedbackAuth is encoded tuple + signature)
    const signature = authResponse.signature;
    const agentId = authResponse.agentId;
    const authClientAddress = authResponse.clientAddress; // Address encoded in the auth

    if (!signature || !agentId || !authClientAddress) {
      throw new Error('Missing required feedback auth data: signature, agentId, or clientAddress');
    }

    // Ensure signature is a string (hex format)
    if (typeof signature !== 'string' || !signature.startsWith('0x')) {
      throw new Error(`Invalid signature format. Expected hex string starting with 0x, got: ${typeof signature}`);
    }

    console.info("Submitting feedback via server-side API...");

    // Submit feedback via server-side API route
    // This avoids RPC provider issues and keeps private keys on the server
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentId: agentId.toString(),
        score: 85, // Example score - you could make this configurable or prompt the user
        feedback: 'Feedback submitted via web client after requestAuth',
        feedbackAuth: signature, // This is the encoded tuple + signature
        clientAddress: authClientAddress, // Pass the clientAddress from the auth
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

      // Send message via server-side API
      const response = await fetch(`/api/agents/${selectedAgent.agentId}/send`, {
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
      setResponse(data);

      console.info("data returned", JSON.stringify(data.response, null, 2));
      
      // If the response contains a feedback auth signature, automatically call giveClientFeedback
      if (data.response?.signature && data.response?.skill === 'agent.feedback.requestAuth') {
        try {
          console.info("data.response", JSON.stringify(data.response, null, 2));
          await handleFeedbackAuth(data.response);
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Agents List */}
        <div>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>
            Discovered Agents ({agents.length})
          </h2>

          {/* Search Input */}
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Search by agent name..."
              value={searchQuery}
              onChange={handleSearchInputChange}
              onKeyDown={handleSearchKeyDown}
              style={{
                flex: 1,
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '1rem',
              }}
            />
            <button
              onClick={handleSearch}
              disabled={isSearching}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: isSearching ? '#ccc' : '#0066cc',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: isSearching ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
            {searchQuery && (
              <button
                onClick={async () => {
                  setSearchQuery('');
                  // Fetch all agents when clearing search
                  const response = await fetch('/api/agents');
                  if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || errorData.error || 'Failed to fetch agents');
                  }
                  const data = await response.json();
                  setAgents(data.agents || []);
                }}
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#666',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                }}
              >
                Clear
              </button>
            )}
          </div>

          {agents.length === 0 && !loading ? (
            <div
              style={{
                padding: '2rem',
                textAlign: 'center',
                backgroundColor: '#fff',
                borderRadius: '8px',
                border: '1px solid #ddd',
              }}
            >
              No agents found
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {agents.map((agent, index) => (
                <div
                  key={index}
                  style={{
                    padding: '1.5rem',
                    backgroundColor: selectedAgent === agent ? '#e6f3ff' : '#fff',
                    borderRadius: '8px',
                    border: `2px solid ${selectedAgent === agent ? '#0066cc' : '#ddd'}`,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                  }}
                  onClick={() => handleDiscoverEndpoint(agent)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        {agent.agentName ? (
                          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold' }}>
                            {agent.agentName}
                          </h3>
                        ) : (
                          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold' }}>
                            Agent {index + 1}
                          </h3>
                        )}
                        {agent.agentId !== undefined && (
                          <span
                            style={{
                              padding: '0.25rem 0.5rem',
                              backgroundColor: '#f0f0f0',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              color: '#666',
                              fontWeight: '500',
                            }}
                          >
                            ID: {agent.agentId}
                          </span>
                        )}
                      </div>
                      {agent.createdAtTime && (
                        <div style={{ fontSize: '0.85rem', color: '#666' }}>
                          Created: {new Date(agent.createdAtTime).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDiscoverEndpoint(agent);
                      }}
                      style={{
                        padding: '0.5rem 1rem',
                        backgroundColor: '#0066cc',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                      }}
                    >
                      Discover Endpoint
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent Communication Panel */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>
              Agent Communication
            </h2>
            {selectedAgent && selectedAgent.agentId !== undefined && (
              <button
                onClick={async () => {
                  if (!selectedAgent?.agentId) return;
                  
                  setVerifying(true);
                  setVerificationResult(null);
                  setError(null);
                  
                  try {
                    const response = await fetch(`/api/agents/${selectedAgent.agentId}/verify`, {
                      method: 'POST',
                    });
                    
                    if (!response.ok) {
                      const errorData = await response.json();
                      throw new Error(errorData.message || errorData.error || 'Failed to verify agent');
                    }
                    
                    const data = await response.json();
                    setVerificationResult(data.valid);
                  } catch (err) {
                    console.error('Failed to verify agent:', err);
                    setError(err instanceof Error ? err.message : 'Failed to verify agent');
                    setVerificationResult(false);
                  } finally {
                    setVerifying(false);
                  }
                }}
                disabled={verifying || !selectedAgent}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: verifying ? '#ccc' : '#28a745',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: verifying || !selectedAgent ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                {verifying ? (
                  <>
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <span>✓</span>
                    <span>Verify</span>
                  </>
                )}
              </button>
            )}
          </div>
          
          {verificationResult !== null && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.75rem 1rem',
                backgroundColor: verificationResult ? '#e8f5e9' : '#ffebee',
                border: `1px solid ${verificationResult ? '#4caf50' : '#f44336'}`,
                borderRadius: '4px',
                color: verificationResult ? '#2e7d32' : '#c62828',
                fontSize: '0.9rem',
                fontWeight: 'bold',
              }}
            >
              {verificationResult ? '✓ Verification Successful' : '✗ Verification Failed'}
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
            {!selectedAgent ? (
              <div style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>
                Select an agent from the list to discover its capabilities
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.25rem' }}>
                    Selected Agent
                  </div>
                  <div style={{ fontWeight: 'bold' }}>
                    {selectedAgent.agentName || 'Unknown Agent'}
                    {selectedAgent.agentId !== undefined && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
                        (ID: {selectedAgent.agentId})
                      </span>
                    )}
                  </div>
                </div>

                {loadingAgentCard ? (
                  <div style={{ color: '#666', textAlign: 'center', padding: '1rem' }}>
                    Loading agent capabilities...
                  </div>
                ) : agentCard ? (
                  <>
                    {/* Protocol Support Status */}
                    <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#e8f5e9', borderRadius: '4px', border: '1px solid #4caf50' }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#2e7d32', marginBottom: '0.25rem' }}>
                        ✓ Protocol Supported
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#666' }}>
                        {agentCard.name} - {agentCard.description || 'No description'}
                      </div>
                      {agentCard.capabilities && (
                        <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                          Capabilities: {Object.entries(agentCard.capabilities)
                            .filter(([_, v]) => v === true)
                            .map(([k]) => k)
                            .join(', ') || 'None'}
                        </div>
                      )}
                    </div>

                    {/* Endpoint */}
                    {endpoint && (
                      <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                        <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>
                          Endpoint
                        </div>
                        <div style={{ fontSize: '0.85rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          {endpoint.endpoint}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>
                          Method: {endpoint.method || 'POST'}
                        </div>
                      </div>
                    )}

                    {/* Skills Selection */}
                    {agentCard.skills && agentCard.skills.length > 0 && (
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 'bold' }}>
                          Select Skill (optional):
                        </label>
                        <select
                          value={selectedSkill?.id || ''}
                          onChange={(e) => {
                            const skill = agentCard.skills?.find(s => s.id === e.target.value);
                            setSelectedSkill(skill || null);
                          }}
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '0.9rem',
                            fontFamily: 'inherit',
                          }}
                        >
                          <option value="">None (general message)</option>
                          {agentCard.skills.map((skill) => (
                            <option key={skill.id} value={skill.id}>
                              {skill.name}
                            </option>
                          ))}
                        </select>
                        {selectedSkill && (
                          <div style={{ marginTop: '0.5rem', padding: '0.75rem', backgroundColor: '#fff3e0', borderRadius: '4px', fontSize: '0.85rem' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>{selectedSkill.name}</div>
                            {selectedSkill.description && (
                              <div style={{ color: '#666', marginBottom: '0.25rem' }}>{selectedSkill.description}</div>
                            )}
                            {selectedSkill.examples && selectedSkill.examples.length > 0 && (
                              <div style={{ color: '#666', fontSize: '0.8rem' }}>
                                Examples: {selectedSkill.examples.slice(0, 2).join(', ')}
                                {selectedSkill.examples.length > 2 && '...'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Message Input */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 'bold' }}>
                        Message to send:
                      </label>
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={selectedSkill?.id === 'general_movie_chat' 
                          ? "Ask about movies, actors, directors... (e.g., 'Tell me about the plot of Inception')"
                          : "Enter your message here..."
                        }
                        style={{
                          width: '100%',
                          minHeight: '100px',
                          padding: '0.75rem',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '0.9rem',
                          fontFamily: 'inherit',
                        }}
                      />
                    </div>

                    {/* Send Button */}
                    <button
                      onClick={handleSendMessage}
                      disabled={sending || !message.trim()}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        backgroundColor: sending || !message.trim() ? '#ccc' : '#0066cc',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: sending || !message.trim() ? 'not-allowed' : 'pointer',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {sending ? 'Sending...' : selectedSkill ? `Send to ${selectedSkill.name}` : 'Send Message'}
                    </button>

                    {/* Response Display */}
                    {response && (
                      <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#e3f2fd', borderRadius: '4px', border: '1px solid #2196f3' }}>
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#1976d2', marginBottom: '0.5rem' }}>
                          Response
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#333' }}>
                          {response.response?.response ? (
                            <div>
                              <div style={{ marginBottom: '0.5rem', fontWeight: 'bold' }}>
                                {response.response.response}
                              </div>
                              {response.response.skill && (
                                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                                  Skill: {response.response.skill}
                                </div>
                              )}
                            </div>
                          ) : (
                            <pre style={{ margin: 0, fontSize: '0.85rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {JSON.stringify(response, null, 2)}
                            </pre>
                          )}
                        </div>
                        {response.messageId && (
                          <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.5rem' }}>
                            Message ID: {response.messageId}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ color: '#666', textAlign: 'center', padding: '1rem' }}>
                    No agent card found. Click &quot;Discover Endpoint&quot; to load agent capabilities.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
