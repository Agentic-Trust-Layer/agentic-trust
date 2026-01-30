export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function POST(
  _request: Request,
  _ctx: { params: { uaid: string } },
) {
  return NextResponse.json(
    {
      error: 'Not supported',
      message: 'Refresh is disabled in UAID-only mode (did:8004 routes removed).',
    },
    { status: 501 },
  );
}

