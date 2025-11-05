import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const body = await request.json();
    const { tokenURI, metadata } = body;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

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
      agentId,
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

