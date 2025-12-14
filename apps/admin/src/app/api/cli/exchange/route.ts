export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { takeCliAuth } from '../_store';

function base64url(buf: Buffer) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as any;
    const code = String(body?.code ?? '');
    const verifier = String(body?.code_verifier ?? '');
    const redirectUri = String(body?.redirect_uri ?? '');

    if (!code || !verifier || !redirectUri) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const stored = takeCliAuth(code);
    if (!stored) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
    }

    if (stored.redirectUri !== redirectUri) {
      return NextResponse.json({ error: 'redirect_uri mismatch' }, { status: 400 });
    }

    const challenge = base64url(createHash('sha256').update(verifier).digest());
    if (challenge !== stored.codeChallenge) {
      return NextResponse.json({ error: 'Invalid code_verifier' }, { status: 400 });
    }

    return NextResponse.json({ result: stored.result });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Exchange failed', message: e?.message ?? 'unknown' },
      { status: 500 },
    );
  }
}

