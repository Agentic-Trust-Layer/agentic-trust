export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { resolveDid8004FromUaid } from '../../_lib/uaid';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  try {
    const { did8004 } = resolveDid8004FromUaid(params.uaid);
    const client = await getAgenticTrustClient();
    // deleteAgentByDid exists on AgentsAPI at runtime but may not yet be in typings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client.agents as any).deleteAgentByDid(did8004);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in delete agent route:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

