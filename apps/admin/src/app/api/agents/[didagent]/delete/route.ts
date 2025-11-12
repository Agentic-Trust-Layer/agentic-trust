import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';
import { parseAgentDid } from '../../_lib/agentDid';

export async function DELETE(
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

    const client = await getAdminClient();

    // Delete agent using admin API (transfers to address(0))
    const result = await client.agents.admin.deleteAgent({
      agentId: parsed.agentId,
      chainId: parsed.chainId,
    });

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
    });
  } catch (error: unknown) {
    console.error('Error deleting agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to delete agent',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

