import { notFound } from 'next/navigation';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import type { AgentsPageAgent } from '@/components/AgentsPage';
import ShadowAgentImage from '../../../../../../docs/8004ShadowAgent.png';
import AgentDetailsPageContent from '@/components/AgentDetailsPageContent';
import type { AgentDetailsValidationsSummary } from '@/components/AgentDetailsTabs';

type DetailsPageParams = {
  params: Promise<{
    uaid: string[];
  }>;
};

export default async function AgentDetailsPage({ params }: DetailsPageParams) {
  const { uaid: uaidArray } = await params;

  // UAID is the canonical navigation identifier.
  const uaidRaw = Array.isArray(uaidArray) ? uaidArray.join('/') : uaidArray;
  const uaid = decodeURIComponent(String(uaidRaw ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    notFound();
  }

  const client = await getAgenticTrustClient();

  // Universal UAID->details resolver (may or may not be on-chain).
  let detail: any = null;
  try {
    detail = await (client as any).getAgentDetailsByUaidUniversal(uaid, { includeRegistration: false });
  } catch (error) {
    console.warn('[AgentDetailsPage] Failed to resolve agent by UAID:', error);
    notFound();
  }

  const chainId = typeof detail?.chainId === 'number' ? detail.chainId : 0;

  // Access image from agent data - try multiple paths
  const agentImage = (detail as any).image ?? ((detail as any).data?.image) ?? null;
  const agentUriFromAgent = (detail as any).agentUri ?? ((detail as any).data?.agentUri) ?? null;

  const safeParseJson = (raw: unknown): any | null => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const registrationFromAgent = safeParseJson((detail as any).rawJson ?? (detail as any)?.data?.rawJson);

  // Extract MCP endpoint from already-loaded registration JSON (best-effort).
  let mcpEndpoint: string | null = null;
  try {
    const endpoints = Array.isArray(registrationFromAgent?.endpoints)
      ? (registrationFromAgent.endpoints as any[])
      : [];
    const mcpEndpointEntry = endpoints.find(
      (ep: any) =>
        ep &&
        typeof ep.name === 'string' &&
        (ep.name === 'MCP' || ep.name === 'mcp') &&
        typeof ep.endpoint === 'string',
    );
    if (mcpEndpointEntry?.endpoint) {
      mcpEndpoint = String(mcpEndpointEntry.endpoint);
    }
  } catch (error) {
    console.warn('[AgentDetailsPage] Failed to parse registration for MCP endpoint:', error);
  }

  // NOTE: Avoid heavy on-chain / IPFS / extra GraphQL reads during SSR.
  // Anything beyond the basic agent record is loaded client-side after navigation.
  const allMetadata: Record<string, string> = {};

  const serializedAgent: AgentsPageAgent = {
    agentId: detail.agentId?.toString?.() ?? '',
    chainId,
    uaid: (detail as any).uaid ?? uaid,
    agentName: detail.agentName ?? null,
    agentAccount:
      (detail as any).agentAccount ??
      (detail as any).account ??
      (detail as any).owner ??
      (detail as any).data?.agentAccount ??
      (detail as any).data?.account ??
      (detail as any).data?.owner ??
      null,
    agentIdentityOwnerAccount:
      (detail as any).agentIdentityOwnerAccount ?? (detail as any)?.data?.agentIdentityOwnerAccount ?? null,
    eoaAgentIdentityOwnerAccount:
      (detail as any).eoaAgentIdentityOwnerAccount ?? (detail as any)?.data?.eoaAgentIdentityOwnerAccount ?? null,
    eoaAgentAccount: (detail as any).eoaAgentAccount ?? (detail as any)?.data?.eoaAgentAccount ?? null,
    identityOwnerAccount: (detail as any).identityOwnerAccount ?? (detail as any)?.data?.identityOwnerAccount ?? null,
    identityWalletAccount: (detail as any).identityWalletAccount ?? (detail as any)?.data?.identityWalletAccount ?? null,
    identityOperatorAccount:
      (detail as any).identityOperatorAccount ?? (detail as any)?.data?.identityOperatorAccount ?? null,
    agentOwnerAccount: (detail as any).agentOwnerAccount ?? (detail as any)?.data?.agentOwnerAccount ?? null,
    agentWalletAccount: (detail as any).agentWalletAccount ?? (detail as any)?.data?.agentWalletAccount ?? null,
    agentOperatorAccount: (detail as any).agentOperatorAccount ?? (detail as any)?.data?.agentOperatorAccount ?? null,
    agentOwnerEOAAccount: (detail as any).agentOwnerEOAAccount ?? (detail as any)?.data?.agentOwnerEOAAccount ?? null,
    smartAgentAccount: (detail as any).smartAgentAccount ?? (detail as any)?.data?.smartAgentAccount ?? null,
    agentUri: agentUriFromAgent ?? null,
    description: (detail as any).description ?? null,
    image: agentImage ?? null,
    contractAddress: (detail as any).contractAddress ?? null,
    a2aEndpoint: (detail as any).a2aEndpoint ?? null,
    mcpEndpoint,
    did: (detail as any).did ?? null,
    createdAtTime: (detail as any).createdAtTime ?? null,
    feedbackCount: (detail as any).feedbackCount ?? null,
    feedbackAverageScore: (detail as any).feedbackAverageScore ?? null,
    validationPendingCount: (detail as any).validationPendingCount ?? null,
    validationCompletedCount: (detail as any).validationCompletedCount ?? null,
    validationRequestedCount: (detail as any).validationRequestedCount ?? null,
    initiatedAssociationCount: (detail as any).initiatedAssociationCount ?? null,
    approvedAssociationCount: (detail as any).approvedAssociationCount ?? null,
    atiOverallScore: (detail as any).atiOverallScore ?? null,
    atiOverallConfidence: (detail as any).atiOverallConfidence ?? null,
    atiVersion: (detail as any).atiVersion ?? null,
    atiComputedAt: (detail as any).atiComputedAt ?? null,
    atiBundleJson: (detail as any).atiBundleJson ?? null,
    trustLedgerScore: (detail as any).trustLedgerScore ?? null,
    trustLedgerBadgeCount: (detail as any).trustLedgerBadgeCount ?? null,
    trustLedgerOverallRank: (detail as any).trustLedgerOverallRank ?? null,
    trustLedgerCapabilityRank: (detail as any).trustLedgerCapabilityRank ?? null,
  };

  const shadowAgentSrc = (ShadowAgentImage as unknown as { src?: string }).src ?? '/8004ShadowAgent.png';
  const registrationImage = typeof registrationFromAgent?.image === 'string' ? registrationFromAgent.image : null;
  const heroImageSrc = normalizeResourceUrl(serializedAgent.image ?? registrationImage) ?? shadowAgentSrc;
  const ownerDisplaySource =
    serializedAgent.eoaAgentIdentityOwnerAccount ??
    serializedAgent.agentIdentityOwnerAccount ??
    serializedAgent.agentAccount ??
    null;
  const ownerDisplay =
    ownerDisplaySource && ownerDisplaySource.length > 10
      ? `${ownerDisplaySource.slice(0, 6)}…${ownerDisplaySource.slice(-4)}`
      : ownerDisplaySource || '—';

  return (
    <AgentDetailsPageContent
      agent={serializedAgent}
      uaid={uaid}
      heroImageSrc={heroImageSrc}
      heroImageFallbackSrc={shadowAgentSrc}
      displayDid={uaid}
      chainId={chainId}
      ownerDisplay={ownerDisplay}
      onChainMetadata={allMetadata}
    />
  );
}

function normalizeResourceUrl(src?: string | null): string | null {
  if (!src) {
    return null;
  }
  let value = src.trim();
  if (!value) {
    return null;
  }
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

