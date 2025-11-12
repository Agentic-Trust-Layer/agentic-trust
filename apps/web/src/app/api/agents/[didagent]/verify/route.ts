/**
 * Server-side API route for verifying an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentTrustClient } from '@/lib/server-client';
import { parseAgentDid } from '../../_lib/agentDid';

export async function POST(
  request: NextRequest,
  { params }: { params: { 'did:agent': string } }
) {
  try {
    let parsed;
    try {
      parsed = parseAgentDid(params['did:agent']);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid agent DID';
      return NextResponse.json(
        { error: 'Invalid agent DID', message, valid: false },
        { status: 400 }
      );
    }

    const atClient = await getAgentTrustClient();
    
    // Get agent by ID directly
    const agent = await atClient.agents.getAgent(parsed.agentId, parsed.chainId);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
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
      { status: 500 }
    );
  }
}

