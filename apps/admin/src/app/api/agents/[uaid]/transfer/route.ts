export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';
import { resolveDid8004FromUaidOrDid } from '../../_lib/uaid';

export async function POST(
  request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  try {
    const { did8004 } = resolveDid8004FromUaidOrDid(params.uaid);
    const parsed = parseDid8004(did8004);
    const body = await request.json();

    const { to } = body as { to: string };

    const client = await getAgenticTrustClient();
    // transferAgent exists on AgentsAPI at runtime but may not yet be in typings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client.agents as any).transferAgent({
      agentId: parsed.agentId,
      chainId: parsed.chainId,
      to,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in transfer agent route:', error);
    return NextResponse.json(
      {
        error: 'Failed to transfer agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

