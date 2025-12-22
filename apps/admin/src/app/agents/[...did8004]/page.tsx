import { notFound } from 'next/navigation';
import { buildDid8004, parseDid8004 } from '@agentic-trust/core';
import {
  getAgenticTrustClient,
  getAgentValidationsSummary,
  getRegistration,
  getAssociationsClient,
  type AgentValidationsSummary,
} from '@agentic-trust/core/server';
import { getIdentityRegistryClient } from '@agentic-trust/core/server/singletons/identityClient';
import type { AgentsPageAgent } from '@/components/AgentsPage';
import ShadowAgentImage from '../../../../../../docs/8004ShadowAgent.png';
import AgentDetailsPageContent from '@/components/AgentDetailsPageContent';
import type {
  AgentDetailsValidationsSummary,
  AgentDetailsFeedbackSummary,
  ValidationEntry,
} from '@/components/AgentDetailsTabs';

type DetailsPageParams = {
  params: Promise<{
    did8004: string[];
  }>;
};

// Normalize requestHash for comparison between contract (bytes32) and GraphQL (string)
// Handles different formats: string, bigint, number, and ensures consistent 0x-prefixed lowercase hex
function normalizeRequestHash(hash: unknown): string | null {
  if (!hash) return null;
  let hashStr: string;
  if (typeof hash === 'string') {
    hashStr = hash;
  } else if (typeof hash === 'bigint' || typeof hash === 'number') {
    hashStr = hash.toString(16);
    if (!hashStr.startsWith('0x')) {
      hashStr = '0x' + hashStr.padStart(64, '0');
    }
  } else {
    hashStr = String(hash);
  }
  // Ensure 0x prefix and normalize to lowercase
  if (!hashStr.startsWith('0x')) {
    hashStr = '0x' + hashStr;
  }
  return hashStr.toLowerCase();
}

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
  
  // Use getAgentDetails to get full detail including metadata from GraphQL
  const agentDetail = await client.getAgentDetails(agentIdParam, chainId);
  if (!agentDetail) {
    notFound();
  }
  
  // Get the agent object for compatibility
  const agent = await client.agents.getAgent(agentIdParam, chainId);
  if (!agent) {
    notFound();
  }

  const numericAgentId = agent.agentId?.toString?.() ?? agentIdParam;
  let ownerAddress: string | null = null;
  try {
    ownerAddress = await client.getAgentOwner(numericAgentId, chainId);
  } catch (error) {
    console.warn('[AgentDetailsPage] Failed to resolve owner address:', error);
  }

  const [feedbackItems, feedbackSummary, validations, validationResponses] = await Promise.all([
    client
      .getAgentFeedback({
        agentId: numericAgentId,
        chainId,
        includeRevoked: true,
        limit: 200,
      })
      .catch(() => []),
    client
      .getReputationSummary({
        agentId: numericAgentId,
        chainId,
      })
      .catch(() => null),
    getAgentValidationsSummary(chainId, numericAgentId).catch(
      () => null as AgentValidationsSummary | null,
    ),
    client
      .searchValidationRequestsAdvanced({
        chainId,
        agentId: numericAgentId,
        limit: 100,
        offset: 0,
        orderBy: 'timestamp',
        orderDirection: 'DESC',
      })
      .catch(() => null),
  ]);

  // Access image from agent data - try multiple paths
  const agentImage = (agent as any).image ?? 
                     ((agent as any).data?.image) ?? 
                     null;
  const agentTokenUri = (agent as any).tokenUri ?? 
                        ((agent as any).data?.tokenUri) ?? 
                        null;

  // Extract MCP endpoint from registration
  let mcpEndpoint: string | null = null;
  if (agentTokenUri) {
    try {
      const registration = await getRegistration(agentTokenUri);
      if (registration?.endpoints && Array.isArray(registration.endpoints)) {
        const mcpEndpointEntry = registration.endpoints.find(
          (ep: any) => ep && typeof ep.name === 'string' && (ep.name === 'MCP' || ep.name === 'mcp')
        );
        if (mcpEndpointEntry && typeof mcpEndpointEntry.endpoint === 'string') {
          mcpEndpoint = mcpEndpointEntry.endpoint;
        }
      }
    } catch (error) {
      // Silently fail - registration might not be available
      console.warn('[AgentDetailsPage] Failed to load registration for MCP endpoint:', error);
    }
  }

  // Get metadata from agentDetail (already fetched from GraphQL via loadAgentDetail)
  // This avoids on-chain RPC calls and uses the GraphQL indexer data
  const allMetadata: Record<string, string> = agentDetail.identityMetadata?.metadata || {};
  
  console.log('[AgentDetailsPage] Metadata from agentDetail:', Object.keys(allMetadata).length, 'keys', allMetadata);

                        
  // Use agentDetail for more complete data, especially createdAtTime
  const serializedAgent: AgentsPageAgent = {
    agentId: agent.agentId?.toString?.() ?? agentIdParam,
    chainId,
    agentName: agent.agentName ?? agentDetail.agentName ?? null,
    agentAccount: (agent as any).agentAccount ?? 
                  (agent as any).account ?? 
                  (agent as any).owner ?? 
                  (agent as any).data?.agentAccount ?? 
                  (agent as any).data?.account ?? 
                  (agent as any).data?.owner ??
                  agentDetail.agentAccount ??
                  null,
    ownerAddress: ownerAddress ??
                  (agent as any).ownerAddress ??
                  (agent as any).data?.ownerAddress ??
                  agentDetail.agentOwner ??
                  null,
    tokenUri: agentTokenUri ?? agentDetail.tokenUri ?? null,
    description: (agent as any).description ?? agentDetail.description ?? null,
    image: agentImage ?? agentDetail.image ?? null,
    contractAddress: (agent as any).contractAddress ?? agentDetail.contractAddress ?? null,
    a2aEndpoint: (agent as any).a2aEndpoint ?? agentDetail.a2aEndpoint ?? null,
    agentAccountEndpoint: (agent as any).agentAccountEndpoint ?? agentDetail.agentAccountEndpoint ?? null,
    mcpEndpoint: mcpEndpoint,
    did: (agent as any).did ?? agentDetail.did ?? null,
    createdAtTime: agentDetail.createdAtTime ?? (agent as any).createdAtTime ?? null,
    feedbackCount: (agent as any).feedbackCount ?? null,
    feedbackAverageScore: (agent as any).feedbackAverageScore ?? null,
    validationPendingCount: (agent as any).validationPendingCount ?? null,
    validationCompletedCount: (agent as any).validationCompletedCount ?? null,
    validationRequestedCount: (agent as any).validationRequestedCount ?? null,
    initiatedAssociationCount:
      (agent as any).initiatedAssociationCount ??
      (agentDetail as any).initiatedAssociationCount ??
      null,
    approvedAssociationCount:
      (agent as any).approvedAssociationCount ??
      (agentDetail as any).approvedAssociationCount ??
      null,

    atiOverallScore:
      (agent as any).atiOverallScore ??
      (agentDetail as any).atiOverallScore ??
      null,
    atiOverallConfidence:
      (agent as any).atiOverallConfidence ??
      (agentDetail as any).atiOverallConfidence ??
      null,
    atiVersion:
      (agent as any).atiVersion ??
      (agentDetail as any).atiVersion ??
      null,
    atiComputedAt:
      (agent as any).atiComputedAt ??
      (agentDetail as any).atiComputedAt ??
      null,
    atiBundleJson:
      (agent as any).atiBundleJson ??
      (agentDetail as any).atiBundleJson ??
      null,

    trustLedgerScore:
      (agent as any).trustLedgerScore ??
      (agentDetail as any).trustLedgerScore ??
      null,
    trustLedgerBadgeCount:
      (agent as any).trustLedgerBadgeCount ??
      (agentDetail as any).trustLedgerBadgeCount ??
      null,
    trustLedgerOverallRank:
      (agent as any).trustLedgerOverallRank ??
      (agentDetail as any).trustLedgerOverallRank ??
      null,
    trustLedgerCapabilityRank:
      (agent as any).trustLedgerCapabilityRank ??
      (agentDetail as any).trustLedgerCapabilityRank ??
      null,
  };

  // Fallback: if GraphQL counts are missing/zero, derive initiated/approved counts from on-chain associations
  // so the header stats match the Associations tab.
  try {
    const hasGraphCounts =
      typeof serializedAgent.initiatedAssociationCount === 'number' ||
      typeof serializedAgent.approvedAssociationCount === 'number';
    const maybeBothZero =
      (serializedAgent.initiatedAssociationCount ?? 0) === 0 &&
      (serializedAgent.approvedAssociationCount ?? 0) === 0;
    const canCompute = typeof serializedAgent.agentAccount === 'string' && serializedAgent.agentAccount.startsWith('0x');

    if ((!hasGraphCounts || maybeBothZero) && canCompute) {
      const associationsClient = await getAssociationsClient(chainId);
      const assocResp = await associationsClient.getAssociationsForEvmAccount({
        chainId,
        accountAddress: serializedAgent.agentAccount,
      });
      const centerLower = serializedAgent.agentAccount.toLowerCase();
      const list = Array.isArray((assocResp as any)?.associations) ? ((assocResp as any).associations as any[]) : [];
      let initiated = 0;
      let approved = 0;
      for (const a of list) {
        const initiator = typeof a?.initiator === 'string' ? a.initiator.toLowerCase() : '';
        const approver = typeof a?.approver === 'string' ? a.approver.toLowerCase() : '';
        if (initiator && initiator === centerLower) initiated += 1;
        if (approver && approver === centerLower) approved += 1;
      }
      serializedAgent.initiatedAssociationCount = initiated;
      serializedAgent.approvedAssociationCount = approved;
    }
  } catch (e) {
    console.warn('[AgentDetailsPage] Failed to derive association counts; leaving GraphQL values:', e);
  }

  const serializedFeedback = JSON.parse(
    JSON.stringify(Array.isArray(feedbackItems) ? feedbackItems : []),
  ) as unknown[];
  const serializedSummary: AgentDetailsFeedbackSummary = feedbackSummary
    ? {
        count:
          typeof feedbackSummary.count === 'bigint'
            ? feedbackSummary.count.toString()
            : feedbackSummary.count ?? '0',
        averageScore: feedbackSummary.averageScore ?? null,
      }
    : null;
  const graphQLRequests = validationResponses?.validationRequests || [];

  const graphQLByRequestHash = new Map<string, typeof graphQLRequests[0]>();
  const graphQLValidationByTxHash = new Map<string, typeof graphQLRequests[0]>();
  for (const request of graphQLRequests) {
    const normalizedRequestHash = normalizeRequestHash(request.requestHash);
    if (normalizedRequestHash) {
      graphQLByRequestHash.set(normalizedRequestHash, request);
    }
    if (request.txHash && typeof request.txHash === 'string') {
      graphQLValidationByTxHash.set(request.txHash.toLowerCase(), request);
    }
  }

  const serializedValidations: AgentDetailsValidationsSummary | null = validations
    ? {
        pending: validations.pending.map((entry) => serializeValidationEntry(entry, graphQLByRequestHash, graphQLValidationByTxHash)),
        completed: validations.completed.map((entry) => serializeValidationEntry(entry, graphQLByRequestHash, graphQLValidationByTxHash)),
      }
    : null;
  const did8004 = buildDid8004(chainId, Number(numericAgentId));
  const shadowAgentSrc =
    (ShadowAgentImage as unknown as { src?: string }).src ?? '/8004ShadowAgent.png';
  const heroImageSrc = (await getAgentHeroImage(serializedAgent)) ?? shadowAgentSrc;
  const ownerDisplaySource =
    serializedAgent.ownerAddress ??
    serializedAgent.agentAccount ??
    null;
  const ownerDisplay =
    ownerDisplaySource && ownerDisplaySource.length > 10
      ? `${ownerDisplaySource.slice(0, 6)}…${ownerDisplaySource.slice(-4)}`
      : ownerDisplaySource || '—';
  
  // Use actual fetched validation data instead of agent object fields
  const validationCompletedCount = serializedValidations?.completed?.length ?? 0;
  const validationPendingCount = serializedValidations?.pending?.length ?? 0;
  const validationSummaryText = `${validationCompletedCount} completed · ${validationPendingCount} pending`;
  
  // Use actual fetched feedback summary instead of agent object fields
  const feedbackCount = feedbackSummary 
    ? (typeof feedbackSummary.count === 'bigint' 
        ? Number(feedbackSummary.count) 
        : typeof feedbackSummary.count === 'string'
          ? Number.parseInt(feedbackSummary.count, 10)
          : feedbackSummary.count ?? 0)
    : Array.isArray(feedbackItems) ? feedbackItems.length : 0;
  const feedbackAvg = feedbackSummary?.averageScore ?? null;
  const reviewsSummaryText =
    feedbackCount > 0
      ? `${feedbackCount} reviews · ${feedbackAvg ?? 0} avg`
      : 'No reviews yet';
  const displayDid = decodeDid(serializedAgent.did) ?? did8004;

  return (
    <AgentDetailsPageContent
      agent={serializedAgent}
      feedbackItems={serializedFeedback}
      feedbackSummary={serializedSummary}
      validations={serializedValidations}
      heroImageSrc={heroImageSrc}
      heroImageFallbackSrc={shadowAgentSrc}
      displayDid={displayDid}
      chainId={chainId}
      ownerDisplay={ownerDisplay}
      validationSummaryText={validationSummaryText}
      reviewsSummaryText={reviewsSummaryText}
      onChainMetadata={allMetadata}
    />
  );
}

async function getAgentHeroImage(agent: AgentsPageAgent): Promise<string | null> {
  // First, try direct image field (same as AgentsPage does)
  if (typeof agent.image === 'string' && agent.image.trim()) {
    const normalized = normalizeResourceUrl(agent.image.trim());
    if (normalized) {
      return normalized;
    }
  }
  
  // Fallback: try to fetch from tokenUri metadata
  const tokenUri = normalizeResourceUrl(agent.tokenUri);
  if (!tokenUri) {
    return null;
  }
  try {
    const response = await fetch(tokenUri, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const metadata = await response.json().catch(() => null);
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }
    const fromMetadata = extractImageFromMetadata(metadata);
    return normalizeResourceUrl(fromMetadata);
  } catch (error) {
    console.warn('[Agent Details] Failed to load tokenUri metadata for image', error);
    return null;
  }
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
    return `https://ipfs.io/ipfs/${path}`;
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

function serializeValidationEntry(
  entry: AgentValidationsSummary['pending'][number],
  graphQLByRequestHash?: Map<string, Record<string, unknown>>,
  graphQLByTxHash?: Map<string, Record<string, unknown>>,
) {
  const agentIdValue = entry.agentId as unknown;
  let agentId: string | null = null;
  if (typeof agentIdValue === 'bigint') {
    agentId = agentIdValue.toString();
  } else if (typeof agentIdValue === 'string') {
    agentId = agentIdValue;
  } else if (typeof agentIdValue === 'number') {
    agentId = agentIdValue.toString();
  } else if (
    agentIdValue &&
    typeof agentIdValue === 'object' &&
    'toString' in agentIdValue &&
    typeof (agentIdValue as { toString(): unknown }).toString === 'function'
  ) {
    agentId = (agentIdValue as { toString(): string }).toString();
  }

  const responseValue =
    typeof entry.response === 'number'
      ? entry.response
      : Number(entry.response ?? 0);

  let graphQLData: Record<string, unknown> | undefined;
  
  if (entry.requestHash && graphQLByRequestHash) {
    const contractRequestHash = entry.requestHash;
    const normalizedRequestHash = normalizeRequestHash(contractRequestHash);

    if (normalizedRequestHash) {
      graphQLData = graphQLByRequestHash.get(normalizedRequestHash);
    }
  }

  const baseEntry: ValidationEntry = {
    agentId,
    requestHash: entry.requestHash ?? null,
    validatorAddress: entry.validatorAddress ?? null,
    response: Number.isFinite(responseValue) ? responseValue : 0,
    responseHash: entry.responseHash ?? null,
    tag: entry.tag ?? null,
    lastUpdate: normalizeTimestamp(entry.lastUpdate as unknown as number | bigint | string | null),
  };

  if (graphQLData) {
    return {
      ...baseEntry,
      txHash: typeof graphQLData.txHash === 'string' ? graphQLData.txHash : null,
      blockNumber: typeof graphQLData.blockNumber === 'number' ? graphQLData.blockNumber : null,
      timestamp: normalizeTimestamp(graphQLData.timestamp as unknown as number | bigint | string | null),
      requestUri: typeof graphQLData.requestUri === 'string' ? graphQLData.requestUri : null,
      requestJson: typeof graphQLData.requestJson === 'string' ? graphQLData.requestJson : null,
      responseUri: typeof graphQLData.responseUri === 'string' ? graphQLData.responseUri : null,
      responseJson: typeof graphQLData.responseJson === 'string' ? graphQLData.responseJson : null,
      createdAt: typeof graphQLData.createdAt === 'string' ? graphQLData.createdAt : null,
      updatedAt: typeof graphQLData.updatedAt === 'string' ? graphQLData.updatedAt : null,
    };
  }

  return baseEntry;
}

function normalizeTimestamp(
  value: number | bigint | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

