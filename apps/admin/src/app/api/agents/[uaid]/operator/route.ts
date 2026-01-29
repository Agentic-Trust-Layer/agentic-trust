export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';
import { resolveDid8004FromUaid } from '../../_lib/uaid';

export async function GET(
  _request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  try {
    const { did8004 } = resolveDid8004FromUaid(params.uaid);
    const { chainId, agentId } = parseDid8004(did8004);

    const client = await getAgenticTrustClient();

    const agent = await client.getAgent(agentId.toString(), chainId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const operatorAddress = await agent.getNFTOperator(chainId);
    return NextResponse.json({
      success: true,
      operatorAddress,
      hasOperator: operatorAddress !== null,
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

