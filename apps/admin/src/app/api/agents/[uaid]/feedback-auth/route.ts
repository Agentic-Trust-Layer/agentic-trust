export const dynamic = 'force-dynamic';

import {
  requestFeedbackAuthRouteHandler,
} from '@agentic-trust/core/server';
import { NextResponse } from 'next/server';

const handler = requestFeedbackAuthRouteHandler();

export async function GET(request: Request, { params }: { params: { uaid: string } }) {
  const uaid = decodeURIComponent(String(params?.uaid ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'UAID is required (expected prefix "uaid:")' },
      { status: 400 },
    );
  }

  try {
    // UAID-first: pass UAID through; core will resolve to did:8004 only at the 8004 SDK / Veramo boundary.
    return handler(request, { params: { uaid } as any });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to request feedback auth',
        message: error instanceof Error ? error.message : 'Unknown error',
        uaid,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: { params: { uaid: string } }) {
  const uaid = decodeURIComponent(String(params?.uaid ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'UAID is required (expected prefix "uaid:")' },
      { status: 400 },
    );
  }

  try {
    // UAID-first: pass UAID through; core will resolve to did:8004 only at the 8004 SDK / Veramo boundary.
    return handler(request, { params: { uaid } as any });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to request feedback auth',
        message: error instanceof Error ? error.message : 'Unknown error',
        uaid,
      },
      { status: 500 },
    );
  }
}

