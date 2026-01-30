export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  _ctx: { params: { uaid: string } },
) {
  return NextResponse.json(
    {
      error: 'Not supported',
      message: 'Feedback responses are disabled in UAID-only mode (did:8004 routes removed).',
    },
    { status: 501 },
  );
}

