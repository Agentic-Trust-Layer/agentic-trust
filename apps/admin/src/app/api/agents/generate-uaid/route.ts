import { NextRequest, NextResponse } from 'next/server';
import { generateHcs14UaidDidTarget } from '@agentic-trust/core/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentAccount, chainId, uid } = body;

    if (!agentAccount || typeof agentAccount !== 'string') {
      return NextResponse.json(
        { error: 'agentAccount is required' },
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
      const uaidValue = await generateHcs14UaidDidTarget({
        chainId,
        account: agentAccount as `0x${string}`,
        routing: {
          registry: 'agentic-trust',
          proto: 'a2a',
          nativeId: String(agentAccount).toLowerCase(),
          uid: typeof uid === 'string' && uid.trim() ? uid.trim() : undefined,
        },
      });

      return NextResponse.json({ uaid: uaidValue });
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

