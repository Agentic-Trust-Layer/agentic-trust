/**
 * Server-side API route for fetching agent card
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentTrustClient } from '@/lib/server-client';

export async function GET(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const { agentId } = params;
    
    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

    const atClient = await getAgentTrustClient();
    
    // Get agent by ID directly
    const agent = await atClient.agents.getAgent(agentId);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Fetch agent card
    const card = await agent.fetchCard();
    
    if (!card) {
      return NextResponse.json(
        { error: 'Could not fetch agent card' },
        { status: 404 }
      );
    }

    // Check if agent supports the protocol
    const supportsProtocol = await agent.supportsProtocol();
    const endpointInfo = supportsProtocol ? await agent.getEndpoint() : null;

    return NextResponse.json({
      card,
      supportsProtocol,
      endpoint: endpointInfo,
    });
  } catch (error: unknown) {
    console.error('Error fetching agent card:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to fetch agent card',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

