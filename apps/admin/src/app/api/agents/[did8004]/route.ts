export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, getDiscoveryClient } from '@agentic-trust/core/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { did8004: string } },
) {
  try {
    const uaid = decodeURIComponent(params.did8004);

    const client = await getAgenticTrustClient();
    const agentInfo = await (client as any).getAgentDetailsByUaidUniversal?.(uaid, { includeRegistration: false });
    if (!agentInfo) {
      throw new Error('Agent not found for UAID');
    }

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
    const uaid = decodeURIComponent(params.did8004);
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
    const isOwner =
      typeof (discovery as any).isOwnerByUaid === 'function'
        ? await (discovery as any).isOwnerByUaid(uaid, walletAddress)
        : false;

    return NextResponse.json({ isOwner });
  } catch (error) {
    console.error('Error in agent isOwner route:', error);
    const message = String((error as any)?.message ?? '');
    const isKbIsOwnerNull =
      message.includes('kbIsOwner') &&
      message.includes('Cannot return null for non-nullable field');
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
        message: isKbIsOwnerNull
          ? 'Discovery backend error: kbIsOwner returned null for a non-nullable field. Fix KB resolver to always return true/false (never null).'
          : (error instanceof Error ? error.message : 'Unknown error'),
      },
      { status: isKbIsOwnerNull ? 502 : 500 },
    );
  }
}

