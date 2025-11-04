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

    // For agent.feedback.requestAuth skill, clientAddress is REQUIRED
    // Get client address from reputation client
    let clientAddress: string | undefined;
    if (skillId === 'agent.feedback.requestAuth') {
      if (!client.reputation.isInitialized()) {
        return NextResponse.json(
          { error: 'Reputation client not initialized. Cannot request feedback auth without client address.' },
          { status: 500 }
        );
      }
      
      try {
        const reputationClient = client.reputation.getClient();
        const clientAdapter = (reputationClient as unknown as { clientAdapter?: { getAddress: () => Promise<string> } }).clientAdapter;
        if (!clientAdapter) {
          return NextResponse.json(
            { error: 'Client adapter not available. Cannot get client address for feedback auth.' },
            { status: 500 }
          );
        }
        clientAddress = await clientAdapter.getAddress();
        
        if (!clientAddress) {
          return NextResponse.json(
            { error: 'Failed to get client address from reputation client. Cannot request feedback auth.' },
            { status: 500 }
          );
        }
        
        console.log('Client address for feedback auth request:', clientAddress);
      } catch (error) {
        console.error('Failed to get client address:', error);
        return NextResponse.json(
          { error: `Failed to get client address: ${error instanceof Error ? error.message : 'Unknown error'}` },
          { status: 500 }
        );
      }
    } else {
      // For other skills, try to get client address if available (but not required)
      if (client.reputation.isInitialized()) {
        try {
          const reputationClient = client.reputation.getClient();
          const clientAdapter = (reputationClient as unknown as { clientAdapter?: { getAddress: () => Promise<string> } }).clientAdapter;
          if (clientAdapter) {
            clientAddress = await clientAdapter.getAddress();
          }
        } catch (error) {
          console.warn('Failed to get client address:', error);
        }
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
        { status: 400 }
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
      { status: 500 }
    );
  }
}

