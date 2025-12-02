export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { did8004: string } },
) {
  try {
    const didAgent = decodeURIComponent(params.did8004);

    const client = await getAgenticTrustClient();
    const agentInfo = await client.getAgentDetailsByDid(didAgent);

    return NextResponse.json(agentInfo);
  } catch (error) {
    console.error('Error in get agent info route:', error);
    if (
      error instanceof Error &&
      (error.message.toLowerCase().includes('8004 did') ||
        error.message.toLowerCase().includes('did:8004') ||
        error.message.toLowerCase().includes('invalid agentid'))
    ) {
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message: error.message },
        { status: 400 },
      );
    }
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
  { params }: { params: { did8004: string } },
) {
  try {
    const didAgent = decodeURIComponent(params.did8004);
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

    const client = await getAgenticTrustClient();
    const isOwner = await client.isOwner(didAgent, walletAddress as `0x${string}`);

    return NextResponse.json({ isOwner });
  } catch (error) {
    console.error('Error in agent isOwner route:', error);
    if (
      error instanceof Error &&
      (error.message.toLowerCase().includes('8004 did') ||
        error.message.toLowerCase().includes('did:8004') ||
        error.message.toLowerCase().includes('invalid agentid'))
    ) {
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: 'Failed to check ownership',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

