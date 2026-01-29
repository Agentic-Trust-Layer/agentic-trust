export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  try {
    const uaid = decodeURIComponent(params.uaid);
    if (uaid.startsWith('did:8004:')) {
      return NextResponse.json({ error: 'Only UAID is supported' }, { status: 400 });
    }

    const client = await getAgenticTrustClient();

    // UAID is the canonical identifier; resolve to did:8004 when possible.
    const detail = await (client as any).getAgentDetailsByUaidUniversal?.(uaid, {
      includeRegistration: false,
    });
    const candidate = typeof detail?.didIdentity === 'string' ? detail.didIdentity : null;
    const did8004Resolved = candidate && candidate.startsWith('did:8004:') ? candidate : null;

    if (!did8004Resolved) {
      return NextResponse.json({
        success: true,
        operatorAddress: null,
        hasOperator: false,
      });
    }

    const match = did8004Resolved.match(/^did:8004:(\d+):(\d+)$/);
    if (!match) {
      return NextResponse.json({ error: 'Invalid did:8004 format' }, { status: 400 });
    }

    const chainId = Number.parseInt(match[1], 10);
    const agentId = Number.parseInt(match[2], 10);

    if (!Number.isFinite(chainId) || !Number.isFinite(agentId)) {
      return NextResponse.json({ error: 'Invalid chainId or agentId' }, { status: 400 });
    }

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

