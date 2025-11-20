export const dynamic = 'force-dynamic';

/**
 * Server-side API route for sending messages to agents
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, getClientApp } from '@agentic-trust/core/server';
import type { MessageRequest } from '@agentic-trust/core';
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

    const atClient = await getAgenticTrustClient();
    
    // Get agent by ID directly
    const agent = await atClient.getAgent(parsed.agentId, parsed.chainId);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 },
      );
    }

    // For agent.feedback.requestAuth skill, a clientAppAccount is REQUIRED
    // Get client app account (session/AA or EOA) from the ClientApp singleton
    let clientAppAccount: string | undefined;
    if (skillId === 'agent.feedback.requestAuth') {
      try {
        // Use ClientApp singleton to get the account address
        const clientApp = await getClientApp();
        clientAppAccount = clientApp?.address;
        
        if (!clientAppAccount) {
          return NextResponse.json(
            { error: 'Failed to get client app account. Cannot request feedback auth.' },
            { status: 500 },
          );
        }
        
        console.log('Client app account for feedback auth request:', clientAppAccount);
      } catch (error) {
        console.error('Failed to get client app account from ClientApp:', error);
        return NextResponse.json(
          { error: `Failed to get client app account: ${error instanceof Error ? error.message : 'Unknown error'}` },
          { status: 500 },
        );
      }
    } else {
      // For other skills, try to get client app account if available (but not required)
      try {
        const clientApp = await getClientApp();
        clientAppAccount = clientApp?.address;
      } catch (error) {
        console.warn('Failed to get client app account:', error);
        // Not required for other skills, so we continue without it
      }
    }

    // Build message request with clientAddress in payload
    // For agent.feedback.requestAuth, clientAppAccount is required and must be included
    const messageRequest: MessageRequest = {
      message,
      payload: {
        ...payload,
        ...(clientAppAccount && { clientAddress: clientAppAccount }), // Include clientAppAccount as clientAddress if available
      },
      skillId,
      metadata,
    };
    
    // Validate that clientAppAccount is set for agent.feedback.requestAuth
    if (skillId === 'agent.feedback.requestAuth' && !clientAppAccount) {
      return NextResponse.json(
        { error: 'clientAppAccount is required in payload for agent.feedback.requestAuth skill' },
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
