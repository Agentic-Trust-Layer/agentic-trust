import { notFound } from 'next/navigation';
import { buildDid8004, parseDid8004 } from '@agentic-trust/core';
import {
  getAgenticTrustClient,
} from '@agentic-trust/core/server';
import type { AgentsPageAgent } from '@/components/AgentsPage';
import ShadowAgentImage from '../../../../../../docs/8004ShadowAgent.png';
import AgentDetailsPageContent from '@/components/AgentDetailsPageContent';
import type { AgentDetailsValidationsSummary } from '@/components/AgentDetailsTabs';

type DetailsPageParams = {
  params: Promise<{
    did8004: string[];
  }>;
};

export default async function AgentDetailsPage({ params }: DetailsPageParams) {
  const { did8004: did8004Array } = await params;
  
  let decodedDid = '';

  // Handle legacy path format: /agents/[chainId]/[agentId]
  // If we have exactly 2 segments and the first one looks like a chain ID (numeric), construct a DID from it.
  if (Array.isArray(did8004Array) && did8004Array.length === 2 && /^\d+$/.test(did8004Array[0])) {
    const [chainId, agentId] = did8004Array;
    try {
      decodedDid = buildDid8004(Number(chainId), agentId);
    } catch {
      // Fallback to standard processing if build fails
      decodedDid = did8004Array.join('/');
    }
  } else {
    // Standard processing for DID paths (which might be split by slashes if encoded)
    decodedDid = Array.isArray(did8004Array) ? did8004Array.join('/') : did8004Array;
  }
  
  let parsed;
  try {
    // Keep decoding until no more % encoded characters remain
    let previousDecoded = '';
    let decodeCount = 0;
    while (decodedDid !== previousDecoded && decodedDid.includes('%') && decodeCount < 5) {
      previousDecoded = decodedDid;
      try {
        decodedDid = decodeURIComponent(decodedDid);
        decodeCount++;
      } catch {
        // If decoding fails, break the loop
        break;
      }
    }
    
    parsed = parseDid8004(decodedDid);
  } catch (error) {
    console.error('[AgentDetailsPage] Failed to parse DID:', {
      original: did8004Array,
      decoded: decodedDid,
      error: error instanceof Error ? error.message : String(error),
    });
    notFound();
  }

  if (!parsed || !parsed.chainId || !parsed.agentId) {
    notFound();
  }

  const chainId = parsed.chainId;
  const agentIdParam = parsed.agentId.toString();

  const client = await getAgenticTrustClient();
  
  // Get the agent from discovery query to include counts (validation, feedback, associations)
  // Fallback to regular getAgent if discovery fails
  let agent: any = null;
  try {
    agent = await client.agents.getAgentFromDiscovery(chainId, agentIdParam);
  } catch (error) {
    console.warn('[AgentDetailsPage] Failed to get agent from discovery, falling back to regular getAgent:', error);
  }
  
  // Fallback to regular getAgent if discovery didn't return data
  if (!agent) {
    const regularAgent = await client.agents.getAgent(agentIdParam, chainId);
    if (!regularAgent) {
      notFound();
    }
    // Convert Agent instance to plain object for compatibility
    agent = {
      ...(regularAgent as any).data,
      agentId: regularAgent.agentId,
      agentName: regularAgent.agentName,
      // `Agent` type may not expose chainId; use the route param instead.
      chainId,
    };
  }

  const numericAgentId = agent.agentId?.toString?.() ?? agentIdParam;

  // Access image from agent data - try multiple paths
  const agentImage = (agent as any).image ?? 
                     ((agent as any).data?.image) ?? 
                     null;
  const agentUriFromAgent =
    (agent as any).agentUri ??
    ((agent as any).data?.agentUri) ??
    null;

  /**
   * Avoid blocking SSR on external IPFS gateways.
   *
   * `client.getAgentDetails()` already attempts to load registration JSON (via `ipfsStorage.getJson` with timeouts).
   * Re-fetching the registration URI here via a generic `fetch()` can hang and keep the Agents list stuck on
   * "Loading agent details..." during navigation.
   */
  const safeParseJson = (raw: unknown): any | null => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const registrationFromAgent = safeParseJson((agent as any).rawJson ?? (agent as any)?.data?.rawJson);

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

                        
  // Use discovery agent record for initial render (fast path)
  const serializedAgent: AgentsPageAgent = {
    agentId: agent.agentId?.toString?.() ?? agentIdParam,
    chainId,
    agentName: agent.agentName ?? null,
    agentAccount: (agent as any).agentAccount ?? 
                  (agent as any).account ?? 
                  (agent as any).owner ?? 
                  (agent as any).data?.agentAccount ?? 
                  (agent as any).data?.account ?? 
                  (agent as any).data?.owner ??
                  null,
    agentIdentityOwnerAccount: (agent as any).agentIdentityOwnerAccount ?? (agent as any)?.data?.agentIdentityOwnerAccount ?? null,
    eoaAgentIdentityOwnerAccount: (agent as any).eoaAgentIdentityOwnerAccount ?? (agent as any)?.data?.eoaAgentIdentityOwnerAccount ?? null,
    eoaAgentAccount: (agent as any).eoaAgentAccount ?? (agent as any)?.data?.eoaAgentAccount ?? null,
    agentUri: agentUriFromAgent ?? null,
    description: (agent as any).description ?? null,
    image: agentImage ?? null,
    contractAddress: (agent as any).contractAddress ?? null,
    a2aEndpoint: (agent as any).a2aEndpoint ?? null,
    mcpEndpoint: mcpEndpoint,
    did: (agent as any).did ?? null,
    createdAtTime: (agent as any).createdAtTime ?? null,
    feedbackCount: (agent as any).feedbackCount ?? null,
    feedbackAverageScore: (agent as any).feedbackAverageScore ?? null,
    validationPendingCount: (agent as any).validationPendingCount ?? null,
    validationCompletedCount: (agent as any).validationCompletedCount ?? null,
    validationRequestedCount: (agent as any).validationRequestedCount ?? null,
    initiatedAssociationCount:
      (agent as any).initiatedAssociationCount ??
      null,
    approvedAssociationCount:
      (agent as any).approvedAssociationCount ??
      null,

    atiOverallScore:
      (agent as any).atiOverallScore ??
      null,
    atiOverallConfidence:
      (agent as any).atiOverallConfidence ??
      null,
    atiVersion:
      (agent as any).atiVersion ??
      null,
    atiComputedAt:
      (agent as any).atiComputedAt ??
      null,
    atiBundleJson:
      (agent as any).atiBundleJson ??
      null,

    trustLedgerScore:
      (agent as any).trustLedgerScore ??
      null,
    trustLedgerBadgeCount:
      (agent as any).trustLedgerBadgeCount ??
      null,
    trustLedgerOverallRank:
      (agent as any).trustLedgerOverallRank ??
      null,
    trustLedgerCapabilityRank:
      (agent as any).trustLedgerCapabilityRank ??
      null,
  };

  const did8004 = buildDid8004(chainId, Number(numericAgentId));
  const shadowAgentSrc =
    (ShadowAgentImage as unknown as { src?: string }).src ?? '/8004ShadowAgent.png';

  // Best-effort hero image: use already-known fields; avoid fetching tokenUri here.
  const registrationImage =
    typeof registrationFromAgent?.image === 'string' ? registrationFromAgent.image : null;
  const heroImageSrc =
    normalizeResourceUrl(serializedAgent.image ?? registrationImage) ?? shadowAgentSrc;
  const ownerDisplaySource =
    serializedAgent.eoaAgentIdentityOwnerAccount ??
    serializedAgent.agentIdentityOwnerAccount ??
    serializedAgent.agentAccount ??
    null;
  const ownerDisplay =
    ownerDisplaySource && ownerDisplaySource.length > 10
      ? `${ownerDisplaySource.slice(0, 6)}…${ownerDisplaySource.slice(-4)}`
      : ownerDisplaySource || '—';
  const displayDid = decodeDid(serializedAgent.did) ?? did8004;

  return (
    <AgentDetailsPageContent
      agent={serializedAgent}
      did8004={did8004}
      heroImageSrc={heroImageSrc}
      heroImageFallbackSrc={shadowAgentSrc}
      displayDid={displayDid}
      chainId={chainId}
      ownerDisplay={ownerDisplay}
      onChainMetadata={allMetadata}
    />
  );
}

function extractImageFromMetadata(metadata: Record<string, unknown>): string | null {
  const candidates: Array<unknown> = [
    metadata.image,
    (metadata as any).image_url,
    (metadata as any).imageUrl,
    (metadata as any).imageURI,
    (metadata as any).image_uri,
    (metadata as any).properties?.image,
    (metadata as any).properties?.image_url,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
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
    // Prefer a more reliable gateway than ipfs.io for UI rendering.
    return `https://w3s.link/ipfs/${path}`;
  }
  if (value.startsWith('ar://')) {
    return `https://arweave.net/${value.slice('ar://'.length)}`;
  }
  return value;
}

function decodeDid(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

