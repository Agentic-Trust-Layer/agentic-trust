import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';

export async function PUT(
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
    const { tokenURI, metadata } = body;

    // Validate that at least one update field is provided
    if (tokenURI === undefined && (!metadata || metadata.length === 0)) {
      return NextResponse.json(
        { error: 'At least one update field is required: tokenURI or metadata' },
        { status: 400 },
      );
    }

    const client = await getAgenticTrustClient();

    // Update agent using admin API
    const adminAgents = client.agents.admin as any;
    const updateFn =
      typeof adminAgents.updateAgentByDid === 'function'
        ? adminAgents.updateAgentByDid.bind(adminAgents)
        : (async (did: string, options: { chainId: number; tokenURI?: string; metadata?: Array<{ key: string; value: string }> }) => {
            const parsedDid = parseDid8004(did);
            return client.agents.admin.updateAgent({
              agentId: parsedDid.agentId,
              chainId: options.chainId,
              tokenURI: options.tokenURI,
              metadata: options.metadata,
            });
          });

    const result = await updateFn(agentDid, {
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
      { status: 500 },
    );
  }
}

