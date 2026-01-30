export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function PUT(
  _request: Request,
  _ctx: { params: { uaid: string } },
) {
  return NextResponse.json(
    {
      error: 'Not supported',
      message: 'Update is disabled in UAID-only mode (did:8004 routes removed).',
    },
    { status: 501 },
  );
}

