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
import { decodeAssociationData } from '@/lib/association';
import { ASSOC_TYPE_OPTIONS } from '@/lib/association-types';
import ShadowAgentImage from '../../../../docs/8004ShadowAgent.png';
import { Handle, Position } from '@xyflow/react';

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
  initiator?: string;
  approver?: string;
  counterparty?: string;
  initiatorAddress?: string;
  approverAddress?: string;
  counterpartyAddress?: string;
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
  image?: string | null;
};

function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function safeLower(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function safeAddrLower(value: unknown): string {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return '';
  return s.toLowerCase();
}

function assocTypeLabel(value: number): string {
  const entry = ASSOC_TYPE_OPTIONS.find((opt) => opt.value === value);
  return entry ? entry.label : String(value);
}

// Custom node component with agent icon
function AgentNodeWithIcon({ data }: { data: any }) {
  const graphNode = data.graphNode as GraphNode;
  const agentInfo = graphNode.data?.agentInfo as AgentInfo | undefined;
  const shadowAgentSrc = (ShadowAgentImage as unknown as { src?: string }).src ?? '/8004ShadowAgent.png';
  const imageSrc = agentInfo?.image && agentInfo.image.trim() ? agentInfo.image.trim() : shadowAgentSrc;
  
  return (
    <div
      style={{
        borderRadius: 12,
        padding: 10,
        border: `1px solid ${
          graphNode.type === 'association'
            ? '#f97316'
            : graphNode.type === 'validation'
              ? '#16a34a'
              : graphNode.color
        }`,
        background:
          graphNode.type === 'association'
            ? '#fff7ed'
            : graphNode.type === 'validation'
              ? '#f0fdf4'
              : '#ffffff',
        color: '#0f172a',
        fontSize: 12,
        fontWeight: 600,
        width: 240,
        minHeight: 60,
        textAlign: 'center',
        whiteSpace: 'pre-line',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {agentInfo && (
        <img
          src={imageSrc}
          alt={agentInfo.agentName || 'Agent'}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            objectFit: 'cover',
            border: `2px solid ${
              graphNode.type === 'association'
                ? '#f97316'
                : graphNode.type === 'validation'
                  ? '#16a34a'
                  : '#94a3b8'
            }`,
          }}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (!target.src.includes(shadowAgentSrc)) {
              target.src = shadowAgentSrc;
            }
          }}
        />
      )}
      <div>{data.label}</div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
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
    
    const rootAddr = safeLower(agent.agentAccount);
    const firstHops = Array.from(
      new Set(
        (associationsData.associations ?? [])
          .map((a) => safeLower(a?.counterparty))
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

  // Fetch agent info for association addresses AND validator addresses
  // Use the same lookup approach as AgentDetailsTabs (Associations tab)
  useEffect(() => {
    if (!open) return;
    
    // Collect all unique addresses from associations AND validations
    const addressesToLookup = new Set<string>();
    const centerAddr = agent.agentAccount?.toLowerCase();

    // Collect from associations (same as Associations tab)
    if (associationsData && associationsData.ok) {
      const extractAddrsForLookup = (a: any): { initiator: string; approver: string; counterparty: string } => {
        const initiator =
          safeAddrLower(a?.initiator) ||
          safeAddrLower(a?.initiatorAddress) ||
          safeAddrLower(a?.record?.initiator);
        const approver =
          safeAddrLower(a?.approver) ||
          safeAddrLower(a?.approverAddress) ||
          safeAddrLower(a?.record?.approver);
        const counterparty =
          safeAddrLower(a?.counterparty) ||
          safeAddrLower(a?.counterpartyAddress) ||
          (initiator && initiator === centerAddr ? approver : approver && approver === centerAddr ? initiator : approver);
        return { initiator, approver, counterparty };
      };
      
      for (const a of associationsData.associations || []) {
        const { initiator, approver, counterparty } = extractAddrsForLookup(a);
        
        if (initiator && initiator !== centerAddr) addressesToLookup.add(initiator);
        if (approver && approver !== centerAddr) addressesToLookup.add(approver);
        if (counterparty && counterparty !== centerAddr) addressesToLookup.add(counterparty);
      }
      
      // Also check expanded associations
      for (const resp of Object.values(expandedAssociations)) {
        if (!resp || !resp.ok) continue;
        for (const a of resp.associations || []) {
          const { initiator, approver, counterparty } = extractAddrsForLookup(a);
          
          if (initiator && initiator !== centerAddr) addressesToLookup.add(initiator);
          if (approver && approver !== centerAddr) addressesToLookup.add(approver);
          if (counterparty && counterparty !== centerAddr) addressesToLookup.add(counterparty);
        }
      }
    }

    // Collect from validations (same data source as Validators tab)
    for (const v of validations?.completed ?? []) {
      const validator = safeAddrLower(v?.validatorAddress);
      if (validator && validator !== centerAddr) addressesToLookup.add(validator);
    }
    for (const v of validations?.pending ?? []) {
      const validator = safeAddrLower(v?.validatorAddress);
      if (validator && validator !== centerAddr) addressesToLookup.add(validator);
    }
    
    if (addressesToLookup.size === 0) return;
    
    let cancelled = false;
    
    // Fetch agent info for each address using the EXACT same approach as AgentDetailsTabs:
    // /api/agents/search?query=<address> → find exact match by agentAccount
    (async () => {
      const cachedKeys = new Set<string>(Array.from(agentInfoByAddress.keys()));
      const results = await Promise.allSettled(
        Array.from(addressesToLookup)
          .map((addr) => addr.toLowerCase())
          .filter((addrLower) => !cachedKeys.has(addrLower))
          .map(async (addrLower) => {
          try {
            // Use /api/agents/by-account for exact address lookup (same detailed path as tabs)
            // This uses getAgentByAccount which directly queries by agentAccount
            const chainId = agent.chainId || 11155111;
            const didEthr = `did:ethr:${chainId}:${addrLower}`;
            const res = await fetch(
              `/api/agents/by-account/${encodeURIComponent(didEthr)}`,
              { cache: 'no-store' },
            );
            if (!res.ok) {
              // 404 is expected for addresses that aren't registered agents (EOAs, validator addresses, etc.)
              return [addrLower, null] as const;
            }
            const detail = await res.json().catch(() => null);
            if (!detail || !detail.agentId) return [addrLower, null] as const;
            return [addrLower, {
              agentId: detail.agentId ? String(detail.agentId) : undefined,
              agentName: typeof detail.agentName === 'string' ? detail.agentName : undefined,
              agentAccount: typeof detail.agentAccount === 'string' ? detail.agentAccount : addrLower,
              image: typeof detail.image === 'string' ? detail.image : null,
            }] as const;
          } catch (e) {
            // Errors are expected for non-agent addresses
            return [addrLower, null] as const;
          }
        })
      );
      
      if (cancelled) return;
      
      setAgentInfoByAddress((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const [addr, info] = r.value;
            if (info && info.agentId) {
              // Only store if we have agentId (actual agent info, not just address)
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
  }, [open, associationsData, expandedAssociations, validations, agent.agentAccount, agent.chainId]);

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
        image: agent.image || null,
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
      label: `#${agent.agentId} Reviews (${feedbackCount})`,
      x: 0,
      y: 0,
      color: '#2563eb', // blue
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
      .map((v, idx) => {
        const addr = v.validatorAddress || '';
        const addrLower = safeAddrLower(addr);
        const known = addrLower ? getAgentInfoForAddress(addrLower) : null;
        const label = addr
          ? known
            ? `#${known.agentId} ${known.agentName || 'Agent'}\n${shortAddr(addr)}`
            : `Validator\n${shortAddr(addr)}`
          : 'Validator';
        return {
        id: `val-completed-${idx}`,
        label,
        x: 0,
        y: 0,
        color: '#16a34a', // green (validator agents)
        type: 'validation',
        data: { ...v, status: 'completed' as const, agentInfo: known, address: addr },
        } as GraphNode;
      });

    const pendingValidationNodes: GraphNode[] = (validations?.pending || [])
      .slice(0, 25)
      .map((v, idx) => {
        const addr = v.validatorAddress || '';
        const addrLower = safeAddrLower(addr);
        const known = addrLower ? getAgentInfoForAddress(addrLower) : null;
        const label = addr
          ? known
            ? `#${known.agentId} ${known.agentName || 'Agent'}\n${shortAddr(addr)}`
            : `Validator\n${shortAddr(addr)}`
          : 'Validator';
        return {
        id: `val-pending-${idx}`,
        label,
        x: 0,
        y: 0,
        color: '#16a34a', // green (validator agents)
        type: 'validation',
        data: { ...v, status: 'pending' as const, agentInfo: known, address: addr },
        } as GraphNode;
      });

    const validationNodes: GraphNode[] = [...completedValidationNodes, ...pendingValidationNodes];

    // Alliance agents - for now we'll use an empty array, but this can be populated from agent relationships
    const allianceNodes: GraphNode[] = [];

    // Build association nodes
    const associationNodes: GraphNode[] = [];
    const associationEdges: Array<{ id: string; source: string; target: string; assoc: Assoc }> = [];
    
    if (associationsData && associationsData.ok && agent.agentAccount) {
      const centerAddr = safeLower(agent.agentAccount);
      const associations = (associationsData.associations || []) as Assoc[];

      const extractAddrs = (a: Assoc): { initiator: string; approver: string; counterparty: string } => {
        const initiator =
          safeAddrLower((a as any).initiator) ||
          safeAddrLower((a as any).initiatorAddress) ||
          safeAddrLower((a as any).record?.initiator);
        const approver =
          safeAddrLower((a as any).approver) ||
          safeAddrLower((a as any).approverAddress) ||
          safeAddrLower((a as any).record?.approver);
        const counterparty =
          safeAddrLower((a as any).counterparty) ||
          safeAddrLower((a as any).counterpartyAddress) ||
          (initiator && initiator === centerAddr ? approver : approver && approver === centerAddr ? initiator : approver);
        return { initiator, approver, counterparty };
      };

      // Collect first-hop counterpart addresses with counts
      const counterparts = new Map<string, { count: number; activeCount: number }>();
      for (const a of associations) {
        const { counterparty } = extractAddrs(a);
        const other = counterparty || null;
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
          : `#— Unknown\n${shortAddr(addr)}\n${meta.activeCount}/${meta.count} active`;
        
        associationNodes.push({
          id: `assoc-${addr}`,
          label,
          x: 0,
          y: 0,
          color: '#f97316', // orange (association agents)
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
        const { initiator: s, approver: t } = extractAddrs(a);
        if (!s || !t) {
          // Skip malformed association records to keep the graph rendering stable.
          continue;
        }
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
              : `#— Unknown\n${shortAddr(addrLower)}`;
            associationNodes.push({
              id: nodeId,
              label,
              x: 0,
              y: 0,
              color: '#f97316', // orange
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
          const { counterparty: other } = extractAddrs(a as any);
          if (!other || other === centerAddr) continue;
          if (!associationNodes.find((n) => n.id === `assoc-${other}`)) {
            seconds.add(other);
          }
        }
        seconds.forEach((addr) => {
          const known = getAgentInfoForAddress(addr);
          const label = known
            ? `#${known.agentId} ${known.agentName || 'Agent'}\n${shortAddr(addr)}`
            : `#— Unknown\n${shortAddr(addr)}`;
          associationNodes.push({
            id: `assoc-${addr}`,
            label,
            x: 0,
            y: 0,
            color: '#f97316', // orange
            type: 'association',
            data: { address: addr, agentInfo: known },
          });
        });
      }
    }

    // Update agent node label to include agentId + account address
    agentNode.label = `#${agent.agentId} ${agentName}\n${agent.agentAccount ? shortAddr(agent.agentAccount) : ''}`;

    return {
      nodes: [agentNode, reviewNode, ...validationNodes, ...allianceNodes, ...associationNodes],
      associationEdges,
    };
  }, [agentName, feedbackCount, validations, associationsData, expandedAssociations, agent.agentAccount, agent.agentId, getAgentInfoForAddress, agentInfoByAddress]);

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
        // Validators in a right-side column
        const validationStartIdx = allNodes.findIndex((node) => node.type === 'validation');
        const validationIdx = idx - validationStartIdx;
        x = centerX + 360;
        y = topY + 60 + validationIdx * 70;
      } else if (n.type === 'alliance') {
        // Alliance agents in a row further below, centered
        const allianceStartIdx = allNodes.findIndex((node: GraphNode) => node.type === 'alliance');
        const allianceIdx = idx - allianceStartIdx;
        x = centerX - 150 + allianceIdx * 90;
        y = topY + 260;
      } else if (n.type === 'association') {
        // Association nodes: directly under the selected agent
        const associationStartIdx = allNodes.findIndex((node: GraphNode) => node.type === 'association');
        const associationIdx = idx - associationStartIdx;
        
        const spacingY = 95;
        x = centerX;
        y = topY + 170 + associationIdx * spacingY;
      }

      // Use custom node type for association and validation nodes that have agent info
      const useCustomNode = (n.type === 'association' || n.type === 'validation') && n.data?.agentInfo;
      
      return {
        id: n.id,
        position: { x, y },
        type: useCustomNode ? 'agent-node' : 'default',
        data: { label: n.label, graphNode: n },
        style: useCustomNode ? undefined : {
          borderRadius: 12,
          padding: 10,
          border: `1px solid ${
            n.type === 'agent'
              ? 'rgba(255,255,255,0.15)'
              : n.type === 'association'
                ? '#f97316'
                : n.type === 'validation'
                  ? '#16a34a'
                  : n.color
          }`,
          background:
            n.type === 'agent'
              ? '#0f172a'
              : n.type === 'association'
                ? '#fff7ed'
                : n.type === 'validation'
                  ? '#f0fdf4'
                  : '#ffffff',
          color: n.type === 'agent' ? 'white' : '#0f172a',
          fontSize: 12,
          fontWeight: 600,
          width: 240,
          minHeight: 60,
          textAlign: 'center',
          whiteSpace: 'pre-line',
          boxShadow:
            n.type === 'association' || n.type === 'validation'
              ? '0 2px 8px rgba(0,0,0,0.12)'
              : undefined,
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
            nodeTypes={{ 'agent-node': AgentNodeWithIcon }}
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
            {selectedNode.type === 'agent' && agent.agentAccount && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Agent ID: {agent.agentId}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Address: <span style={{ fontFamily: 'monospace' }}>{agent.agentAccount}</span>
                </Typography>
              </>
            )}
            {selectedNode.type === 'reviews' && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Reviews: {feedbackCount}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Average score: {feedbackSummary?.averageScore ?? '—'}
                </Typography>
                <Button
                  variant="outlined"
                  onClick={onOpenReviews}
                  sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600, mt: 1 }}
                >
                  Open Reviews
                </Button>
              </>
            )}
            {selectedNode.type === 'validation' && selectedNode.data?.validatorAddress && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Agent: {selectedEns || selectedNode.data.validatorAddress}
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
                {selectedNode.data.agentInfo?.agentAccount && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Address:{' '}
                    <span style={{ fontFamily: 'monospace' }}>{selectedNode.data.agentInfo.agentAccount}</span>
                  </Typography>
                )}
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
                {selectedNode.data.requestJson && (
                  <Box sx={{ mt: 1, mb: 1 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                      Request JSON:
                    </Typography>
                    <Box
                      component="pre"
                      sx={{
                        margin: 0,
                        padding: '0.5rem',
                        backgroundColor: palette.background,
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        overflow: 'auto',
                        maxHeight: '200px',
                        fontFamily: 'ui-monospace, monospace',
                        border: `1px solid ${palette.border}`,
                      }}
                    >
                      {(() => {
                        try {
                          const parsed = JSON.parse(selectedNode.data.requestJson);
                          return JSON.stringify(parsed, null, 2);
                        } catch {
                          return selectedNode.data.requestJson;
                        }
                      })()}
                    </Box>
                  </Box>
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
                {(() => {
                  const addrLower = safeAddrLower(selectedNode.data.address);
                  if (!addrLower || !associationsData || !associationsData.ok || !agent.agentAccount) return null;

                  // Merge root + expanded associations (dedupe by associationId)
                  const seen = new Set<string>();
                  const all: any[] = [];
                  for (const a of (associationsData.associations ?? []) as any[]) {
                    if (!a?.associationId || seen.has(String(a.associationId))) continue;
                    seen.add(String(a.associationId));
                    all.push(a);
                  }
                  for (const resp of Object.values(expandedAssociations)) {
                    if (!resp || (resp as any).ok === false) continue;
                    for (const a of ((resp as any).associations ?? []) as any[]) {
                      if (!a?.associationId || seen.has(String(a.associationId))) continue;
                      seen.add(String(a.associationId));
                      all.push(a);
                    }
                  }

                  const centerLower = safeAddrLower(agent.agentAccount);
                  const matches = all.filter((a) => {
                    const initiator =
                      safeAddrLower(a?.initiator) ||
                      safeAddrLower(a?.initiatorAddress) ||
                      safeAddrLower(a?.record?.initiator);
                    const approver =
                      safeAddrLower(a?.approver) ||
                      safeAddrLower(a?.approverAddress) ||
                      safeAddrLower(a?.record?.approver);
                    if (!initiator || !approver) return false;
                    const isBetween =
                      (initiator === centerLower && approver === addrLower) ||
                      (approver === centerLower && initiator === addrLower);
                    return isBetween;
                  });

                  if (matches.length === 0) return null;

                  return (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                        Associations ({matches.length})
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {matches.slice(0, 10).map((a) => {
                          const verification = a?.verification || {};
                          const active = Number(a?.revokedAt ?? 0) === 0;
                          const decoded = a?.record?.data ? decodeAssociationData(a.record.data) : null;
                          const typeLabel =
                            decoded && typeof decoded.assocType === 'number'
                              ? assocTypeLabel(decoded.assocType)
                              : '—';
                          const desc = decoded?.description ?? '—';
                          const initiatorAddr =
                            safeAddrLower(a?.initiatorAddress) ||
                            safeAddrLower(a?.initiator) ||
                            safeAddrLower(a?.record?.initiator);
                          const approverAddr =
                            safeAddrLower(a?.approverAddress) ||
                            safeAddrLower(a?.approver) ||
                            safeAddrLower(a?.record?.approver);
                          const interfaceId = String(a?.record?.interfaceId ?? '—');

                          return (
                            <Box
                              key={String(a.associationId)}
                              sx={{
                                border: `1px solid ${palette.border}`,
                                borderRadius: 2,
                                p: 1.25,
                                backgroundColor: palette.surface,
                              }}
                            >
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                #{String(a?.associationId).slice(0, 10)}… {active ? 'Active' : 'Revoked'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                {typeLabel} · {desc}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                interfaceId: <span style={{ fontFamily: 'monospace' }}>{interfaceId}</span>
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                Initiator: <span style={{ fontFamily: 'monospace' }}>{initiatorAddr || '—'}</span>
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                Approver: <span style={{ fontFamily: 'monospace' }}>{approverAddr || '—'}</span>
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                Digest OK: {verification?.recordHashMatches ? 'OK' : '—'}
                                {' · '}
                                Initiator Sig: {verification?.initiator?.ok ? 'OK' : '—'}
                                {' · '}
                                Approver Sig: {verification?.approver?.ok ? 'OK' : '—'}
                              </Typography>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  );
                })()}
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


