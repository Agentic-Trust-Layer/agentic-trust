import { NextRequest, NextResponse } from 'next/server';
import { generateHcs14UaidDidTarget } from '@agentic-trust/core/server';
import { buildDidEthr } from '@agentic-trust/core';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentAccount, chainId, uid, registry, proto, nativeId, domain } = body;

    if (!agentAccount || typeof agentAccount !== 'string') {
      return NextResponse.json({ error: 'agentAccount is required' }, { status: 400 });
    }
    const normalizedAccount = agentAccount.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedAccount)) {
      return NextResponse.json({ error: 'agentAccount must be a valid 0x-prefixed address' }, { status: 400 });
    }

    if (!chainId || typeof chainId !== 'number') {
      return NextResponse.json(
        { error: 'chainId is required' },
        { status: 400 }
      );
    }

    try {
      const didEthr = buildDidEthr(chainId, normalizedAccount as `0x${string}`, { encode: false });
      const caip10 = `eip155:${chainId}:${normalizedAccount}`;
      const { uaid } = await generateHcs14UaidDidTarget({
        targetDid: didEthr,
        routing: {
          registry: typeof registry === 'string' && registry.trim() ? registry.trim() : 'erc-8004',
          proto: typeof proto === 'string' && proto.trim() ? proto.trim() : 'a2a',
          nativeId:
            typeof nativeId === 'string' && nativeId.trim()
              ? nativeId.trim()
              : caip10,
          uid: typeof uid === 'string' && uid.trim() ? uid.trim() : didEthr,
          domain: typeof domain === 'string' && domain.trim() ? domain.trim() : undefined,
        },
      });

      return NextResponse.json({ uaid });
    } catch (error) {
      console.warn('[generate-uaid] Failed to generate UAID:', error);
      return NextResponse.json(
        { error: 'Failed to generate UAID', message: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('[generate-uaid] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

