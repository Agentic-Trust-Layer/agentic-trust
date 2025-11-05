'use client';

import { useState, useEffect } from 'react';

type Agent = {
  agentId?: number;
  agentName?: string;
  a2aEndpoint?: string;
  createdAtTime?: string;
  updatedAtTime?: string;
};

export default function AdminPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create agent form state
  const [createForm, setCreateForm] = useState({
    agentName: '',
    agentAccount: '',
    tokenURI: '',
    metadataKey: '',
    metadataValue: '',
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

  // Fetch agents on mount
  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/agents/list');
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
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      setSuccess(null);

      const metadata = createForm.metadataKey && createForm.metadataValue
        ? [{ key: createForm.metadataKey, value: createForm.metadataValue }]
        : undefined;

      const response = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: createForm.agentName,
          agentAccount: createForm.agentAccount,
          tokenURI: createForm.tokenURI || undefined,
          metadata,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to create agent');
      }

      const data = await response.json();
      setSuccess(`Agent created successfully! Agent ID: ${data.agentId}, TX: ${data.txHash}`);
      setCreateForm({ agentName: '', agentAccount: '', tokenURI: '', metadataKey: '', metadataValue: '' });
      fetchAgents(); // Refresh list
    } catch (err) {
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
      <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: 'bold' }}>
        Agent Administration
      </h1>

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
                Token URI (optional)
              </label>
              <input
                type="text"
                value={createForm.tokenURI}
                onChange={(e) => setCreateForm({ ...createForm, tokenURI: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Metadata Key (optional)
              </label>
              <input
                type="text"
                value={createForm.metadataKey}
                onChange={(e) => setCreateForm({ ...createForm, metadataKey: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Metadata Value (optional)
              </label>
              <input
                type="text"
                value={createForm.metadataValue}
                onChange={(e) => setCreateForm({ ...createForm, metadataValue: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
              />
            </div>
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
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading agents...</div>
        ) : agents.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>No agents found</div>
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
                {agents.map((agent) => (
                  <tr key={agent.agentId} style={{ borderBottom: '1px solid #eee' }}>
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
    </main>
  );
}

