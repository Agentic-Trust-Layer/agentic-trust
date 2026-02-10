export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

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

    const walletLower = walletAddress.toLowerCase();

    // Always use on-chain ownerOf for did:8004 UAIDs (discovery/KB can be stale).
    const m = /^uaid:did:8004:(\d+):(\d+)\b/.exec(uaid);
    if (m) {
      const chainId = Number(m[1]);
      const agentId = String(m[2]);
      if (Number.isFinite(chainId) && /^\d+$/.test(agentId)) {
        try {
          const client = await getAgenticTrustClient();
          const owner = await (client as any).getAgentOwner?.(agentId, chainId);
          const onchainIsOwner =
            typeof owner === 'string' && owner.toLowerCase() === walletLower;
          return NextResponse.json({
            isOwner: onchainIsOwner,
            source: 'onchain',
            onchainOwner: owner ?? null,
          });
        } catch (e) {
          throw e;
        }
      }
    }

    // For non-8004 UAIDs we can't reliably resolve on-chain ownership here.
    return NextResponse.json(
      {
        error: 'Unsupported identifier',
        message: 'On-chain ownership check currently supports only uaid:did:8004:{chainId}:{agentId}.',
      },
      { status: 400 },
    );
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

