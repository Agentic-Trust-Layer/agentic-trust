export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { putCliAuth, pruneCliAuth } from '../_store';
import { requireChainEnvVar } from '@agentic-trust/core/server';

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
    const state = String(body?.state ?? '');
    const codeChallenge = String(body?.code_challenge ?? '');
    const redirectUri = String(body?.redirect_uri ?? '');
    const result = body?.result && typeof body.result === 'object' ? (body.result as Record<string, unknown>) : null;

    if (!state || !codeChallenge || !redirectUri || !result) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Best-effort: attach agentRegistry if we have chain config.
    try {
      const chainId = Number((result as any)?.chainId);
      if (Number.isFinite(chainId)) {
        const identityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId);
        result.agentRegistry = `eip155:${chainId}:${identityRegistry}`;
      }
    } catch {
      // ignore
    }

    pruneCliAuth(5 * 60_000);
    const code = base64url(randomBytes(24));
    putCliAuth(code, {
      state,
      codeChallenge,
      redirectUri,
      createdAtMs: Date.now(),
      result,
    });

    return NextResponse.json({ code });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to issue code', message: e?.message ?? 'unknown' },
      { status: 500 },
    );
  }
}

