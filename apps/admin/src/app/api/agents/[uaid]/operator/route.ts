export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  _ctx: { params: { uaid: string } },
) {
  return NextResponse.json(
    {
      success: true,
      operatorAddress: null,
      hasOperator: false,
    },
    { status: 200 },
  );
}

