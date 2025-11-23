export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentName,
      agentAccount,
      account,
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
      chainId,
    } = body ?? {};

    console.log('[api/agents/create-for-aa] Received chainId:', chainId);

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

    if (!account || typeof account !== 'string' || !ADDRESS_REGEX.test(account)) {
      return NextResponse.json(
        {
          error: 'Missing or invalid account address for agent AA creation',
        },
        { status: 400 }
      );
    }

    const client = await getAgenticTrustClient();
    const result = await client.createAgent({
      agentName,
      agentAccount: agentAccount as `0x${string}`,
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
      chainId: chainId ? Number(chainId) : undefined,
      ownerType: 'aa',
      executionMode: 'client',
    });

    const aaClientResult = result as {
      bundlerUrl: string;
      tokenUri: string;
      chainId: number;
      calls: Array<{ to: `0x${string}`; data: `0x${string}` }>;
    };

    return NextResponse.json({
      success: true as const,
      bundlerUrl: aaClientResult.bundlerUrl,
      tokenUri: aaClientResult.tokenUri,
      chainId: aaClientResult.chainId,
      calls: aaClientResult.calls,
    });
  } catch (error) {
    console.error('Error in create agent route:', error);
    return NextResponse.json(
      {
        error: 'Failed to create agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
