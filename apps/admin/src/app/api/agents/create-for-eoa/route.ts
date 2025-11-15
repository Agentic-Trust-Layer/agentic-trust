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
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
      chainId,
    } = body ?? {};

    console.log('[api/agents/create-for-eoa] Received chainId:', chainId);

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

    const client = await getAgenticTrustClient();
    const result = await client.agents.createAgentForEOA({
      agentName,
      agentAccount: agentAccount as `0x${string}`,
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
      chainId: chainId ? Number(chainId) : undefined,
    });

    if ('requiresClientSigning' in result && result.requiresClientSigning) {
      return NextResponse.json({
        success: true as const,
        requiresClientSigning: true,
        transaction: result.transaction,
        tokenURI: result.tokenURI,
        metadata: result.metadata,
      });
    }

    if ('agentId' in result && 'txHash' in result) {
      return NextResponse.json({
        success: true as const,
        agentId: result.agentId.toString(),
        txHash: result.txHash,
      });
    }

    return NextResponse.json(
      {
        error: 'Failed to create agent',
        message: 'Unexpected result type from createAgent',
      },
      { status: 500 }
    );
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
