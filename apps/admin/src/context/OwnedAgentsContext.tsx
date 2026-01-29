'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AgentsPageAgent } from '@/components/AgentsPage';
import { useWallet } from '@/components/WalletProvider';

type OwnedAgentsContextValue = {
  ownedAgents: AgentsPageAgent[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  refreshOwnedAgents: () => Promise<void>;
};

const OwnedAgentsContext = createContext<OwnedAgentsContextValue | null>(null);

function mapOwnedAgentToAgentsPageAgent(agent: any): AgentsPageAgent {
  return {
    agentId: String(agent?.agentId ?? ''),
    chainId: typeof agent?.chainId === 'number' ? agent.chainId : 0,
    uaid: agent?.uaid ?? null,
    agentName: agent?.agentName ?? null,
    agentAccount: agent?.agentAccount ?? null,
    agentIdentityOwnerAccount: agent?.agentIdentityOwnerAccount ?? null,
    eoaAgentIdentityOwnerAccount: agent?.eoaAgentIdentityOwnerAccount ?? null,
    eoaAgentAccount: agent?.eoaAgentAccount ?? null,
    identityOwnerAccount: agent?.identityOwnerAccount ?? null,
    identityWalletAccount: agent?.identityWalletAccount ?? null,
    identityOperatorAccount: agent?.identityOperatorAccount ?? null,
    agentOwnerAccount: agent?.agentOwnerAccount ?? null,
    agentWalletAccount: agent?.agentWalletAccount ?? null,
    agentOperatorAccount: agent?.agentOperatorAccount ?? null,
    agentOwnerEOAAccount: agent?.agentOwnerEOAAccount ?? null,
    smartAgentAccount: agent?.smartAgentAccount ?? null,
    agentUri: agent?.agentUri ?? null,
    description: agent?.description ?? null,
    image: agent?.image ?? null,
    contractAddress: agent?.contractAddress ?? null,
    a2aEndpoint: agent?.a2aEndpoint ?? null,
    mcpEndpoint: agent?.mcpEndpoint ?? null,
    did: agent?.did ?? null,
    supportedTrust: agent?.supportedTrust ?? null,
    createdAtTime: typeof agent?.createdAtTime === 'number' ? agent.createdAtTime : null,
    feedbackCount: agent?.feedbackCount ?? null,
    feedbackAverageScore: agent?.feedbackAverageScore ?? null,
    validationPendingCount: agent?.validationPendingCount ?? null,
    validationCompletedCount: agent?.validationCompletedCount ?? null,
    validationRequestedCount: agent?.validationRequestedCount ?? null,
    initiatedAssociationCount: agent?.initiatedAssociationCount ?? null,
    approvedAssociationCount: agent?.approvedAssociationCount ?? null,
    atiOverallScore: agent?.atiOverallScore ?? null,
    atiOverallConfidence: agent?.atiOverallConfidence ?? null,
    atiVersion: agent?.atiVersion ?? null,
    atiComputedAt: agent?.atiComputedAt ?? null,
    atiBundleJson: agent?.atiBundleJson ?? null,
    trustLedgerScore: agent?.trustLedgerScore ?? null,
    trustLedgerBadgeCount: agent?.trustLedgerBadgeCount ?? null,
    trustLedgerOverallRank: agent?.trustLedgerOverallRank ?? null,
    trustLedgerCapabilityRank: agent?.trustLedgerCapabilityRank ?? null,
  };
}

export function OwnedAgentsProvider({ children }: { children: ReactNode }) {
  const { connected, address } = useWallet();
  const [ownedAgents, setOwnedAgents] = useState<AgentsPageAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const refreshOwnedAgents = useCallback(async () => {
    if (!connected || !address) {
      setOwnedAgents([]);
      setLastFetchedAt(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/agents/owned?eoaAddress=${encodeURIComponent(address)}&limit=1000&orderBy=createdAtTime&orderDirection=DESC`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || `Failed to fetch owned agents (${response.status})`);
      }
      const data = await response.json();
      const agents = Array.isArray(data.agents) ? data.agents : [];
      setOwnedAgents(agents.map(mapOwnedAgentToAgentsPageAgent));
      setLastFetchedAt(Date.now());
    } catch (e) {
      setOwnedAgents([]);
      setLastFetchedAt(null);
      setError(e instanceof Error ? e.message : 'Failed to fetch owned agents');
    } finally {
      setLoading(false);
    }
  }, [connected, address]);

  // Build cache on connect (and whenever walletAddress changes)
  useEffect(() => {
    void refreshOwnedAgents();
  }, [refreshOwnedAgents]);

  const value = useMemo<OwnedAgentsContextValue>(
    () => ({ ownedAgents, loading, error, lastFetchedAt, refreshOwnedAgents }),
    [ownedAgents, loading, error, lastFetchedAt, refreshOwnedAgents],
  );

  return <OwnedAgentsContext.Provider value={value}>{children}</OwnedAgentsContext.Provider>;
}

export function useOwnedAgents() {
  const ctx = useContext(OwnedAgentsContext);
  if (!ctx) {
    throw new Error('useOwnedAgents must be used within an OwnedAgentsProvider');
  }
  return ctx;
}


