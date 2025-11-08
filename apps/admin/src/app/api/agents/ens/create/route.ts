import { NextRequest, NextResponse } from 'next/server';
import {
  addAgentNameToOrgUsingEnsKey,
  type AddAgentToOrgResult,
} from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentName,
      orgName,
      agentAccount,
      agentUrl,
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

    const result = await addAgentNameToOrgUsingEnsKey({
      agentName,
      orgName,
      agentAddress: agentAccount as `0x${string}`,
      agentUrl,
    });

    const sanitize = (value: unknown): unknown =>
      typeof value === 'bigint' ? value.toString() : value;

    const responsePayload: AddAgentToOrgResult & { success: true } = {
      success: true,
      userOpHash: result.userOpHash,
      receipt: JSON.parse(JSON.stringify(result.receipt, (_, value) => sanitize(value))),
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error creating ENS record:', error);
    return NextResponse.json(
      {
        error: 'Failed to add agent name to ENS org',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

