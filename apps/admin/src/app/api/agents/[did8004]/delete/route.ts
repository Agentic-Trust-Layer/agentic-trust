import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { 'did:8004': string } }
) {
  try {
    const client = await getAgenticTrustClient();
    const adminAgents = client.agents.admin as any;
    const deleteFn =
      typeof adminAgents.deleteAgentByDid === 'function'
        ? adminAgents.deleteAgentByDid.bind(adminAgents)
        : async (did: string) => {
            const parsed = parseDid8004(did);
            return client.agents.admin.deleteAgent({
              agentId: parsed.agentId,
              chainId: parsed.chainId,
            });
          };

    // Delete agent using admin API (transfers to address(0))
    const result = await deleteFn(params['did:8004']);

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
    });
  } catch (error: unknown) {
    console.error('Error deleting agent:', error);
    if (error instanceof Error && error.message.toLowerCase().includes('8004 did')) {
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message: error.message },
        { status: 400 },
      );
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to delete agent',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 },
    );
  }
}

