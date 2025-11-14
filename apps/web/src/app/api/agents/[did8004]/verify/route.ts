/**
 * Server-side API route for verifying an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentTrustClient } from '@/lib/server-client';
import { parseDid8004 } from '@agentic-trust/core';

export async function POST(
  request: NextRequest,
  { params }: { params: { 'did:8004': string } }
) {
  try {
    let parsed;
    try {
      parsed = parseDid8004(params['did:8004']);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid 8004 DID';
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message, valid: false },
        { status: 400 },
      );
    }

    const atClient = await getAgentTrustClient();
    
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

