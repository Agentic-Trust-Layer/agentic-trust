export const dynamic = 'force-dynamic';

/**
 * Server-side API route for verifying an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';

const DID_PARAM_KEYS = ['did:8004', 'did8004', 'did꞉8004'] as const;

function getDidParam(params: Record<string, string | undefined>): string {
  for (const key of DID_PARAM_KEYS) {
    const value = params[key];
    if (value) {
      return decodeURIComponent(value);
    }
  }
  throw new Error('Missing did:8004 parameter');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Record<string, string | undefined> },
) {
  try {
    let parsed;
    try {
      parsed = parseDid8004(getDidParam(params));
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid 8004 DID';
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message, valid: false },
        { status: 400 },
      );
    }

    const atClient = await getAgenticTrustClient();
    
    // Get agent by ID directly
    const agent = await atClient.agents.getAgent(parsed.agentId, parsed.chainId);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 },
      );
    }

    // Verify the agent
    const isValid = await agent.verify();

    return NextResponse.json({
      valid: isValid,
    });
  } catch (error: unknown) {
    console.error('Error verifying agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to verify agent',
        message: errorMessage,
        valid: false,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 },
    );
  }
}
