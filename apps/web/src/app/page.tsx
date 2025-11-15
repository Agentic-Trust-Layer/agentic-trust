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




  const handleFeedbackAuth = async (feedbackAuth: string, agentId: string, clientAddress: string) => {


    if (!feedbackAuth || !agentId || !clientAddress) {
      throw new Error('Missing required feedback auth data: feedbackAuth, agentId, or clientAddress');
    }

    // Ensure signature is a string (hex format)
    if (typeof feedbackAuth !== 'string' || !feedbackAuth.startsWith('0x')) {
      throw new Error(`Invalid signature format. Expected hex string starting with 0x, got: ${typeof feedbackAuth}`);
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
        agentId: agentId,
        score: 85, // Example score - you could make this configurable or prompt the user
        feedback: 'Feedback submitted via web client after requestAuth',
        feedbackAuth: feedbackAuth, // This is the encoded tuple + signature
        clientAddress: clientAddress, // Pass the clientAddress from the auth
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
      console.info("data returned from send message", JSON.stringify(data, null, 2));


      setResponse(data);

      console.info("data returned", JSON.stringify(data.response, null, 2));
      
      // If the response contains a feedback auth signature, automatically call giveClientFeedback
      if (data.response?.skill === 'agent.feedback.requestAuth' && data.response?.feedbackAuth) {
        try {
          // Get client address from server-side API
          const addressResponse = await fetch('/api/client-address');
          if (!addressResponse.ok) {
            throw new Error('Failed to get client address');
          }
          const addressData = await addressResponse.json();
          const clientAddress = addressData.clientAddress;

          console.info("&&&&&&&&&& clientAddress", clientAddress);
          
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

    </main>
  );
}
