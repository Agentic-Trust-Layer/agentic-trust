/**
 * Server-side API route for sending messages to agents
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/server-client';
import type { MessageRequest } from '@agentic-trust/core';

export async function POST(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const { agentId } = params;
    const body = await request.json();
    const { message, payload, skillId, metadata }: MessageRequest = body;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

    if (!message && !payload) {
      return NextResponse.json(
        { error: 'Missing message or payload' },
        { status: 400 }
      );
    }

    const client = await getServerClient();
    
    // Get agent by ID directly
    const agent = await client.agents.getAgent(agentId);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Build message request
    const messageRequest: MessageRequest = {
      message,
      payload,
      skillId,
      metadata,
    };

    // Send message
    const response = await agent.sendMessage(messageRequest);

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error('Error sending message:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to send message',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

