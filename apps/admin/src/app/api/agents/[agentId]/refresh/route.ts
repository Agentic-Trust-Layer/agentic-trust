import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    
    // Parse body if present (optional for refresh endpoint)
    let chainId: number | undefined;
    try {
      const body = await request.json();
      chainId = body.chainId;
    } catch (error) {
      // Body is optional, continue without it
      chainId = undefined;
    }

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

    // Use provided chainId or default to Sepolia (11155111)
    const chainIdToUse = chainId || 11155111;
    
    const client = await getAdminClient();
    const result = await client.agents.refreshAgent(agentId, chainIdToUse);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: unknown) {
    console.error('Error refreshing agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to refresh agent',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

