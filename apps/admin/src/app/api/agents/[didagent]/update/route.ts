import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';
import { parseAgentDid } from '../../_lib/agentDid';

export async function PUT(
  request: NextRequest,
  { params }: { params: { 'did:agent': string } }
) {
  try {
    let parsed;
    try {
      parsed = parseAgentDid(params['did:agent']);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid agent DID';
      return NextResponse.json(
        { error: 'Invalid agent DID', message },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { tokenURI, metadata } = body;

    // Validate that at least one update field is provided
    if (tokenURI === undefined && (!metadata || metadata.length === 0)) {
      return NextResponse.json(
        { error: 'At least one update field is required: tokenURI or metadata' },
        { status: 400 }
      );
    }

    const client = await getAdminClient();

    // Update agent using admin API
    const result = await client.agents.admin.updateAgent({
      agentId: parsed.agentId,
      chainId: parsed.chainId,
      tokenURI,
      metadata,
    });

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
    });
  } catch (error: unknown) {
    console.error('Error updating agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to update agent',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

