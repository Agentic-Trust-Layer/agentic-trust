import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentName, agentAccount, tokenURI, metadata } = body;

    // Validate required fields
    if (!agentName || !agentAccount) {
      return NextResponse.json(
        { error: 'Missing required fields: agentName and agentAccount are required' },
        { status: 400 }
      );
    }

    // Validate agentAccount format
    if (!/^0x[a-fA-F0-9]{40}$/.test(agentAccount)) {
      return NextResponse.json(
        { error: 'Invalid agentAccount format. Must be a valid Ethereum address (0x...)' },
        { status: 400 }
      );
    }

    const client = await getAdminClient();

    // Create agent using admin API
    const result = await client.agents.admin.createAgent({
      agentName,
      agentAccount: agentAccount as `0x${string}`,
      tokenURI,
      metadata,
    });

    return NextResponse.json({
      success: true,
      agentId: result.agentId.toString(),
      txHash: result.txHash,
    });
  } catch (error: unknown) {
    console.error('Error creating agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to create agent',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

