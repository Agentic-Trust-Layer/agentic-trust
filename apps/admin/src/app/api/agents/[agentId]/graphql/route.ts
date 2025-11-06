import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const chainId = searchParams.get('chainId') ? parseInt(searchParams.get('chainId')!) : 11155111;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

    const client = await getAdminClient();
    const agentData = await client.agents.getAgentFromGraphQL(chainId, agentId);

    return NextResponse.json({
      success: true,
      agentId,
      chainId,
      agentData,
    });
  } catch (error: unknown) {
    console.error('Error fetching agent from GraphQL:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to fetch agent from GraphQL',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

