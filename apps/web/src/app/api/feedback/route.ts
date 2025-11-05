/**
 * Server-side API route for submitting feedback
 * Handles reputation contract calls on the server side
 */

import { NextRequest, NextResponse, userAgent } from 'next/server';
import { getAgentTrustClient } from '@/lib/server-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, score, feedback, feedbackAuth, tag1, tag2, feedbackUri, feedbackHash, clientAddress } = body;

    // Validate required fields
    if (!agentId || score === undefined || !feedbackAuth) {
      return NextResponse.json(
        { error: 'Missing required fields: agentId, score, feedbackAuth' },
        { status: 400 }
      );
    }

    // Get server-side client
    const atClient = await getAgentTrustClient();

    // Get the agent by ID
    const agent = await atClient.agents.getAgent(agentId.toString());
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // clientAddress is optional - if not provided, it will be retrieved from ClientApp
    const feedbackResult = await agent.feedback.giveFeedback({
      ...(clientAddress && { clientAddress }),
      score: typeof score === 'number' ? score : parseInt(score, 10),
      feedback: feedback || 'Feedback submitted via web client',
      feedbackAuth: feedbackAuth,
      tag1,
      tag2,
      feedbackUri,
      feedbackHash,
    });


    
    return NextResponse.json({
      success: true,
      txHash: feedbackResult.txHash
    });
  } catch (error: unknown) {
    console.error('Error submitting feedback:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to submit feedback',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

