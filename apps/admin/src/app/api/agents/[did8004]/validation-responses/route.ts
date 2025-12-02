export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { parseDid8004 } from '@agentic-trust/core';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ did8004: string }> },
) {
  try {
    const { did8004 } = await params;
    const parsed = parseDid8004(did8004);
    
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit') ? Number.parseInt(searchParams.get('limit')!, 10) : 10;
    const offset = searchParams.get('offset') ? Number.parseInt(searchParams.get('offset')!, 10) : 0;
    const orderBy = searchParams.get('orderBy') || 'timestamp';
    const orderDirection = (searchParams.get('orderDirection') || 'DESC') as 'ASC' | 'DESC';

    const client = await getAgenticTrustClient();
    const result = await client.searchValidationRequestsAdvanced({
      chainId: parsed.chainId,
      agentId: parsed.agentId,
      limit,
      offset,
      orderBy,
      orderDirection,
    });

    if (!result) {
      return NextResponse.json({ validationRequests: [] });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Error fetching validation responses:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch validation responses',
      },
      { status: 500 },
    );
  }
}

