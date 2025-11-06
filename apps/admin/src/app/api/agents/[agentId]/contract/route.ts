import { NextRequest, NextResponse } from 'next/server';
import { getIdentityClient } from '@agentic-trust/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    console.log('********************* contract: agentId', agentId);

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

    const identityClient = await getIdentityClient();
    const agentIdBigInt = BigInt(agentId);

    // Get tokenURI from contract
    // AIAgentIdentityClient extends BaseIdentityClient which has getTokenURI
    const tokenURI = await identityClient.getTokenURI(agentIdBigInt);

    console.log('********************* contract: tokenURI', tokenURI);

    // Get common metadata keys
    const metadataKeys = ['agentName', 'agentAccount'];
    const metadata: Record<string, string> = {};

    for (const key of metadataKeys) {
      try {
        const value = await identityClient.getMetadata(agentIdBigInt, key);
        if (value) {
          metadata[key] = value;
        }
      } catch (error) {
        // Metadata key might not exist, continue
        console.warn(`Failed to get metadata key ${key}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      agentId,
      tokenURI,
      metadata,
    });
  } catch (error: unknown) {
    console.error('Error fetching agent from contract:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to fetch agent from contract',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

