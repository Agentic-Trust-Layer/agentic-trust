export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentAddress,
      orgName,
      agentName,
      agentUrl,
      agentDescription,
      agentImage,
      chainId,
    } = body ?? {};

    if (!agentAddress || !orgName || !agentName) {
      return NextResponse.json(
        { error: 'Missing required fields: agentAddress, orgName, and agentName' },
        { status: 400 }
      );
    }

    const client = await getAgenticTrustClient();
    const result = await client.addAgentNameToL2Org({
      agentAddress,
      orgName,
      agentName,
      agentUrl,
      agentDescription,
      agentImage,
      chainId,
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
    console.error('Error preparing L2 ENS calls:', error);
    return NextResponse.json(
      {
        error: 'Failed to prepare L2 ENS calls',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

