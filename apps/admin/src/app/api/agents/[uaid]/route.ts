export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, getDiscoveryClient } from '@agentic-trust/core/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  try {
    const t0 = Date.now();
    const uaid = decodeURIComponent(params.uaid);
    if (!uaid.startsWith('uaid:')) {
      return NextResponse.json(
        {
          error: 'Invalid identifier',
          message: 'Only UAID is supported (expected prefix "uaid:")',
        },
        { status: 400 },
      );
    }

    const tClient0 = Date.now();
    const client = await getAgenticTrustClient();
    const tClient1 = Date.now();
    const tDetail0 = Date.now();
    const agentInfo = await (client as any).getAgentDetailsByUaidUniversal?.(uaid, {
      includeRegistration: false,
      allowOnChain: false,
    });
    const tDetail1 = Date.now();
    if (!agentInfo) {
      throw new Error('Agent not found for UAID');
    }

    const t1 = Date.now();
    if (process.env.NODE_ENV === 'development') {
      console.log('[Admin][api/agents/[uaid]] timing ms:', {
        total: t1 - t0,
        getClient: tClient1 - tClient0,
        getAgentDetails: tDetail1 - tDetail0,
      });
    }

    return NextResponse.json(agentInfo, {
      headers: {
        'x-agent-details-total-ms': String(t1 - t0),
        'x-agent-details-client-ms': String(tClient1 - tClient0),
        'x-agent-details-core-ms': String(tDetail1 - tDetail0),
      },
    });
  } catch (error) {
    console.error('Error in get agent info route:', error);
    return NextResponse.json(
      {
        error: 'Failed to get agent information',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  try {
    const uaid = decodeURIComponent(params.uaid);
    if (!uaid.startsWith('uaid:')) {
      return NextResponse.json(
        {
          error: 'Invalid identifier',
          message: 'Only UAID is supported (expected prefix "uaid:")',
        },
        { status: 400 },
      );
    }
    const body = await request.json();
    const { walletAddress, action } = body;

    if (action !== 'isOwner') {
      return NextResponse.json(
        { error: 'Invalid action', message: 'Only "isOwner" action is supported' },
        { status: 400 },
      );
    }

    if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.startsWith('0x')) {
      return NextResponse.json(
        { error: 'Invalid wallet address', message: 'walletAddress must be a valid Ethereum address' },
        { status: 400 },
      );
    }

    const discovery = await getDiscoveryClient();
    if (typeof (discovery as any).isOwnerByUaid !== 'function') {
      throw new Error('Discovery KB schema missing Query.kbIsOwner');
    }
    const isOwner = await (discovery as any).isOwnerByUaid(uaid, walletAddress);

    return NextResponse.json({ isOwner });
  } catch (error) {
    console.error('Error in agent isOwner route:', error);
    return NextResponse.json(
      {
        error: 'Failed to check ownership',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

