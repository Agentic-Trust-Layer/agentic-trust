'use client';

import { useState, useEffect } from 'react';
import { useWeb3Auth } from '@/components/Web3AuthProvider';
import { useWallet } from '@/components/WalletProvider';
import { LoginPage } from '@/components/LoginPage';
import type { Address } from 'viem';
import { createAgentWithWallet } from '@agentic-trust/core/client';

type Agent = {
  agentId?: number;
  agentName?: string;
  a2aEndpoint?: string;
  createdAtTime?: string;
  updatedAtTime?: string;
};

export default function AdminPage() {
  const { connected: web3AuthConnected, address: web3AuthAddress, userInfo, disconnect: web3AuthDisconnect, loading: authLoading } = useWeb3Auth();
  const { connected: walletConnected, address: walletAddress, connect: walletConnect, disconnect: walletDisconnect, loading: walletLoading } = useWallet();
  
  // Use either Web3Auth or direct wallet connection
  const eoaConnected = web3AuthConnected || walletConnected;
  const eoaAddress = web3AuthAddress || walletAddress;
  const loading = authLoading || walletLoading;
  
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filteredAgents, setFilteredAgents] = useState<Agent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showAgentDialog, setShowAgentDialog] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  
  // Agent data from different sources
  const [contractData, setContractData] = useState<any>(null);
  const [ipfsData, setIpfsData] = useState<any>(null);
  const [graphQLData, setGraphQLData] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(false);

  // Create agent form state
  const [createForm, setCreateForm] = useState({
    agentName: '',
    agentAccount: '',
    description: '',
    image: '',
    agentUrl: '',
  });

  // Update agent form state
  const [updateForm, setUpdateForm] = useState({
    agentId: '',
    tokenURI: '',
    metadataKey: '',
    metadataValue: '',
  });

  // Delete agent form state
  const [deleteForm, setDeleteForm] = useState({
    agentId: '',
  });

  // Transfer agent form state
  const [transferForm, setTransferForm] = useState({
    agentId: '',
    to: '',
  });

  // Fetch agents on mount (only if connected)
  useEffect(() => {
    if (eoaConnected && !loading) {
      fetchAgents();
    }
  }, [eoaConnected, loading]);

  // Set agent account from logged in user address
  useEffect(() => {
    if (eoaAddress) {
      setCreateForm(prev => ({
        ...prev,
        agentAccount: eoaAddress,
      }));
    }
  }, [eoaAddress]);

  // Filter agents based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredAgents(agents);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = agents.filter(agent => {
      const agentIdMatch = agent.agentId?.toString().toLowerCase().includes(query);
      const agentNameMatch = agent.agentName?.toLowerCase().includes(query);
      return agentIdMatch || agentNameMatch;
    });
    setFilteredAgents(filtered);
  }, [searchQuery, agents]);

         // Handle agent row click
         const handleAgentClick = async (agent: Agent) => {
           setSelectedAgent(agent);
           setShowAgentDialog(true);
           // Clear any previous error/success messages when opening dialog
           setError(null);
           setSuccess(null);
           
          // Reset data sources
          setContractData(null);
          setIpfsData(null);
          setGraphQLData(null);
          
          // Fetch data from consolidated route
          if (agent.agentId) {
            setLoadingData(true);
            try {
              // Fetch from consolidated route
              const response = await fetch(`/api/agents/${agent.agentId}?chainId=11155111`);
              
              if (response.ok) {
                const data = await response.json();
                
                // Extract contract data
                if (data.contract) {
                  setContractData({
                    agentId: data.agentId,
                    tokenURI: data.contract.tokenURI,
                    metadata: data.contract.metadata,
                  });
                }
                
                // Extract IPFS data
                if (data.ipfs) {
                  setIpfsData({
                    tokenURI: data.ipfs.tokenURI,
                    registration: data.ipfs.registration,
                  });
                }
                
                // Extract GraphQL data
                if (data.graphql) {
                  setGraphQLData({
                    agentData: data.graphql,
                  });
                }
              } else {
                console.warn('Failed to fetch agent info:', response.status, response.statusText);
              }
            } catch (err) {
              console.error('Error fetching agent data:', err);
            } finally {
              setLoadingData(false);
            }
          }
         };

  // Handle disconnect
  const handleDisconnect = async () => {
    if (web3AuthConnected) {
      await web3AuthDisconnect();
    }
    if (walletConnected) {
      await walletDisconnect();
    }
  };

  // Show login page if not connected via Web3Auth
  // But allow wallet connection even if Web3Auth is not connected
  if (authLoading && !walletConnected) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div>Loading...</div>
      </div>
    );
  }

  // Only show login page if neither Web3Auth nor wallet is connected
  if (!web3AuthConnected && !walletConnected && !authLoading) {
    return <LoginPage />;
  }

  const fetchAgents = async () => {
    try {
      setPageLoading(true);
      setError(null);
      const response = await fetch('/api/agents/list');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to fetch agents');
      }
             const data = await response.json();
             const agentsList = data.agents || [];
             setAgents(agentsList);
             setFilteredAgents(agentsList);
           } catch (err) {
             console.error('Failed to fetch agents:', err);
             setError(err instanceof Error ? err.message : 'Failed to fetch agents');
           } finally {
             setPageLoading(false);
           }
         };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);

      // Use core utility to create agent (handles API call, signing, and refresh)
      // Only agentData is required - account, chain, and provider are auto-detected
      const result = await createAgentWithWallet({
        agentData: {
          agentName: createForm.agentName,
          agentAccount: createForm.agentAccount as `0x${string}`,
          description: createForm.description || undefined,
          image: createForm.image || undefined,
          agentUrl: createForm.agentUrl || undefined,
        },
        account: eoaAddress as Address,
        onStatusUpdate: setSuccess,
      });

      // Handle result
      if (result.agentId) {
        setSuccess(`Agent created successfully! Agent ID: ${result.agentId}, TX: ${result.txHash}`);
      } else {
        setSuccess(`Agent creation transaction confirmed! TX: ${result.txHash} (Agent ID will be available after indexing)`);
      }
      
      setCreateForm({ agentName: '', agentAccount: '', description: '', image: '', agentUrl: '' });
      
      // Refresh agents list after a short delay to allow indexing
      setTimeout(() => {
        fetchAgents();
      }, 2000);
    } catch (err) {
      console.error('Error creating agent:', err);
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    }
  };

  const handleUpdateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);

      const metadata = updateForm.metadataKey && updateForm.metadataValue
        ? [{ key: updateForm.metadataKey, value: updateForm.metadataValue }]
        : undefined;

      const response = await fetch(`/api/agents/${updateForm.agentId}/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenURI: updateForm.tokenURI || undefined,
          metadata,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to update agent');
      }

      const data = await response.json();
      setSuccess(`Agent updated successfully! TX: ${data.txHash}`);
      setUpdateForm({ agentId: '', tokenURI: '', metadataKey: '', metadataValue: '' });
      fetchAgents(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update agent');
    }
  };

  const handleDeleteAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm(`Are you sure you want to delete agent ${deleteForm.agentId}? This action cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);

      const response = await fetch(`/api/agents/${deleteForm.agentId}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to delete agent');
      }

      const data = await response.json();
      setSuccess(`Agent deleted successfully! TX: ${data.txHash}`);
      setDeleteForm({ agentId: '' });
      fetchAgents(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    }
  };

  const handleTransferAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);

      const response = await fetch(`/api/agents/${transferForm.agentId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: transferForm.to,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to transfer agent');
      }

      const data = await response.json();
      setSuccess(`Agent transferred successfully! TX: ${data.txHash}`);
      setTransferForm({ agentId: '', to: '' });
      fetchAgents(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer agent');
    }
  };

  return (
    <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold' }}>
          Agent Administration
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {eoaAddress && (
            <div style={{ fontSize: '0.9rem', color: '#666', fontFamily: 'monospace' }}>
              {eoaAddress.slice(0, 6)}...{eoaAddress.slice(-4)}
            </div>
          )}
          <button
            onClick={handleDisconnect}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#dc3545',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {error && (
        <div style={{ 
          marginBottom: '1rem', 
          padding: '1rem', 
          backgroundColor: '#ffebee', 
          borderRadius: '4px', 
          border: '1px solid #f44336',
          color: '#c62828'
        }}>
          Error: {error}
        </div>
      )}

      {success && (
        <div style={{ 
          marginBottom: '1rem', 
          padding: '1rem', 
          backgroundColor: '#e8f5e9', 
          borderRadius: '4px', 
          border: '1px solid #4caf50',
          color: '#2e7d32'
        }}>
          Success: {success}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Create Agent */}
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Create Agent</h2>
          <form onSubmit={handleCreateAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Name *
              </label>
              <input
                type="text"
                value={createForm.agentName}
                onChange={(e) => setCreateForm({ ...createForm, agentName: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent Account (0x...) *
              </label>
              <input
                type="text"
                value={createForm.agentAccount}
                onChange={(e) => setCreateForm({ ...createForm, agentAccount: e.target.value })}
                required
                pattern="^0x[a-fA-F0-9]{40}$"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontFamily: 'monospace' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Description
              </label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                rows={3}
                placeholder="A natural language description of the agent..."
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Image URL
              </label>
              <input
                type="url"
                value={createForm.image}
                onChange={(e) => setCreateForm({ ...createForm, image: e.target.value })}
                placeholder="https://example.com/agent-image.png"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent URL (Base URL)
              </label>
              <input
                type="url"
                value={createForm.agentUrl}
                onChange={(e) => setCreateForm({ ...createForm, agentUrl: e.target.value })}
                placeholder="https://agent.example.com"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#666' }}>
                Used to automatically create A2A and MCP endpoints. A2A: {createForm.agentUrl ? `${createForm.agentUrl.replace(/\/$/, '')}/.well-known/agent-card.json` : '.../.well-known/agent-card.json'}, MCP: {createForm.agentUrl ? `${createForm.agentUrl.replace(/\/$/, '')}/` : '.../'}
              </p>
            </div>
            <p style={{ marginTop: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#666' }}>
              Registration JSON will be automatically created and uploaded to IPFS per ERC-8004 specification
            </p>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#007bff',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Create Agent
            </button>
          </form>
        </div>

        {/* Update Agent */}
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Update Agent</h2>
          <form onSubmit={handleUpdateAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent ID *
              </label>
              <input
                type="text"
                value={updateForm.agentId}
                onChange={(e) => setUpdateForm({ ...updateForm, agentId: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                New Token URI (optional)
              </label>
              <input
                type="text"
                value={updateForm.tokenURI}
                onChange={(e) => setUpdateForm({ ...updateForm, tokenURI: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Metadata Key (optional)
              </label>
              <input
                type="text"
                value={updateForm.metadataKey}
                onChange={(e) => setUpdateForm({ ...updateForm, metadataKey: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Metadata Value (optional)
              </label>
              <input
                type="text"
                value={updateForm.metadataValue}
                onChange={(e) => setUpdateForm({ ...updateForm, metadataValue: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Update Agent
            </button>
          </form>
        </div>

        {/* Delete Agent */}
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', color: '#dc3545' }}>Delete Agent</h2>
          <form onSubmit={handleDeleteAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent ID *
              </label>
              <input
                type="text"
                value={deleteForm.agentId}
                onChange={(e) => setDeleteForm({ ...deleteForm, agentId: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#dc3545',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Delete Agent
            </button>
          </form>
        </div>

        {/* Transfer Agent */}
        <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Transfer Agent</h2>
          <form onSubmit={handleTransferAgent}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Agent ID *
              </label>
              <input
                type="text"
                value={transferForm.agentId}
                onChange={(e) => setTransferForm({ ...transferForm, agentId: e.target.value })}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Transfer To (0x...) *
              </label>
              <input
                type="text"
                value={transferForm.to}
                onChange={(e) => setTransferForm({ ...transferForm, to: e.target.value })}
                required
                pattern="^0x[a-fA-F0-9]{40}$"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontFamily: 'monospace' }}
              />
            </div>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#ffc107',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Transfer Agent
            </button>
          </form>
        </div>
      </div>

      {/* Agents List */}
      <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.5rem' }}>Agents List</h2>
          <button
            onClick={fetchAgents}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#6c757d',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Refresh
          </button>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <input
            type="text"
            placeholder="Search by Agent ID or Agent Name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '1rem',
            }}
          />
        </div>
        {pageLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading agents...</div>
        ) : filteredAgents.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
            {searchQuery ? `No agents found matching "${searchQuery}"` : 'No agents found'}
          </div>
        ) : (
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Agent ID</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Agent Name</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>A2A Endpoint</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 'bold' }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((agent, index) => (
                  <tr 
                    key={`agent-${agent.agentId !== undefined ? agent.agentId : 'unknown'}-${index}`} 
                    onClick={() => handleAgentClick(agent)}
                    style={{ 
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f5f5f5';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <td style={{ padding: '0.75rem' }}>{agent.agentId}</td>
                    <td style={{ padding: '0.75rem' }}>{agent.agentName || 'N/A'}</td>
                    <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                      {agent.a2aEndpoint || 'N/A'}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
                      {agent.createdAtTime ? new Date(parseInt(agent.createdAtTime) * 1000).toLocaleString() : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Agent Details Dialog */}
      {showAgentDialog && selectedAgent && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowAgentDialog(false)}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '8px',
              padding: '2rem',
              maxWidth: '1400px',
              width: '95%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Agent Details</h2>
              <button
                onClick={() => setShowAgentDialog(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#666',
                  padding: '0.25rem 0.5rem',
                }}
              >
                ×
              </button>
            </div>
            
            {loadingData ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>Loading agent data...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                {/* Contract Data */}
                <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem', backgroundColor: '#f9f9f9' }}>
                  <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem', color: '#333' }}>Contract Data</h3>
                  {contractData ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                      <div>
                        <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>Agent ID</strong>
                        <div style={{ fontFamily: 'monospace', backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px' }}>
                          {contractData.agentId || 'N/A'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>Token URI</strong>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px', wordBreak: 'break-all' }}>
                          {contractData.tokenURI || 'N/A'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>Metadata</strong>
                        <div style={{ backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                          <pre style={{ margin: 0, fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {JSON.stringify(contractData.metadata || {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: '#999', fontSize: '0.9rem' }}>No contract data available</div>
                  )}
                </div>
                
                {/* IPFS Data */}
                <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem', backgroundColor: '#f9f9f9' }}>
                  <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem', color: '#333' }}>IPFS Registration</h3>
                  {ipfsData ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                      {ipfsData.registration ? (
                        <>
                          <div>
                            <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>Token URI</strong>
                            <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px', wordBreak: 'break-all' }}>
                              {ipfsData.tokenURI || 'N/A'}
                            </div>
                          </div>
                          <div>
                            <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>Registration JSON</strong>
                            <div style={{ backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px', maxHeight: '400px', overflowY: 'auto' }}>
                              <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {JSON.stringify(ipfsData.registration, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div style={{ color: '#999', fontSize: '0.9rem' }}>
                          {ipfsData.error || 'No registration data found'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ color: '#999', fontSize: '0.9rem' }}>No IPFS data available</div>
                  )}
                </div>
                
                {/* GraphQL Data */}
                <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem', backgroundColor: '#f9f9f9' }}>
                  <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem', color: '#333' }}>GraphQL Indexer</h3>
                  {graphQLData?.agentData ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                      <div>
                        <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>Agent ID</strong>
                        <div style={{ fontFamily: 'monospace', backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px' }}>
                          {graphQLData.agentData.agentId || 'N/A'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>Agent Name</strong>
                        <div style={{ backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px' }}>
                          {graphQLData.agentData.agentName || 'N/A'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>A2A Endpoint</strong>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px', wordBreak: 'break-all' }}>
                          {graphQLData.agentData.a2aEndpoint || 'N/A'}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>Created At</strong>
                        <div style={{ backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px' }}>
                          {graphQLData.agentData.createdAtTime 
                            ? new Date(parseInt(graphQLData.agentData.createdAtTime) * 1000).toLocaleString()
                            : 'N/A'}
                        </div>
                      </div>
                      {graphQLData.agentData.updatedAtTime && (
                        <div>
                          <strong style={{ color: '#666', display: 'block', marginBottom: '0.25rem' }}>Updated At</strong>
                          <div style={{ backgroundColor: '#fff', padding: '0.5rem', borderRadius: '4px' }}>
                            {new Date(parseInt(graphQLData.agentData.updatedAtTime) * 1000).toLocaleString()}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ color: '#999', fontSize: '0.9rem' }}>No GraphQL data available</div>
                  )}
                </div>
              </div>
            )}
            
            {/* Original Agent Data (from list) */}
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
              <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem', color: '#333' }}>List Data (from initial fetch)</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
                <div><strong>Agent ID:</strong> {selectedAgent.agentId || 'N/A'}</div>
                <div><strong>Agent Name:</strong> {selectedAgent.agentName || 'N/A'}</div>
                <div><strong>A2A Endpoint:</strong> {selectedAgent.a2aEndpoint || 'N/A'}</div>
                <div><strong>Created At:</strong> {selectedAgent.createdAtTime ? new Date(parseInt(selectedAgent.createdAtTime) * 1000).toLocaleString() : 'N/A'}</div>
              </div>
            </div>
            
            {(error || success) && (
              <div style={{
                marginTop: '1rem',
                padding: '0.75rem',
                backgroundColor: error ? '#ffebee' : '#e8f5e9',
                borderRadius: '4px',
                border: `1px solid ${error ? '#f44336' : '#4caf50'}`,
                color: error ? '#c62828' : '#2e7d32',
                fontSize: '0.9rem',
              }}>
                {error || success}
              </div>
            )}
            
            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                onClick={async () => {
                  if (!selectedAgent?.agentId) return;
                  try {
                    setRefreshing(true);
                    setError(null);
                    setSuccess(null);
                    const response = await fetch(`/api/agents/${selectedAgent.agentId}/refresh`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ chainId: 11155111 }), // Default to Sepolia
                    });
                    if (!response.ok) {
                      const errorData = await response.json();
                      throw new Error(errorData.message || errorData.error || 'Failed to refresh agent');
                    }
                    const data = await response.json();
                    setSuccess(`Agent ${selectedAgent.agentId} refreshed successfully!`);
                    // Optionally refresh the agent list to show updated data
                    fetchAgents();
                  } catch (err) {
                    console.error('Error refreshing agent:', err);
                    setError(err instanceof Error ? err.message : 'Failed to refresh agent');
                  } finally {
                    setRefreshing(false);
                  }
                }}
                disabled={refreshing || !selectedAgent?.agentId}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: refreshing ? '#6c757d' : '#007bff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: refreshing || !selectedAgent?.agentId ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  opacity: refreshing || !selectedAgent?.agentId ? 0.6 : 1,
                }}
              >
                {refreshing ? 'Refreshing...' : 'Refresh in Indexer'}
              </button>
              <button
                onClick={() => setShowAgentDialog(false)}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#6c757d',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

