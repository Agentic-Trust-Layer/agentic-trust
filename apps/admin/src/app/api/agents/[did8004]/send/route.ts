export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';
import type { MessageRequest } from '@agentic-trust/core/server';

export async function POST(
  req: Request,
  { params }: { params: { did8004: string } }
) {
  try {
    const did8004 = decodeURIComponent(params.did8004);
    let parsed;
    try {
      parsed = parseDid8004(did8004);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid DID8004 format' },
        { status: 400 }
      );
    }
    
    if (!parsed || !parsed.agentId) {
      return NextResponse.json(
        { error: 'Invalid DID8004 format' },
        { status: 400 }
      );
    }

    const body = (await req.json()) as MessageRequest;
    
    if (!body.message && !body.payload && !body.skillId) {
      return NextResponse.json(
        { error: 'At least one of message, payload, or skillId is required' },
        { status: 400 }
      );
    }

    // This route is for sending messages to a specific agent (from did8004 parameter)
    // For atp.feedback.* and atp.inbox.* skills, use /api/agents-atp/send instead
    const client = await getAgenticTrustClient();
    const agent = await client.agents.getAgent(parsed.agentId.toString());
    
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Agent is auto-initialized in constructor if it has an a2aEndpoint
    // If not initialized, sendMessage will throw an appropriate error
    const response = await agent.sendMessage(body);
    
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[Send Message API] Error:', error);
    const errorMessage = error?.message || 'Failed to send message';
    
    // Check if it's a client error (400) vs server error (500)
    // Errors from A2A protocol that indicate missing requirements should be 400
    const isClientError = errorMessage.includes('Session package is required') ||
                         errorMessage.includes('is required') ||
                         errorMessage.includes('Invalid') ||
                         errorMessage.includes('not found');
    
    return NextResponse.json(
      { 
        success: false,
        error: errorMessage
      },
      { status: isClientError ? 400 : 500 }
    );
  }
}

