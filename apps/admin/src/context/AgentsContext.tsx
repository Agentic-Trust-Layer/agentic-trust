'use client';

import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { AgentsPageAgent, AgentsPageFilters } from '@/components/AgentsPage';

type AgentsContextType = {
  agents: AgentsPageAgent[];
  setAgents: (agents: AgentsPageAgent[]) => void;
  filters: AgentsPageFilters;
  setFilters: (filters: AgentsPageFilters) => void;
  total: number | undefined;
  setTotal: (total: number | undefined) => void;
  totalPages: number | undefined;
  setTotalPages: (totalPages: number | undefined) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  hasLoaded: boolean;
  setHasLoaded: (loaded: boolean) => void;
};

const DEFAULT_FILTERS: AgentsPageFilters = {
  // Honor roll (ranked) requires a specific chain.
  chainId: '1',
  address: '',
  name: '',
  agentIdentifierMatch: '',
  mineOnly: false,
  only8004Agents: false,
  view: 'ranked',
  protocol: 'all',
  path: '',
  minReviews: '',
  minValidations: '',
  minAssociations: '',
  minAtiOverallScore: '',
  minAvgRating: '',
  createdWithinDays: '',
};

const AgentsContext = createContext<AgentsContextType | undefined>(undefined);

export function AgentsProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentsPageAgent[]>([]);
  const [filters, setFilters] = useState<AgentsPageFilters>(DEFAULT_FILTERS);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  return (
    <AgentsContext.Provider
      value={{
        agents,
        setAgents,
        filters,
        setFilters,
        total,
        setTotal,
        totalPages,
        setTotalPages,
        currentPage,
        setCurrentPage,
        loading,
        setLoading,
        hasLoaded,
        setHasLoaded,
      }}
    >
      {children}
    </AgentsContext.Provider>
  );
}

export function useAgentsContext() {
  const context = useContext(AgentsContext);
  if (!context) {
    throw new Error('useAgentsContext must be used within an AgentsProvider');
  }
  return context;
}

