export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireChainEnvVar } from '@agentic-trust/core/server';

function normalizeHex(value: string): `0x${string}` {
  const trimmed = String(value || '').trim();
  if (!trimmed) throw new Error('Empty hex value');
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const chainIdRaw = searchParams.get('chainId') ?? '';
    const chainId = Number(chainIdRaw);
    if (!Number.isFinite(chainId)) {
      return NextResponse.json({ error: 'Invalid chainId' }, { status: 400 });
    }

    // These are safe to expose to the browser (no secrets).
    const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', chainId);
    const bundlerUrl = requireChainEnvVar('AGENTIC_TRUST_BUNDLER_URL', chainId);
    const identityRegistry = normalizeHex(requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId));
    const reputationRegistry = normalizeHex(requireChainEnvVar('AGENTIC_TRUST_REPUTATION_REGISTRY', chainId));
    const validationRegistry = normalizeHex(requireChainEnvVar('AGENTIC_TRUST_VALIDATION_REGISTRY', chainId));

    return NextResponse.json({
      chainId,
      rpcUrl,
      bundlerUrl,
      identityRegistry,
      reputationRegistry,
      validationRegistry,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to load chain env', message: e?.message ?? 'unknown' },
      { status: 500 },
    );
  }
}

