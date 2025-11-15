import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';

export async function POST(
  request: NextRequest,
  { params }: { params: { 'did:8004': string } }
) {
  try {
    const agentDid = params['did:8004'];
    let parsed;
    try {
      parsed = parseDid8004(agentDid);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid 8004 DID';
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { to } = body;

    if (!to) {
      return NextResponse.json(
        { error: 'Missing required field: to (recipient address)' },
        { status: 400 },
      );
    }

    // Validate recipient address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      return NextResponse.json(
        { error: 'Invalid recipient address format. Must be a valid Ethereum address (0x...)' },
        { status: 400 },
      );
    }

    const client = await getAgenticTrustClient();

    // Transfer agent using admin API. We construct a did:ethr DID for
    // the destination account so core can derive the target address.
    const toDid = `did:ethr:${parsed.chainId}:${to}`;
    const result = await client.agents.admin.transferAgentByDid(
      agentDid,
      toDid as string,
    );

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
    });
  } catch (error: unknown) {
    console.error('Error transferring agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to transfer agent',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 },
    );
  }
}

