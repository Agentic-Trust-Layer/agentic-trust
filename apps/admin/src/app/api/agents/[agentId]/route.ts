import { NextRequest, NextResponse } from 'next/server';
import { handleGetAgentInfo } from '@agentic-trust/core/server';
import { getAdminClient } from '@/lib/client';

/**
 * Get comprehensive agent information
 * Aggregates data from contract, IPFS, and GraphQL
 * Auto-generated from @agentic-trust/core
 */
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

    const result = await handleGetAgentInfo(agentId, chainId, getAdminClient);

    // Check if result is an error
    if ('error' in result) {
      const status = result.error.includes('Missing required') ? 400 : 500;
      return NextResponse.json(result, { status });
    }

    // Success response
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in get agent info route:', error);
    return NextResponse.json(
      {
        error: 'Failed to get agent information',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

