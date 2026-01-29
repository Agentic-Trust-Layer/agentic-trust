export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, getDiscoveryClient } from '@agentic-trust/core/server';

export async function GET(
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

    const client = await getAgenticTrustClient();
    const agentInfo = await (client as any).getAgentDetailsByUaidUniversal?.(uaid, {
      includeRegistration: false,
    });
    if (!agentInfo) {
      throw new Error('Agent not found for UAID');
    }

    return NextResponse.json(agentInfo);
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

