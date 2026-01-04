import { NextRequest, NextResponse } from 'next/server';
import { generateHcs14UaidDidTarget } from '@agentic-trust/core/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, chainId, uid } = body;

    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json(
        { error: 'agentId is required' },
        { status: 400 }
      );
    }

    if (!chainId || typeof chainId !== 'number') {
      return NextResponse.json(
        { error: 'chainId is required' },
        { status: 400 }
      );
    }

    try {
      const nativeId = chainId + ":" + agentId;
      const { uaid } = await generateHcs14UaidDidTarget({
        routing: {
          registry: 'erc-8004',
          proto: 'a2a',
          nativeId: nativeId,
          uid: typeof uid === 'string' && uid.trim() ? uid.trim() : undefined,
        },
      });

      return NextResponse.json({ uaid });
    } catch (error) {
      console.warn('[generate-uaid] Failed to generate UAID:', error);
      return NextResponse.json({ uaid: null }, { status: 200 });
    }
  } catch (error) {
    console.error('[generate-uaid] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

