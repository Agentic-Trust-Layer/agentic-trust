import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentName,
      agentAccount,
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
      chainId,
    } = body ?? {};

    console.log('[api/agents/create-for-aa-pk] Received chainId:', chainId);

    if (!agentName || !agentAccount) {
      return NextResponse.json(
        {
          error: 'Missing required fields: agentName and agentAccount are required',
        },
        { status: 400 }
      );
    }

    if (typeof agentAccount !== 'string' || !ADDRESS_REGEX.test(agentAccount)) {
      return NextResponse.json(
        {
          error: 'Invalid agentAccount format. Must be a valid Ethereum address (0x...)',
        },
        { status: 400 }
      );
    }

    const client = await getAdminClient();
    const result = await client.agents.createAgentForAAPK({
      agentName,
      agentAccount: agentAccount as `0x${string}`,
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
      chainId: chainId ? Number(chainId) : undefined,
    });

    return NextResponse.json({
      success: true as const,
      agentId: result.agentId,
      txHash: result.txHash,
    });
  } catch (error) {
    console.error('Error in create-for-aa-pk route:', error);
    return NextResponse.json(
      {
        error: 'Failed to create AA agent (server PK)',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}


