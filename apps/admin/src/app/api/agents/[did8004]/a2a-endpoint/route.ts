export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, fetchA2AAgentCard } from '@agentic-trust/core/server';

/**
 * Convert IPFS URI to HTTP URL
 */
function ipfsToHttp(ipfsUri: string): string {
  if (ipfsUri.startsWith('ipfs://')) {
    const cid = ipfsUri.replace('ipfs://', '');
    return `https://ipfs.io/ipfs/${cid}`;
  }
  return ipfsUri;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ did8004: string }> }
) {
  try {
    const { did8004 } = await params;
    const decodedDid = decodeURIComponent(did8004);
    
    // Extract chainId and agentId from did8004
    const match = decodedDid.match(/^did:8004:(\d+):(\d+)$/);
    if (!match) {
      return NextResponse.json(
        { error: 'Invalid DID format' },
        { status: 400 },
      );
    }

    const chainId = Number.parseInt(match[1], 10);
    const agentId = Number.parseInt(match[2], 10);

    if (!Number.isFinite(chainId) || !Number.isFinite(agentId)) {
      return NextResponse.json(
        { error: 'Invalid chainId or agentId' },
        { status: 400 },
      );
    }

    // Get agent data which includes tokenUri
    const client = await getAgenticTrustClient();
    const agent = await client.agents.getAgent(String(agentId), chainId);
    
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 },
      );
    }

    // Get tokenUri from agent data
    const tokenUri = (agent.data as any)?.tokenUri;
    
    if (!tokenUri) {
      return NextResponse.json(
        { error: 'Token URI not found for agent' },
        { status: 404 },
      );
    }

    // Fetch IPFS data
    const ipfsUrl = ipfsToHttp(tokenUri);
    const ipfsResponse = await fetch(ipfsUrl);
    if (!ipfsResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch IPFS data: ${ipfsResponse.statusText}` },
        { status: 500 },
      );
    }
    const ipfsData = await ipfsResponse.json();

    // Extract A2A endpoint from IPFS data
    // Only use explicitly-declared endpoints; do not synthesize/append paths.
    let a2aEndpoint: string | null = null;
    if (ipfsData.endpoints && Array.isArray(ipfsData.endpoints)) {
      const a2aEndpointEntry = ipfsData.endpoints.find(
        (ep: any) => ep.name === 'A2A' || ep.name === 'a2a'
      );
      if (a2aEndpointEntry?.endpoint) {
        a2aEndpoint = a2aEndpointEntry.endpoint;
        console.log('[API] Found A2A endpoint in endpoints array:', a2aEndpoint);
      }
    }
    // Note: We intentionally do NOT fall back to provider.url or try to "fix" agent.json URLs here.
    // Callers must publish explicit endpoints in the registration JSON.
    
    console.log('[API] Final A2A endpoint being returned:', a2aEndpoint);

    // Validate A2A endpoint by fetching the agent card (agent-card.json)
    let validationResult: {
      verified: boolean;
      hasSkill: boolean;
      skillName?: string;
      error?: string;
    } | null = null;

    if (a2aEndpoint) {
      try {
        // fetchA2AAgentCard automatically appends .well-known/agent-card.json if needed
        console.log('[API] Fetching agent card from A2A endpoint:', a2aEndpoint);
        const agentCard = await fetchA2AAgentCard(a2aEndpoint);
        
        if (agentCard) {
          // Check if agent card has the validation skill
          const hasValidationSkill = agentCard.skills?.some(
            (skill: any) => skill.id === 'oasf:trust.validation.attestation'
          ) || false;

          validationResult = {
            verified: true,
            hasSkill: hasValidationSkill,
            skillName: hasValidationSkill ? 'oasf:trust.validation.attestation' : undefined,
          };
        } else {
          validationResult = {
            verified: false,
            hasSkill: false,
            error: 'Failed to fetch agent card',
          };
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
      tokenUri,
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

