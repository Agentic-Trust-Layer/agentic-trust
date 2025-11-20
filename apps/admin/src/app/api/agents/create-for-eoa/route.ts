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
    const result = await client.createAgent({
      agentName,
      agentAccount: agentAccount as `0x${string}`,
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
      chainId: chainId ? Number(chainId) : undefined,
      ownerType: 'eoa',
      executionMode: 'client'
    });

    const clientSigningResult = result as {
      requiresClientSigning?: boolean;
      transaction?: unknown;
      tokenURI?: string;
      metadata?: unknown;
    };

    if (clientSigningResult.requiresClientSigning) {
      return NextResponse.json({
        success: true as const,
        requiresClientSigning: true,
        transaction: clientSigningResult.transaction,
        tokenURI: clientSigningResult.tokenURI,
        metadata: clientSigningResult.metadata,
      });
    }

    const onchainResult = result as { agentId?: string | bigint; txHash?: string };

    if (onchainResult.agentId && onchainResult.txHash) {
      return NextResponse.json({
        success: true as const,
        agentId: onchainResult.agentId.toString(),
        txHash: onchainResult.txHash,
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
