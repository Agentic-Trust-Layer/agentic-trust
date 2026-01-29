export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { resolveDid8004FromUaid } from '../../_lib/uaid';

export async function PUT(
  request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  try {
    const { did8004 } = resolveDid8004FromUaid(params.uaid);
    const body = await request.json();
    const client = await getAgenticTrustClient();

    const { tokenUri, metadata, chainId } = body as {
      tokenUri?: string;
      metadata?: Array<{ key: string; value: string }>;
      chainId?: number;
    };

    // updateAgentByDid exists on AgentsAPI at runtime but may not yet be in typings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client.agents as any).updateAgentByDid(did8004, {
      tokenUri,
      metadata,
      chainId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in update agent route:', error);
    return NextResponse.json(
      {
        error: 'Failed to update agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

