import { NextRequest, NextResponse } from 'next/server';
import { addAgentNameToOrgUsingEnsKey } from '@agentic-trust/core/server';

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

    const rawCalls = Array.isArray((result as any)?.calls)
      ? ((result as any).calls as Array<Record<string, unknown>>)
      : [];

    const jsonSafeCalls = rawCalls
      .map((call) => {
        const to = call?.to as `0x${string}` | undefined;
        const data = call?.data as `0x${string}` | undefined;
        const value = call?.value as string | number | bigint | null | undefined;
        return {
          to,
          data,
          value: typeof value === 'bigint' ? value.toString() : value ?? null,
        };
      })
      .filter((call) => typeof call.to === 'string' && typeof call.data === 'string');

    return NextResponse.json({
      success: true,
      calls: jsonSafeCalls,
    });
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

