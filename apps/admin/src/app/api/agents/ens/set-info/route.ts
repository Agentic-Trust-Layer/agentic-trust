import { NextRequest, NextResponse } from 'next/server';
import { prepareAgentNameInfoCalls } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const { agentName, orgName, agentAddress, agentUrl, agentDescription } = await request.json();

    if (!agentName || !orgName || !agentAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: agentName, orgName, and agentAddress' },
        { status: 400 }
      );
    }

    const result = await prepareAgentNameInfoCalls({
      agentAddress,
      orgName,
      agentName,
      agentUrl,
      agentDescription,
    });

    const jsonSafeCalls = result.calls.map((call) => ({
      to: call.to,
      data: call.data,
      value: typeof call.value === 'bigint' ? call.value.toString() : call.value ?? null,
    }));

    return NextResponse.json({
      success: true,
      calls: jsonSafeCalls,
    });
  } catch (error) {
    console.error('Error preparing ENS agent info calls:', error);
    return NextResponse.json(
      {
        error: 'Failed to prepare ENS agent info calls',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

