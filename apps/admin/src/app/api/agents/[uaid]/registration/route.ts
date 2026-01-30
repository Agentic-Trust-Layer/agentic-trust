export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function PUT(request: Request, { params }: { params: { uaid: string } }) {
  void request;
  void params;
  return NextResponse.json(
    {
      error: 'Not supported',
      message: 'Registration update is disabled in UAID-only mode (did:8004 routes removed).',
    },
    { status: 501 },
  );
}

