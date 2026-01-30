export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { MessageRequest } from '@agentic-trust/core/server';

export async function POST(
  req: Request,
  { params }: { params: { uaid: string } }
) {
  // UAID-only: do not resolve did:8004 or send on-chain/A2A messages from here.
  // Keep request parsing for basic validation, but return 501.
  void params;
  void ((await req.json().catch(() => ({}))) as MessageRequest);
  return NextResponse.json(
    {
      success: false,
      error: 'Not supported',
      message: 'Send is disabled in UAID-only mode (did:8004 routes removed).',
    },
    { status: 501 },
  );
}

