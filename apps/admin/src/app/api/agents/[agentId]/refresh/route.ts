import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const body = await request.json();
    const { chainId } = body;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

    // Get the GraphQL client and refresh the agent
    const { getAgentsGraphQLClient } = await import('@agentic-trust/core');
    const graphQLClient = await getAgentsGraphQLClient();
    
    // Use provided chainId or default to Sepolia (11155111)
    const chainIdToUse = chainId || 11155111;
    
    const result = await graphQLClient.refreshAgent(agentId, chainIdToUse);

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

