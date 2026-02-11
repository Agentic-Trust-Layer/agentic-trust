/* eslint-disable no-console */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Container, CircularProgress, Skeleton } from '@mui/material';
import ShadowAgentImage from '../../../../docs/8004ShadowAgent.png';
import AgentDetailsPageContent from '@/components/AgentDetailsPageContent';
import type { AgentsPageAgent } from '@/components/AgentsPage';
import { Header } from '@/components/Header';
import { useAuth } from '@/components/AuthProvider';
import { useWallet } from '@/components/WalletProvider';

function normalizeResourceUrl(src?: string | null): string | null {
  if (!src) return null;
  let value = src.trim();
  if (!value) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    // ignore
  }
  if (value.startsWith('ipfs://')) {
    const path = value.slice('ipfs://'.length).replace(/^ipfs\//i, '');
    return `https://w3s.link/ipfs/${path}`;
  }
  if (value.startsWith('ar://')) {
    return `https://arweave.net/${value.slice('ar://'.length)}`;
  }
  return value;
}

type Props = {
  uaid: string;
};

export default function AgentDetailsPageLoader({ uaid }: Props) {
  const auth = useAuth();
  const wallet = useWallet();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const abort = (reason: unknown) => {
      try {
        // Some runtimes support abort(reason)
        (controller as any).abort(reason);
      } catch {
        controller.abort();
      }
    };
    const timeout = setTimeout(() => abort('timeout'), 12_000);

    (async () => {
      try {
        setLoading(true);
        setError(null);
        let navStartedAt: number | null = null;
        try {
          const raw = sessionStorage.getItem('nav:agentDetails');
          const parsed = raw ? (JSON.parse(raw) as any) : null;
          if (parsed && typeof parsed === 'object' && parsed.uaid === uaid && typeof parsed.startedAt === 'number') {
            const startedAt = parsed.startedAt as number;
            navStartedAt = startedAt;
            console.log('[AgentDetailsPageLoader] nav -> mount ms:', Math.max(0, Date.now() - startedAt));
          }
          sessionStorage.removeItem('nav:agentDetails');
        } catch {
          // ignore
        }

        const path = `/api/agents/${encodeURIComponent(uaid)}`;
        const fullUrl = typeof window !== 'undefined' ? new URL(path, window.location.origin).href : path;

        const tFetch0 = performance.now();
        const res = await fetch(path, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const tHeaders = performance.now();

        const tBody0 = performance.now();
        const bodyText = await res.text();
        const tBody1 = performance.now();

        const tParse0 = performance.now();
        const json = (() => {
          if (!bodyText) return null;
          try {
            return JSON.parse(bodyText);
          } catch {
            return null;
          }
        })();
        const tParse1 = performance.now();

        const entries = typeof performance !== 'undefined' ? performance.getEntriesByName(fullUrl) : [];
        const last = entries.length > 0 ? (entries[entries.length - 1] as PerformanceEntry) : null;
        const timing = last && 'responseStart' in last ? (last as PerformanceResourceTiming) : null;

        if (cancelled) return;
        if (!res.ok) {
          throw new Error((json as any)?.message || (json as any)?.error || `Failed to load agent (${res.status})`);
        }
        const tSet0 = performance.now();
        setDetail(json);
        const tSet1 = performance.now();
        requestAnimationFrame(() => {
          const tPaint = performance.now();
          console.log('[AgentDetailsPageLoader] /api/agents breakdown ms:', {
            waitHeaders: Math.round(tHeaders - tFetch0),
            readBody: Math.round(tBody1 - tBody0),
            jsonParse: Math.round(tParse1 - tParse0),
            setState: Math.round(tSet1 - tSet0),
            toNextPaint: Math.round(tPaint - tSet0),
          });

          if (timing) {
            console.log('[AgentDetailsPageLoader] /api/agents resource timing ms:', {
              total: Math.round(timing.responseEnd - timing.startTime),
              ttfb: Math.round(timing.responseStart - timing.startTime),
              download: Math.round(timing.responseEnd - timing.responseStart),
              transferSize: timing.transferSize,
              encodedBodySize: timing.encodedBodySize,
              decodedBodySize: timing.decodedBodySize,
            });
          }
        });

        const headerTotal = res.headers.get('x-agent-details-total-ms');
        const headerClient = res.headers.get('x-agent-details-client-ms');
        const headerCore = res.headers.get('x-agent-details-core-ms');
        if (headerTotal || headerClient || headerCore) {
          console.log('[AgentDetailsPageLoader] server timing headers ms:', {
            total: headerTotal,
            getClient: headerClient,
            core: headerCore,
          });
        }
        if (navStartedAt != null) {
          console.log('[AgentDetailsPageLoader] nav -> data ms:', Math.max(0, Date.now() - navStartedAt));
        }
      } catch (e: any) {
        if (cancelled) return;
        if (controller.signal.aborted || e?.name === 'AbortError') {
          const reason = (controller.signal as any)?.reason;
          if (reason === 'timeout') {
            setError('Request timed out while loading agent details. Retry.');
          }
          // Ignore aborts caused by navigation/unmount.
          return;
        }
        setError(e?.message ?? 'Failed to load agent');
        setDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      abort('cleanup');
    };
  }, [uaid]);

  const { agent, heroImageSrc, heroImageFallbackSrc, chainId, ownerDisplay } = useMemo(() => {
    const shadowAgentSrc = (ShadowAgentImage as unknown as { src?: string }).src ?? '/8004ShadowAgent.png';
    const d = detail ?? {};
    const chainId = typeof d?.chainId === 'number' ? d.chainId : 0;
    const agentTypes =
      Array.isArray((d as any)?.agentTypes)
        ? ((d as any).agentTypes as string[])
        : Array.isArray((d as any)?.discovery?.agentTypes)
          ? ((d as any).discovery.agentTypes as string[])
          : null;
    const isSmartAgent =
      typeof (d as any)?.isSmartAgent === 'boolean'
        ? ((d as any).isSmartAgent as boolean)
        : typeof (d as any)?.discovery?.isSmartAgent === 'boolean'
          ? ((d as any).discovery.isSmartAgent as boolean)
          : null;

    const serializedAgent: AgentsPageAgent = {
      agentId: d?.agentId?.toString?.() ?? '',
      chainId,
      uaid: typeof d?.uaid === 'string' ? d.uaid : uaid,
      agentName: typeof d?.agentName === 'string' ? d.agentName : null,
      agentTypes,
      isSmartAgent,
      agentAccount: typeof d?.agentAccount === 'string' ? d.agentAccount : null,
      agentIdentityOwnerAccount: typeof d?.agentIdentityOwnerAccount === 'string' ? d.agentIdentityOwnerAccount : null,
      eoaAgentIdentityOwnerAccount: d?.eoaAgentIdentityOwnerAccount ?? null,
      eoaAgentAccount: d?.eoaAgentAccount ?? null,
      identityOwnerAccount: d?.identityOwnerAccount ?? null,
      identityWalletAccount: d?.identityWalletAccount ?? null,
      identityOperatorAccount: d?.identityOperatorAccount ?? null,
      agentOwnerAccount: d?.agentOwnerAccount ?? null,
      agentWalletAccount: d?.agentWalletAccount ?? null,
      agentOperatorAccount: d?.agentOperatorAccount ?? null,
      agentOwnerEOAAccount: d?.agentOwnerEOAAccount ?? null,
      smartAgentAccount: d?.smartAgentAccount ?? null,
      identity8004Did: d?.identity8004Did ?? null,
      identity8122Did: d?.identity8122Did ?? null,
      identityEnsDid: d?.identityEnsDid ?? null,
      identityHolDid: d?.identityHolDid ?? null,
      identityHolUaid: d?.identityHolUaid ?? null,
      identity8004DescriptorJson: d?.identity8004DescriptorJson ?? null,
      identity8122DescriptorJson: d?.identity8122DescriptorJson ?? null,
      identityEnsDescriptorJson: d?.identityEnsDescriptorJson ?? null,
      identityHolDescriptorJson: d?.identityHolDescriptorJson ?? null,
      identity8004OnchainMetadataJson: d?.identity8004OnchainMetadataJson ?? null,
      identity8122OnchainMetadataJson: d?.identity8122OnchainMetadataJson ?? null,
      identityEnsOnchainMetadataJson: d?.identityEnsOnchainMetadataJson ?? null,
      identityHolOnchainMetadataJson: d?.identityHolOnchainMetadataJson ?? null,
      agentUri: typeof d?.agentUri === 'string' ? d.agentUri : null,
      description: typeof d?.description === 'string' ? d.description : null,
      image: typeof d?.image === 'string' ? d.image : null,
      contractAddress: d?.contractAddress ?? null,
      a2aEndpoint: d?.a2aEndpoint ?? null,
      mcpEndpoint: d?.mcpEndpoint ?? null,
      did: d?.did ?? null,
      createdAtTime: d?.createdAtTime ?? null,
      feedbackCount: d?.feedbackCount ?? null,
      feedbackAverageScore: d?.feedbackAverageScore ?? null,
      validationPendingCount: d?.validationPendingCount ?? null,
      validationCompletedCount: d?.validationCompletedCount ?? null,
      validationRequestedCount: d?.validationRequestedCount ?? null,
      initiatedAssociationCount: d?.initiatedAssociationCount ?? null,
      approvedAssociationCount: d?.approvedAssociationCount ?? null,
      atiOverallScore: d?.atiOverallScore ?? null,
      atiOverallConfidence: d?.atiOverallConfidence ?? null,
      atiVersion: d?.atiVersion ?? null,
      atiComputedAt: d?.atiComputedAt ?? null,
      atiBundleJson: d?.atiBundleJson ?? null,
      trustLedgerScore: d?.trustLedgerScore ?? null,
      trustLedgerBadgeCount: d?.trustLedgerBadgeCount ?? null,
      trustLedgerOverallRank: d?.trustLedgerOverallRank ?? null,
      trustLedgerCapabilityRank: d?.trustLedgerCapabilityRank ?? null,
      serviceEndpoints: Array.isArray(d?.serviceEndpoints) ? d.serviceEndpoints : null,
      identity8122: d?.identity8122 ?? null,
    };

    const heroImageSrc = normalizeResourceUrl(serializedAgent.image) ?? shadowAgentSrc;
    const ownerDisplaySource =
      serializedAgent.eoaAgentIdentityOwnerAccount ??
      serializedAgent.agentIdentityOwnerAccount ??
      serializedAgent.agentAccount ??
      null;
    const ownerDisplay =
      ownerDisplaySource && ownerDisplaySource.length > 10
        ? `${ownerDisplaySource.slice(0, 6)}…${ownerDisplaySource.slice(-4)}`
        : ownerDisplaySource || '—';

    return {
      agent: serializedAgent,
      heroImageSrc,
      heroImageFallbackSrc: shadowAgentSrc,
      chainId,
      ownerDisplay,
    };
  }, [detail, uaid]);

  const header = (
    <Header
      displayAddress={wallet.address ?? null}
      privateKeyMode={wallet.privateKeyMode}
      isConnected={wallet.connected}
      onConnect={auth.openLoginModal}
      onDisconnect={auth.handleDisconnect}
      disableConnect={wallet.loading || auth.loading}
    />
  );

  if (loading) {
    return (
      <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
        {header}
        <Container maxWidth={false} disableGutters sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, md: 4 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <CircularProgress size={20} />
            <Box sx={{ color: 'text.secondary' }}>Loading agent…</Box>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 360px' }, gap: 3 }}>
            <Box>
              <Skeleton variant="text" width={240} height={36} />
              <Skeleton variant="text" width={320} height={24} />
              <Skeleton variant="rectangular" height={220} sx={{ mt: 2, borderRadius: 2 }} />
              <Skeleton variant="rectangular" height={160} sx={{ mt: 2, borderRadius: 2 }} />
            </Box>
            <Box>
              <Skeleton variant="rectangular" height={180} sx={{ borderRadius: 2 }} />
              <Skeleton variant="rectangular" height={220} sx={{ mt: 2, borderRadius: 2 }} />
            </Box>
          </Box>
        </Container>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
        {header}
        <Container
          maxWidth={false}
          disableGutters
          sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, md: 4 }, width: '100%' }}
        >
          <Alert severity="error">{error}</Alert>
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      {header}
      <AgentDetailsPageContent
        agent={agent}
        uaid={uaid}
        heroImageSrc={heroImageSrc}
        heroImageFallbackSrc={heroImageFallbackSrc}
        displayDid={uaid}
        chainId={chainId}
        ownerDisplay={ownerDisplay}
        onChainMetadata={{}}
      />
    </Box>
  );
}

