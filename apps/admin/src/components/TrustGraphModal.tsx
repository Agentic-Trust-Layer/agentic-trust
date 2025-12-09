'use client';

import React, { useMemo, useCallback, useState } from 'react';
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
  type: 'agent' | 'reviews' | 'validation' | 'alliance';
  data?: any;
};

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

  const agentName = agent.agentName || `Agent #${agent.agentId}`;
  const feedbackCount =
    typeof feedbackSummary?.count === 'string'
      ? parseInt(feedbackSummary.count, 10)
      : feedbackSummary?.count ?? 0;

  const nodes = useMemo<GraphNode[]>(() => {
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

    return [agentNode, reviewNode, ...validationNodes, ...allianceNodes];
  }, [agentName, feedbackCount, validations]);

  const edges = useMemo(() => {
    const base: Array<{ id: string; source: string; target: string }> = [
      { id: 'e-agent-reviews', source: 'agent', target: 'reviews' },
    ];

    nodes.forEach((n, idx) => {
      if (n.type === 'validation' || n.type === 'alliance') {
        base.push({ id: `e-${n.id}-${idx}`, source: 'agent', target: n.id });
      }
    });

    return base;
  }, [nodes]);

  const rfNodes = useMemo<RFNode[]>(() => {
    const centerX = 0;
    const topY = -150;

    return nodes.map((n, idx) => {
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
        const validationStartIdx = nodes.findIndex((node) => node.type === 'validation');
        const validationIdx = idx - validationStartIdx;
        const col = validationIdx % 3;
        const row = Math.floor(validationIdx / 3);
        x = centerX + 120 + col * 90;
        y = topY + 140 + row * 70;
      } else if (n.type === 'alliance') {
        // Alliance agents in a row further below, centered
        const allianceStartIdx = nodes.findIndex((node) => node.type === 'alliance');
        const allianceIdx = idx - allianceStartIdx;
        x = centerX - 150 + allianceIdx * 90;
        y = topY + 260;
      }

      return {
        id: n.id,
        position: { x, y },
        data: { label: n.label, graphNode: n },
        style: {
          borderRadius: 16,
          padding: '8px 12px',
          border: `2px solid ${n.color}`,
          background: '#ffffff',
          color: '#0f172a',
          fontSize: 12,
          fontWeight: 600,
          minWidth: 100,
          textAlign: 'center',
        },
      } satisfies RFNode;
    });
  }, [nodes]);

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: true,
        style: { strokeWidth: 1.5, stroke: '#94a3b8' },
      })),
    [edges],
  );

  // Force React Flow to remount when validation data changes
  const flowKey = useMemo(
    () =>
      `tg-${feedbackCount}-${validations?.completed?.length ?? 0}-${validations?.pending?.length ?? 0}`,
    [feedbackCount, validations?.completed?.length, validations?.pending?.length],
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


