import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const body = await request.json();
    const { to } = body;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

    if (!to) {
      return NextResponse.json(
        { error: 'Missing required field: to (recipient address)' },
        { status: 400 }
      );
    }

    // Validate recipient address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      return NextResponse.json(
        { error: 'Invalid recipient address format. Must be a valid Ethereum address (0x...)' },
        { status: 400 }
      );
    }

    const client = await getAdminClient();

    // Transfer agent using admin API
    const result = await client.agents.admin.transferAgent({
      agentId,
      to: to as `0x${string}`,
    });

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
      { status: 500 }
    );
  }
}

