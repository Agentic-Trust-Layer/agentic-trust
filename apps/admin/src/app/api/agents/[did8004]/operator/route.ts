export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ did8004: string }> }
) {
  try {
    const { did8004 } = await params;
    const decoded = decodeURIComponent(did8004);

    // UAID is the canonical identifier; resolve to did:8004 when possible.
    const client = await getAgenticTrustClient();
    let did8004Resolved: string | null =
      decoded.startsWith('did:8004:') ? decoded : null;

    if (!did8004Resolved) {
      const detail = await (client as any).getAgentDetailsByUaidUniversal?.(decoded, {
        includeRegistration: false,
      });
      const candidate = typeof detail?.didIdentity === 'string' ? detail.didIdentity : null;
      if (candidate && candidate.startsWith('did:8004:')) {
        did8004Resolved = candidate;
      }
    }

    if (!did8004Resolved) {
      // Non-chain agents: no NFT operator.
      return NextResponse.json({
        success: true,
        operatorAddress: null,
        hasOperator: false,
      });
    }

    const match = did8004Resolved.match(/^did:8004:(\d+):(\d+)$/);
    if (!match) {
      return NextResponse.json({ error: 'Invalid DID format' }, { status: 400 });
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

