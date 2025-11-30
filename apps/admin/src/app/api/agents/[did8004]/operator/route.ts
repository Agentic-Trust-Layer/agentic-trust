export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

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

    // Get agent first, then call getNFTOperator on the agent instance
    const client = await getAgenticTrustClient();
    const agent = await client.getAgent(agentId.toString(), chainId);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 },
      );
    }

    // Call getNFTOperator on the agent instance
    const operatorAddress = await agent.getNFTOperator(chainId);

    // Check if operator is set
    const hasOperator = operatorAddress !== null;

    return NextResponse.json({
      success: true,
      operatorAddress,
      hasOperator,
    });
  } catch (error) {
    console.error('[API] Error fetching NFT operator:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch NFT operator',
      },
      { status: 500 },
    );
  }
}

