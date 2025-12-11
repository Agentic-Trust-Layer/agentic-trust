export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { MessageRequest } from '@agentic-trust/core/server';

/**
 * API route for sending A2A messages to agents-atp.8004-agent.io
 * 
 * This route is specifically for agent.feedback.* and agent.inbox.* skills
 * which are always handled by the centralized agents-atp service.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as MessageRequest;
    
    if (!body.message && !body.payload && !body.skillId) {
      return NextResponse.json(
        { error: 'At least one of message, payload, or skillId is required' },
        { status: 400 }
      );
    }

    // Always send to agents-atp.8004-agent.io
    const atpEndpoint = 'https://agents-atp.8004-agent.io/api/a2a';
    
    try {
      const response = await fetch(atpEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
        
        return NextResponse.json(
          { 
            success: false,
            error: errorData.error || errorData.message || `HTTP ${response.status}: ${errorText}` 
          },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
    } catch (error: any) {
      console.error('[Agents-ATP Send API] Error sending to ATP agent:', error);
      return NextResponse.json(
        { 
          success: false,
          error: error?.message || 'Failed to send message to ATP agent'
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('[Agents-ATP Send API] Error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error?.message || 'Failed to process request'
      },
      { status: 500 }
    );
  }
}

