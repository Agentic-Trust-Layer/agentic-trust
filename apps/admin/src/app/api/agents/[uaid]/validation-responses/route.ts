export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { resolveDid8004FromUaid } from '../../_lib/uaid';

export async function GET(
  request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  try {
    const { chainId, agentId } = resolveDid8004FromUaid(params.uaid);

    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit') ? Number.parseInt(searchParams.get('limit')!, 10) : 10;
    const offset = searchParams.get('offset') ? Number.parseInt(searchParams.get('offset')!, 10) : 0;
    const orderBy = searchParams.get('orderBy') || 'timestamp';
    const orderDirection = (searchParams.get('orderDirection') || 'DESC') as 'ASC' | 'DESC';

    const client = await getAgenticTrustClient();
    const result = await client.searchValidationRequestsAdvanced({
      chainId,
      agentId,
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

