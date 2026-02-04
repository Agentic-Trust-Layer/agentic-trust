export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createHolLedgerChallenge } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId) {
      return NextResponse.json({ error: 'Missing accountId' }, { status: 400 });
    }

    const challenge = await createHolLedgerChallenge({ accountId });
    return NextResponse.json({ ok: true, challenge });
  } catch (error) {
    return NextResponse.json(
      { error: 'HOL ledger challenge failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

