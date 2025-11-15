import { NextRequest, NextResponse } from 'next/server';
import {
  addAgentNameToL1Org,
  DelegationToolkitUnavailableError,
  isDelegationToolkitAvailable,
} from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentAccount,
      orgName,
      agentName,
      agentUrl,
      chainId,
    } = body ?? {};

    if (!agentName || typeof agentName !== 'string') {
      return NextResponse.json(
        { error: 'agentName is required' },
        { status: 400 }
      );
    }

    if (!orgName || typeof orgName !== 'string') {
      return NextResponse.json(
        { error: 'orgName is required' },
        { status: 400 }
      );
    }

    if (!agentAccount || typeof agentAccount !== 'string' || !agentAccount.startsWith('0x')) {
      return NextResponse.json(
        { error: 'agentAccount must be a valid 0x-prefixed address' },
        { status: 400 }
      );
    }

    const toolkitAvailable = await isDelegationToolkitAvailable();
    if (!toolkitAvailable) {
      return NextResponse.json(
        {
          error: 'ENS L1 automation unavailable',
          message:
            'This deployment was built without @metamask/delegation-toolkit, so server-side ENS registration cannot run. Deploy with the dependency installed or skip L1 ENS automation.',
          requiresDelegationToolkit: true,
        },
        { status: 501 },
      );
    }

    const result = await addAgentNameToL1Org({
      agentAddress: agentAccount as `0x${string}`,
      orgName,
      agentName,
      agentUrl,
      chainId,
    });



    return NextResponse.json({
      success: true,
      message: result,
    });
  } catch (error) {
    console.error('Error creating ENS record:', error);
    if (error instanceof DelegationToolkitUnavailableError) {
      return NextResponse.json(
        {
          error: 'ENS L1 automation unavailable',
          message: error.message,
          requiresDelegationToolkit: true,
        },
        { status: 501 },
      );
    }
    return NextResponse.json(
      {
        error: 'Failed to add agent name to ENS org',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

