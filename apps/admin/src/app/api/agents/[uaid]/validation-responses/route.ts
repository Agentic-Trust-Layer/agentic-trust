export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  const uaid = decodeURIComponent(String(params?.uaid ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'UAID is required (expected prefix "uaid:")' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get('limit');
  const offsetRaw = url.searchParams.get('offset');
  const orderBy = url.searchParams.get('orderBy') ?? undefined;
  const orderDirectionRaw = url.searchParams.get('orderDirection') ?? undefined;

  const limit = limitRaw != null ? Number(limitRaw) : undefined;
  const offset = offsetRaw != null ? Number(offsetRaw) : undefined;
  const orderDirection = orderDirectionRaw === 'ASC' || orderDirectionRaw === 'DESC' ? orderDirectionRaw : undefined;

  try {
    const client = await getAgenticTrustClient();
    const result = await (client as any).searchValidationRequestsAdvanced?.({
      uaid,
      limit: Number.isFinite(limit as number) ? (limit as number) : undefined,
      offset: Number.isFinite(offset as number) ? (offset as number) : undefined,
      orderBy,
      orderDirection,
    });

    return NextResponse.json(
      {
        validationRequests: Array.isArray(result?.validationRequests) ? result.validationRequests : [],
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load validation responses',
        message: error instanceof Error ? error.message : 'Unknown error',
        uaid,
      },
      { status: 500 },
    );
  }
}

