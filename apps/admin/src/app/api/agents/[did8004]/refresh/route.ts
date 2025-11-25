export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { did8004: string } },
) {
  try {
    const didAgent = decodeURIComponent(params.did8004);

    const client = await getAgenticTrustClient();
    // refreshAgentByDid exists on AgentsAPI at runtime but may not yet be in typings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client.agents as any).refreshAgentByDid(didAgent);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in refresh agent route:', error);
    return NextResponse.json(
      {
        error: 'Failed to refresh agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}


