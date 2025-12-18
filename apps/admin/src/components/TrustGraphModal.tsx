'use client';

import React, { useMemo, useCallback, useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Paper,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {
  ReactFlow,
  Background as ReactFlowBackground,
  Controls as ReactFlowControls,
  MiniMap as ReactFlowMiniMap,
  type Node as RFNode,
  type Edge as RFEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AgentsPageAgent } from './AgentsPage';
import type { AgentDetailsFeedbackSummary, AgentDetailsValidationsSummary } from './AgentDetailsTabs';
import { grayscalePalette as palette } from '@/styles/palette';

type TrustGraphModalProps = {
  open: boolean;
  onClose: () => void;
  agent: AgentsPageAgent;
  feedbackSummary: AgentDetailsFeedbackSummary;
  validations: AgentDetailsValidationsSummary | null;
  onOpenReviews: () => void;
  onOpenValidations: () => void;
  resolveEnsName?: (addr?: string | null) => Promise<string | null>;
};

type GraphNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
  type: 'agent' | 'reviews' | 'validation' | 'alliance' | 'association';
  data?: any;
};

type Assoc = {
  associationId: string;
  initiator: string;
  approver: string;
  counterparty: string;
  validAt: number;
  validUntil: number;
  revokedAt: number;
};

type AssociationsResp =
  | { ok: true; chainId: number; account: string; associations: Assoc[] }
  | { ok: false; error: string };

type AgentInfo = {
  agentId?: string;
  agentName?: string;
  agentAccount?: string;
};

function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export default function TrustGraphModal({
  open,
  onClose,
  agent,
  feedbackSummary,
  validations,
  onOpenReviews,
  onOpenValidations,
  resolveEnsName,
}: TrustGraphModalProps) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEns, setSelectedEns] = useState<string | null>(null);
  const [associationsData, setAssociationsData] = useState<AssociationsResp | null>(null);
  const [expandedAssociations, setExpandedAssociations] = useState<Record<string, AssociationsResp>>({});
  const [agentInfoByAddress, setAgentInfoByAddress] = useState<Map<string, AgentInfo>>(new Map());

  const agentName = agent.agentName || `Agent #${agent.agentId}`;
  const feedbackCount =
    typeof feedbackSummary?.count === 'string'
      ? parseInt(feedbackSummary.count, 10)
      : feedbackSummary?.count ?? 0;

  // Fetch associations for the center agent
  useEffect(() => {
    if (!open || !agent.agentAccount) return;
    let cancelled = false;
    setAssociationsData(null);
    setExpandedAssociations({});
    (async () => {
      try {
        const agentAccount = agent.agentAccount;
        if (!agentAccount) return;
        const chainId = agent.chainId || 11155111;
        const res = await fetch(
          `/api/associations?account=${encodeURIComponent(agentAccount)}&chainId=${chainId}`,
          { cache: 'no-store' }
        );
        const json = (await res.json()) as AssociationsResp;
        if (!cancelled) setAssociationsData(json);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        if (!cancelled) setAssociationsData({ ok: false, error: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, agent.agentAccount, agent.chainId]);

  // Expand associations: fetch for first-hop counterparties
  useEffect(() => {
    if (!open || !agent.agentAccount) return;
    if (!associationsData || associationsData.ok === false) return;
    
    const rootAddr = agent.agentAccount.toLowerCase();
    const firstHops = Array.from(
      new Set(
        (associationsData.associations ?? [])
          .map((a) => a.counterparty?.toLowerCase?.() ?? '')
          .filter((a) => a && a !== rootAddr)
      )
    ).slice(0, 12); // Keep it bounded

    if (firstHops.length === 0) return;

    let cancelled = false;
    (async () => {
      const chainId = agent.chainId || 11155111;
      const results = await Promise.allSettled(
        firstHops.map(async (addr) => {
          const res = await fetch(
            `/api/associations?account=${encodeURIComponent(addr)}&chainId=${chainId}`,
            { cache: 'no-store' }
          );
          const json = (await res.json()) as AssociationsResp;
          return [addr, json] as const;
        })
      );
      if (cancelled) return;
      setExpandedAssociations((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const [addr, json] = r.value;
            next[addr] = json;
          }
        }
        return next;
      });
    })().catch(() => {
      // Ignore expansion errors; root graph still renders
    });

    return () => {
      cancelled = true;
    };
  }, [open, agent.agentAccount, agent.chainId, associationsData]);

  // Fetch agent info for association addresses
  useEffect(() => {
    if (!open || !associationsData || !associationsData.ok) return;
    
    // Collect all unique addresses from associations
    const addressesToLookup = new Set<string>();
    const centerAddr = agent.agentAccount?.toLowerCase();
    
    for (const a of associationsData.associations || []) {
      const initiator = a.initiator?.toLowerCase?.();
      const approver = a.approver?.toLowerCase?.();
      const counterparty = a.counterparty?.toLowerCase?.();
      
      if (initiator && initiator !== centerAddr) addressesToLookup.add(initiator);
      if (approver && approver !== centerAddr) addressesToLookup.add(approver);
      if (counterparty && counterparty !== centerAddr) addressesToLookup.add(counterparty);
    }
    
    // Also check expanded associations
    for (const resp of Object.values(expandedAssociations)) {
      if (!resp || !resp.ok) continue;
      for (const a of resp.associations || []) {
        const initiator = a.initiator?.toLowerCase?.();
        const approver = a.approver?.toLowerCase?.();
        const counterparty = a.counterparty?.toLowerCase?.();
        
        if (initiator && initiator !== centerAddr) addressesToLookup.add(initiator);
        if (approver && approver !== centerAddr) addressesToLookup.add(approver);
        if (counterparty && counterparty !== centerAddr) addressesToLookup.add(counterparty);
      }
    }
    
    if (addressesToLookup.size === 0) return;
    
    let cancelled = false;
    
    // Fetch agent info for each address by searching for agents with matching agentAccount
    (async () => {
      const chainId = agent.chainId || 11155111;
      const results = await Promise.allSettled(
        Array.from(addressesToLookup).map(async (addr) => {
          try {
            // Search for agents with this account address using query parameter
            const searchParams = new URLSearchParams({
              query: addr,
              pageSize: '10',
            });
            const res = await fetch(`/api/agents/search?${searchParams.toString()}`, {
              cache: 'no-store',
            });
            if (!res.ok) return [addr, null] as const;
            const data = await res.json();
            const agents = data?.agents || [];
            // Find exact match by agentAccount
            const matchingAgent = agents.find((a: any) => {
              const agentAccount = a.agentAccount || (a.data && a.data.agentAccount);
              return agentAccount?.toLowerCase() === addr;
            });
            
            if (matchingAgent) {
              const agentData = matchingAgent.data || matchingAgent;
              return [addr, {
                agentId: (agentData.agentId || matchingAgent.agentId)?.toString(),
                agentName: agentData.agentName || matchingAgent.agentName || undefined,
                agentAccount: agentData.agentAccount || matchingAgent.agentAccount || addr,
              }] as const;
            }
            return [addr, null] as const;
          } catch (e) {
            console.warn(`[TrustGraph] Failed to lookup agent for address ${addr}:`, e);
            return [addr, null] as const;
          }
        })
      );
      
      if (cancelled) return;
      
      setAgentInfoByAddress((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const [addr, info] = r.value;
            if (info) {
              next.set(addr.toLowerCase(), info);
            }
          }
        }
        return next;
      });
    })();
    
    return () => {
      cancelled = true;
    };
  }, [open, associationsData, expandedAssociations, agent.agentAccount, agent.chainId]);

  // Helper to get agent info for an address (for node labels)
  const getAgentInfoForAddress = useCallback((addr: string): AgentInfo | null => {
    if (!addr) return null;
    const addrLower = addr.toLowerCase();
    // Check if it's the center agent
    if (agent.agentAccount?.toLowerCase() === addrLower) {
      return {
        agentId: agent.agentId,
        agentName: agent.agentName || undefined,
        agentAccount: agent.agentAccount,
      };
    }
    // Check cached agent info
    const cached = agentInfoByAddress.get(addrLower);
    if (cached) return cached;
    return null;
  }, [agent, agentInfoByAddress]);

  const nodes = useMemo<{ nodes: GraphNode[]; associationEdges: Array<{ id: string; source: string; target: string; assoc: Assoc }> }>(() => {
    const reviewNode: GraphNode = {
      id: 'reviews',
      label: `Reviews (${feedbackCount})`,
      x: 0,
      y: 0,
      color: '#2563eb',
      type: 'reviews',
    };

    const agentNode: GraphNode = {
      id: 'agent',
      label: agentName,
      x: 0,
      y: 0,
      color: '#0f172a',
      type: 'agent',
    };

    const completedValidationNodes: GraphNode[] = (validations?.completed || [])
      .slice(0, 25)
      .map((v, idx) => ({
        id: `val-completed-${idx}`,
        label: v.validatorAddress
          ? `${v.validatorAddress.slice(0, 6)}…${v.validatorAddress.slice(-4)}`
          : 'Validator',
        x: 0,
        y: 0,
        color: '#16a34a',
        type: 'validation',
        data: { ...v, status: 'completed' as const },
      }));

    const pendingValidationNodes: GraphNode[] = (validations?.pending || [])
      .slice(0, 25)
      .map((v, idx) => ({
        id: `val-pending-${idx}`,
        label: v.validatorAddress
          ? `${v.validatorAddress.slice(0, 6)}…${v.validatorAddress.slice(-4)}`
          : 'Validator',
        x: 0,
        y: 0,
        color: '#f59e0b',
        type: 'validation',
        data: { ...v, status: 'pending' as const },
      }));

    const validationNodes: GraphNode[] = [...completedValidationNodes, ...pendingValidationNodes];

    // Alliance agents - for now we'll use an empty array, but this can be populated from agent relationships
    const allianceNodes: GraphNode[] = [];

    // Build association nodes
    const associationNodes: GraphNode[] = [];
    const associationEdges: Array<{ id: string; source: string; target: string; assoc: Assoc }> = [];
    
    if (associationsData && associationsData.ok && agent.agentAccount) {
      const centerAddr = agent.agentAccount.toLowerCase();
      const associations = associationsData.associations || [];

      // Collect first-hop counterpart addresses with counts
      const counterparts = new Map<string, { count: number; activeCount: number }>();
      for (const a of associations) {
        const other = a.counterparty?.toLowerCase?.() ?? null;
        if (!other) continue;
        const prev = counterparts.get(other) ?? { count: 0, activeCount: 0 };
        prev.count += 1;
        if (a.revokedAt === 0) prev.activeCount += 1;
        counterparts.set(other, prev);
      }

      // Create nodes for first-hop counterparts
      const entries = Array.from(counterparts.entries());
      entries.forEach(([addr, meta]) => {
        const known = getAgentInfoForAddress(addr);
        const label = known
          ? `#${known.agentId} ${known.agentName || 'Agent'}\n${shortAddr(addr)}\n${meta.activeCount}/${meta.count} active`
          : `Agent\n${shortAddr(addr)}\n${meta.activeCount}/${meta.count} active`;
        
        associationNodes.push({
          id: `assoc-${addr}`,
          label,
          x: 0,
          y: 0,
          color: '#6366f1',
          type: 'association',
          data: { address: addr, agentInfo: known, ...meta },
        });
      });

      // Collect all associations (root + expanded) for edges, deduplicated by associationId
      const seenAssociationIds = new Set<string>();
      const allAssocs: Assoc[] = [];
      
      // Add root associations
      for (const a of associations) {
        if (!seenAssociationIds.has(a.associationId)) {
          seenAssociationIds.add(a.associationId);
          allAssocs.push(a);
        }
      }
      
      // Add expanded associations, skipping duplicates
      for (const r of Object.values(expandedAssociations)) {
        if (r && r.ok) {
          for (const a of r.associations ?? []) {
            if (!seenAssociationIds.has(a.associationId)) {
              seenAssociationIds.add(a.associationId);
              allAssocs.push(a);
            }
          }
        }
      }

      // Create edges from associations (already deduplicated)
      for (const a of allAssocs) {
        const s = a.initiator.toLowerCase();
        const t = a.approver.toLowerCase();
        const sourceId = s === centerAddr ? 'agent' : `assoc-${s}`;
        const targetId = t === centerAddr ? 'agent' : `assoc-${t}`;
        
        associationEdges.push({
          id: `e-assoc-${a.associationId}`,
          source: sourceId,
          target: targetId,
          assoc: a,
        });

        // Ensure nodes exist for endpoints (create small fallback nodes if needed)
        for (const [addrLower, nodeId] of [
          [s, sourceId],
          [t, targetId],
        ] as const) {
          if (nodeId !== 'agent' && !associationNodes.find((n) => n.id === nodeId)) {
            const known = getAgentInfoForAddress(addrLower);
            const label = known
              ? `#${known.agentId} ${known.agentName || 'Agent'}\n${shortAddr(addrLower)}`
              : `Agent\n${shortAddr(addrLower)}`;
            associationNodes.push({
              id: nodeId,
              label,
              x: 0,
              y: 0,
              color: '#a5b4fc',
              type: 'association',
              data: { address: addrLower, agentInfo: known },
            });
          }
        }
      }

      // Add second-hop nodes from expanded associations
      for (const [parentAddr, resp] of Object.entries(expandedAssociations)) {
        if (!resp || resp.ok === false) continue;
        const parentId = `assoc-${parentAddr.toLowerCase()}`;
        const seconds = new Set<string>();
        for (const a of resp.associations ?? []) {
          const other = a.counterparty?.toLowerCase?.() ?? '';
          if (!other || other === centerAddr) continue;
          if (!associationNodes.find((n) => n.id === `assoc-${other}`)) {
            seconds.add(other);
          }
        }
        seconds.forEach((addr) => {
          const known = getAgentInfoForAddress(addr);
          const label = known
            ? `#${known.agentId} ${known.agentName || 'Agent'}\n${shortAddr(addr)}`
            : `Agent\n${shortAddr(addr)}`;
          associationNodes.push({
            id: `assoc-${addr}`,
            label,
            x: 0,
            y: 0,
            color: '#c7d2fe',
            type: 'association',
            data: { address: addr, agentInfo: known },
          });
        });
      }
    }

    // Update agent node label to include account address
    agentNode.label = `${agentName}\n${agent.agentAccount ? shortAddr(agent.agentAccount) : ''}`;

    return {
      nodes: [agentNode, reviewNode, ...validationNodes, ...allianceNodes, ...associationNodes],
      associationEdges,
    };
  }, [agentName, feedbackCount, validations, associationsData, expandedAssociations, agent.agentAccount, agent.agentId, getAgentInfoForAddress]);

  const allNodes = useMemo(() => nodes.nodes || [], [nodes]);
  const assocEdges = useMemo(() => nodes.associationEdges || [], [nodes]);

  const edges = useMemo(() => {
    const base: Array<{ id: string; source: string; target: string; assoc?: Assoc }> = [
      { id: 'e-agent-reviews', source: 'agent', target: 'reviews' },
    ];

    allNodes.forEach((n: GraphNode, idx: number) => {
      if (n.type === 'validation' || n.type === 'alliance') {
        base.push({ id: `e-${n.id}-${idx}`, source: 'agent', target: n.id });
      }
    });

    // Add association edges
    base.push(...assocEdges);

    return base;
  }, [allNodes, assocEdges]);

  const rfNodes = useMemo<RFNode[]>(() => {
    const centerX = 0;
    const topY = -260; // Move center agent higher to make room for associations

    return allNodes.map((n: GraphNode, idx: number) => {
      let x = centerX;
      let y = topY;

      if (n.type === 'agent') {
        // Selected agent at the top center
        x = centerX;
        y = topY;
      } else if (n.type === 'reviews') {
        // Reviews directly below-left of agent
        x = centerX - 200;
        y = topY + 140;
      } else if (n.type === 'validation') {
        // Validators in a grid below-right of agent
        const validationStartIdx = allNodes.findIndex((node) => node.type === 'validation');
        const validationIdx = idx - validationStartIdx;
        const col = validationIdx % 3;
        const row = Math.floor(validationIdx / 3);
        x = centerX + 120 + col * 90;
        y = topY + 140 + row * 70;
      } else if (n.type === 'alliance') {
        // Alliance agents in a row further below, centered
        const allianceStartIdx = allNodes.findIndex((node: GraphNode) => node.type === 'alliance');
        const allianceIdx = idx - allianceStartIdx;
        x = centerX - 150 + allianceIdx * 90;
        y = topY + 260;
      } else if (n.type === 'association') {
        // Association nodes: positioned below the selected agent on the right side
        const associationStartIdx = allNodes.findIndex((node: GraphNode) => node.type === 'association');
        const associationIdx = idx - associationStartIdx;
        
        // Position associations in a column on the right side
        const spacingY = 100; // Vertical spacing between association nodes
        const offsetX = 350; // Horizontal offset to the right
        x = centerX + offsetX;
        y = topY + 150 + associationIdx * spacingY; // Start below the center agent
      }

      return {
        id: n.id,
        position: { x, y },
        data: { label: n.label, graphNode: n },
        style: {
          borderRadius: 12,
          padding: 10,
          border: `1px solid ${n.type === 'agent' ? 'rgba(255,255,255,0.15)' : n.type === 'association' ? 'rgba(255,255,255,0.12)' : n.color}`,
          background: n.type === 'agent' ? '#0f172a' : n.type === 'association' ? '#1e293b' : '#ffffff',
          color: n.type === 'agent' || n.type === 'association' ? 'white' : '#0f172a',
          fontSize: 12,
          fontWeight: 600,
          width: 240,
          minHeight: 60,
          textAlign: 'center',
          whiteSpace: 'pre-line',
          boxShadow: n.type === 'association' ? '0 2px 8px rgba(0,0,0,0.2)' : undefined,
        },
      } satisfies RFNode;
    });
  }, [allNodes, associationsData]);

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      edges.map((e) => {
        const isAssociationEdge = e.id.includes('assoc');
        const assoc = (e as any).assoc as Assoc | undefined;
        const isActive = assoc ? assoc.revokedAt === 0 : true;
        
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          animated: isAssociationEdge ? isActive : true,
          style: {
            strokeWidth: 1.5,
            stroke: isAssociationEdge
              ? isActive
                ? '#22c55e' // Green for active associations
                : 'rgba(255,255,255,0.25)' // Dimmed for revoked
              : '#94a3b8',
            strokeDasharray: isAssociationEdge && !isActive ? '6 4' : undefined,
          },
        };
      }),
    [edges],
  );

  // Force React Flow to remount when validation data or associations change
  const flowKey = useMemo(
    () =>
      `tg-${feedbackCount}-${validations?.completed?.length ?? 0}-${validations?.pending?.length ?? 0}-${associationsData?.ok ? associationsData.associations?.length ?? 0 : 0}-${Object.keys(expandedAssociations).length}`,
    [feedbackCount, validations?.completed?.length, validations?.pending?.length, associationsData, expandedAssociations],
  );

  const onNodeClick = useCallback(
    async (node: GraphNode) => {
      setSelectedNode(node);
      setSelectedEns(null);

      if (node.type === 'reviews') {
        onOpenReviews();
        return;
      }

      if (node.type === 'validation' && node.data?.validatorAddress && resolveEnsName) {
        const ens = await resolveEnsName(node.data.validatorAddress);
        if (ens) setSelectedEns(ens);
      }
    },
    [onOpenReviews, resolveEnsName],
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          pb: 2,
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography variant="h6" component="span" fontWeight={600}>
          Trust Graph Explorer
        </Typography>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            color: palette.textSecondary,
            '&:hover': {
              backgroundColor: palette.surfaceMuted,
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pan to move, scroll to zoom. Click nodes to view details. Reviews and validations are
          connected to the selected agent.
        </Typography>

        <Box
          sx={{
            border: `1px solid ${palette.border}`,
            borderRadius: 2,
            height: 520,
            overflow: 'hidden',
            backgroundColor: '#f8fafc',
          }}
        >
          <ReactFlow
            key={flowKey}
            nodes={rfNodes}
            edges={rfEdges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_, node) => {
              const g = (node.data as any)?.graphNode as GraphNode | undefined;
              if (g) {
                void onNodeClick(g);
              }
            }}
          >
            <ReactFlowBackground />
            <ReactFlowMiniMap pannable zoomable />
            <ReactFlowControls showInteractive={false} />
          </ReactFlow>
        </Box>

        {selectedNode && (
          <Paper
            variant="outlined"
            sx={{
              mt: 2,
              p: 2,
              borderRadius: 2,
              borderColor: palette.border,
              backgroundColor: palette.surfaceMuted,
            }}
          >
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Node Details
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Type: {selectedNode.type}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Label: {selectedNode.label}
            </Typography>
            {selectedNode.type === 'validation' && selectedNode.data?.validatorAddress && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Validator: {selectedEns || selectedNode.data.validatorAddress}
                </Typography>
                {selectedNode.data.status && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Status: {selectedNode.data.status === 'completed' ? 'Completed' : 'Pending'}
                  </Typography>
                )}
                {selectedNode.data.response !== undefined && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Response: {selectedNode.data.response}
                  </Typography>
                )}
                {selectedNode.data.requestHash && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1, fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}
                  >
                    Request: {selectedNode.data.requestHash}
                  </Typography>
                )}
                {selectedNode.data.txHash && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1, fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}
                  >
                    Tx Hash: {selectedNode.data.txHash}
                  </Typography>
                )}
              </>
            )}
            {selectedNode.type === 'alliance' && selectedNode.data?.name && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Alliance Agent: {selectedNode.data.name}
                </Typography>
                {selectedNode.data.agentId && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Agent ID: {selectedNode.data.agentId}
                  </Typography>
                )}
                {selectedNode.data.ensName && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    ENS: {selectedNode.data.ensName}
                  </Typography>
                )}
              </>
            )}
            {selectedNode.type === 'association' && selectedNode.data?.address && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Address: <span style={{ fontFamily: 'monospace' }}>{selectedNode.data.address}</span>
                </Typography>
                {selectedNode.data.agentInfo?.agentId && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Agent ID: {selectedNode.data.agentInfo.agentId}
                  </Typography>
                )}
                {selectedNode.data.agentInfo?.agentName && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Agent Name: {selectedNode.data.agentInfo.agentName}
                  </Typography>
                )}
                {selectedNode.data.count !== undefined && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Associations: {selectedNode.data.activeCount || 0}/{selectedNode.data.count || 0} active
                  </Typography>
                )}
              </>
            )}
          </Paper>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 2 }}>
        <Button onClick={onClose} sx={{ borderRadius: 2, px: 3, textTransform: 'none', fontWeight: 600 }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}


