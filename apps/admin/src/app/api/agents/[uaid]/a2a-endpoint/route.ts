export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, fetchA2AAgentCard } from '@agentic-trust/core/server';
import { resolveDid8004FromUaid } from '../../_lib/uaid';

function ipfsToHttp(ipfsUri: string): string {
  if (ipfsUri.startsWith('ipfs://')) {
    const cid = ipfsUri.replace('ipfs://', '');
    return `https://ipfs.io/ipfs/${cid}`;
  }
  return ipfsUri;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  try {
    const { chainId, agentId } = resolveDid8004FromUaid(params.uaid);

    const client = await getAgenticTrustClient();
    const agent = await client.agents.getAgent(String(agentId), chainId);

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const agentUri = (agent.data as any)?.agentUri;
    if (!agentUri) {
      return NextResponse.json({ error: 'agentUri not found for agent' }, { status: 404 });
    }

    const ipfsUrl = ipfsToHttp(agentUri);
    const ipfsResponse = await fetch(ipfsUrl);
    if (!ipfsResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch IPFS data: ${ipfsResponse.statusText}` },
        { status: 500 },
      );
    }
    const ipfsData = await ipfsResponse.json();

    let a2aEndpoint: string | null = null;
    if (ipfsData.endpoints && Array.isArray(ipfsData.endpoints)) {
      const a2aEndpointEntry = ipfsData.endpoints.find((ep: any) => ep.name === 'A2A' || ep.name === 'a2a');
      if (a2aEndpointEntry?.endpoint) {
        a2aEndpoint = a2aEndpointEntry.endpoint;
      }
    }

    let validationResult:
      | {
          verified: boolean;
          hasSkill: boolean;
          skillName?: string;
          error?: string;
        }
      | null = null;

    if (a2aEndpoint) {
      try {
        const agentCard = await fetchA2AAgentCard(a2aEndpoint);
        if (agentCard) {
          const hasValidationSkill =
            agentCard.skills?.some((skill: any) => skill.id === 'governance_and_trust/trust/trust_validate_name') ||
            false;
          validationResult = {
            verified: true,
            hasSkill: hasValidationSkill,
            skillName: hasValidationSkill ? 'governance_and_trust/trust/trust_validate_name' : undefined,
          };
        } else {
          validationResult = { verified: false, hasSkill: false, error: 'Failed to fetch agent card' };
        }
      } catch (error) {
        validationResult = {
          verified: false,
          hasSkill: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    return NextResponse.json({
      success: true,
      agentUri,
      ipfsData,
      a2aEndpoint,
      validation: validationResult,
    });
  } catch (error) {
    console.error('[API] Error fetching A2A endpoint:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch A2A endpoint',
      },
      { status: 500 },
    );
  }
}

