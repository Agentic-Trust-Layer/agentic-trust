/**
 * Server-side API route for sending messages to agents
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentTrustClient } from '@/lib/server-client';
import type { MessageRequest } from '@agentic-trust/core';
import { parse8004Did } from '@agentic-trust/core';

export async function POST(
  request: NextRequest,
  { params }: { params: { 'did:8004': string } }
) {
  try {
    let parsed;
    try {
      parsed = parse8004Did(params['did:8004']);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid 8004 DID';
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { message, payload, skillId, metadata }: MessageRequest = body;

    if (!message && !payload) {
      return NextResponse.json(
        { error: 'Missing message or payload' },
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

    // For agent.feedback.requestAuth skill, clientAddress is REQUIRED
    // Get client address from AgenticTrustClient
    let clientAddress: string | undefined;
    if (skillId === 'agent.feedback.requestAuth') {
      try {
        // Use AgenticTrustClient's getClientAddress method
        clientAddress = await atClient.getClientAddress();
        
        if (!clientAddress) {
          return NextResponse.json(
            { error: 'Failed to get client address. Cannot request feedback auth.' },
            { status: 500 },
          );
        }
        
        console.log('Client address for feedback auth request:', clientAddress);
      } catch (error) {
        console.error('Failed to get client address:', error);
        return NextResponse.json(
          { error: `Failed to get client address: ${error instanceof Error ? error.message : 'Unknown error'}` },
          { status: 500 },
        );
      }
    } else {
      // For other skills, try to get client address if available (but not required)
      try {
        clientAddress = await atClient.getClientAddress();
      } catch (error) {
        console.warn('Failed to get client address:', error);
        // Not required for other skills, so we continue without it
      }
    }

    // Build message request with clientAddress in payload
    // For agent.feedback.requestAuth, clientAddress is required and must be included
    const messageRequest: MessageRequest = {
      message,
      payload: {
        ...payload,
        ...(clientAddress && { clientAddress }), // Include clientAddress if available
      },
      skillId,
      metadata,
    };
    
    // Validate that clientAddress is set for agent.feedback.requestAuth
    if (skillId === 'agent.feedback.requestAuth' && !clientAddress) {
      return NextResponse.json(
        { error: 'clientAddress is required in payload for agent.feedback.requestAuth skill' },
        { status: 400 },
      );
    }

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
      { status: 500 },
    );
  }
}

