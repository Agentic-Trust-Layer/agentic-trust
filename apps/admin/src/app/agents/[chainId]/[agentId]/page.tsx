import { notFound } from 'next/navigation';
import { buildDid8004 } from '@agentic-trust/core';
import {
  getAgenticTrustClient,
  getAgentValidationsSummary,
  type AgentValidationsSummary,
} from '@agentic-trust/core/server';
import type { AgentsPageAgent } from '@/components/AgentsPage';
import ShadowAgentImage from '../../../../../../../docs/8004ShadowAgent.png';
import AgentDetailsPageContent from '@/components/AgentDetailsPageContent';
import type {
  AgentDetailsValidationsSummary,
  AgentDetailsFeedbackSummary,
} from '@/components/AgentDetailsTabs';

type DetailsPageParams = {
  params: {
    chainId: string;
    agentId: string;
  };
};

export default async function AgentDetailsPage({ params }: DetailsPageParams) {
  const chainId = Number(params.chainId);
  const agentIdParam = params.agentId;
  if (!Number.isFinite(chainId) || !agentIdParam) {
    notFound();
  }

  const client = await getAgenticTrustClient();
  const agent = await client.agents.getAgent(agentIdParam.toString(), chainId);
  if (!agent) {
    notFound();
  }

  const numericAgentId = agent.agentId?.toString?.() ?? agentIdParam.toString();

  const [feedbackItems, feedbackSummary, validations] = await Promise.all([
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
  ]);

  const serializedAgent: AgentsPageAgent = {
    agentId: agent.agentId?.toString?.() ?? agentIdParam.toString(),
    chainId,
    agentName: agent.agentName ?? null,
    agentAccount: (agent as any).agentAccount ?? null,
    tokenUri: (agent as any).tokenUri ?? null,
    description: (agent as any).description ?? null,
    image: (agent as any).image ?? null,
    contractAddress: (agent as any).contractAddress ?? null,
    a2aEndpoint: (agent as any).a2aEndpoint ?? null,
    agentAccountEndpoint: (agent as any).agentAccountEndpoint ?? null,
    mcp: (agent as any).mcp ?? null,
    did: (agent as any).did ?? null,
    createdAtTime: (agent as any).createdAtTime ?? null,
    feedbackCount: (agent as any).feedbackCount ?? null,
    feedbackAverageScore: (agent as any).feedbackAverageScore ?? null,
    validationPendingCount: (agent as any).validationPendingCount ?? null,
    validationCompletedCount: (agent as any).validationCompletedCount ?? null,
    validationRequestedCount: (agent as any).validationRequestedCount ?? null,
  };

  const serializedFeedback = JSON.parse(
    JSON.stringify(feedbackItems ?? []),
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
  const serializedValidations: AgentDetailsValidationsSummary | null = validations
    ? {
        pending: validations.pending.map(serializeValidationEntry),
        completed: validations.completed.map(serializeValidationEntry),
      }
    : null;
  const did8004 = buildDid8004(chainId, Number(numericAgentId));
  const shadowAgentSrc =
    (ShadowAgentImage as unknown as { src?: string }).src ?? '/8004ShadowAgent.png';
  const heroImageSrc = (await getAgentHeroImage(serializedAgent)) ?? shadowAgentSrc;
  const ownerDisplay =
    serializedAgent.agentAccount && serializedAgent.agentAccount.length > 10
      ? `${serializedAgent.agentAccount.slice(0, 6)}…${serializedAgent.agentAccount.slice(-4)}`
      : serializedAgent.agentAccount || '—';
  const validationSummaryText = `${serializedAgent.validationCompletedCount ?? 0} completed · ${
    serializedAgent.validationPendingCount ?? 0
  } pending`;
  const reviewsSummaryText =
    serializedAgent.feedbackCount && serializedAgent.feedbackCount > 0
      ? `${serializedAgent.feedbackCount} reviews · ${
          serializedAgent.feedbackAverageScore ?? 0
        } avg`
      : 'No reviews yet';
  const displayDid = serializedAgent.did ?? did8004;

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
    />
  );
}

async function getAgentHeroImage(agent: AgentsPageAgent): Promise<string | null> {
  const direct = resolveAgentImage(agent.image);
  if (direct) {
    return direct;
  }
  const tokenUri = resolveAgentImage(agent.tokenUri);
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
    const fromMetadata =
      typeof metadata.image === 'string'
        ? metadata.image
        : typeof metadata.image_url === 'string'
          ? metadata.image_url
          : null;
    return resolveAgentImage(fromMetadata);
  } catch (error) {
    console.warn('[Agent Details] Failed to load tokenUri metadata for image', error);
    return null;
  }
}

function resolveAgentImage(src?: string | null): string | null {
  if (!src) {
    return null;
  }
  if (src.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${src.slice('ipfs://'.length)}`;
  }
  return src;
}

function serializeValidationEntry(entry: AgentValidationsSummary['pending'][number]) {
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
  return {
    agentId,
    requestHash: entry.requestHash ?? null,
    validatorAddress: entry.validatorAddress ?? null,
    response: Number.isFinite(responseValue) ? responseValue : 0,
    responseHash: entry.responseHash ?? null,
    tag: entry.tag ?? null,
    lastUpdate: normalizeTimestamp(entry.lastUpdate as unknown as number | bigint | string | null),
  };
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

