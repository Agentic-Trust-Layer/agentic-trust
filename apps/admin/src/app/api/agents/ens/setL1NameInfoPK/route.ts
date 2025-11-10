import { NextRequest, NextResponse } from 'next/server';
import { setL1NameInfoPK } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentAddress,
      orgName,
      agentName,
      agentUrl,
      agentDescription,
      chainId,
    } = body ?? {};

    if (!agentAddress || !orgName || !agentName) {
      return NextResponse.json(
        { error: 'Missing required fields: agentAddress, orgName, agentName' },
        { status: 400 },
      );
    }

    const targetChainId = chainId ? Number(chainId) : 11155111;
    const { userOpHash, receipt } = await setL1NameInfoPK({
      agentAddress: agentAddress as `0x${string}`,
      orgName,
      agentName,
      agentUrl,
      agentDescription,
      chainId: targetChainId,
    });

    return NextResponse.json({
      success: true,
      userOpHash,
      receipt,
    });
  } catch (error) {
    console.error('Error in setL1NameInfoPK:', error);
    return NextResponse.json(
      {
        error: 'Failed to set L1 name info (server PK)',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}


