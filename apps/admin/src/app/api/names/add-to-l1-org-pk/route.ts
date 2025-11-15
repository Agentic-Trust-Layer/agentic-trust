export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { addToL1OrgPK } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orgName,
      agentName,
      agentAddress,
      agentUrl,
      chainId,
    } = body ?? {};

    if (!orgName || !agentName || !agentAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: orgName, agentName, agentAddress' },
        { status: 400 },
      );
    }

    const targetChainId = chainId ? Number(chainId) : 11155111;
    const { userOpHash, receipt } = await addToL1OrgPK({
      orgName,
      agentName,
      agentAddress: agentAddress as `0x${string}`,
      agentUrl,
      chainId: targetChainId,
    });

    return NextResponse.json({
      success: true,
      userOpHash,
      receipt,
    });
  } catch (error) {
    console.error('Error in addToL1OrgPK:', error);
    return NextResponse.json(
      {
        error: 'Failed to add agent name to L1 org (server PK)',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

