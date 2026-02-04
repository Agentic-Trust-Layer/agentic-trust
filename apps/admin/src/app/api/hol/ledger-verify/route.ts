export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyHolLedgerChallenge } from '@agentic-trust/core/server';

const COOKIE_KEY = 'hol_rb_ledger_key';
const COOKIE_ACCOUNT = 'hol_rb_ledger_account';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    const challengeId = typeof body?.challengeId === 'string' ? body.challengeId.trim() : '';
    const signature = typeof body?.signature === 'string' ? body.signature.trim() : '';
    const signatureKind =
      body?.signatureKind === 'raw' || body?.signatureKind === 'map' || body?.signatureKind === 'evm'
        ? (body.signatureKind as 'raw' | 'map' | 'evm')
        : undefined;
    const publicKey = typeof body?.publicKey === 'string' ? body.publicKey.trim() : undefined;

    if (!accountId || !challengeId || !signature) {
      return NextResponse.json(
        { error: 'Missing fields', message: 'accountId, challengeId, and signature are required' },
        { status: 400 },
      );
    }

    const verified = await verifyHolLedgerChallenge({
      accountId,
      challengeId,
      signature,
      signatureKind,
      publicKey,
      expiresInMinutes: 10,
    });

    const res = NextResponse.json({
      ok: true,
      verified: {
        accountId: verified.accountId,
        network: verified.network,
        networkCanonical: verified.networkCanonical,
        apiKey: verified.apiKey ? { prefix: verified.apiKey.prefix, lastFour: verified.apiKey.lastFour } : null,
      },
    });

    // Store the issued broker ledger key server-side (HttpOnly cookie).
    res.cookies.set(COOKIE_KEY, verified.key, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 60 * 10,
    });
    res.cookies.set(COOKIE_ACCOUNT, verified.accountId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 60 * 10,
    });

    return res;
  } catch (error) {
    // Surface broker error details for debugging
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500;
    const statusText = typeof (error as any)?.statusText === 'string' ? (error as any).statusText : undefined;
    const body = (error as any)?.body;
    if (body) {
      try {
        console.error('HOL ledger verify failed (broker body):', JSON.stringify(body, null, 2));
      } catch {
        console.error('HOL ledger verify failed (broker body):', body);
      }
    } else {
      console.error('HOL ledger verify failed:', error);
    }
    return NextResponse.json(
      {
        error: 'HOL ledger verify failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        status,
        statusText,
        body,
      },
      { status },
    );
  }
}

