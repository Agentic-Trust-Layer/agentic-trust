export const dynamic = 'force-dynamic';

/**
 * Server-side API route for submitting feedback
 * Handles reputation contract calls on the server side
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentId,
      chainId,
      score,
      feedback,
      feedbackAuth,
      tag1,
      tag2,
      feedbackUri,
      feedbackHash,
      clientAddress,
      agentName,
      skill,
      context,
      capability,
    } = body;

    // Validate required fields
    if (!agentId || score === undefined || !feedbackAuth) {
      return NextResponse.json(
        { error: 'Missing required fields: agentId, score, feedbackAuth' },
        { status: 400 }
      );
    }

    // Get server-side client
    const atClient = await getAgenticTrustClient();

    // Get the agent by ID (and chainId if provided)
    const resolvedChainId = chainId ? parseInt(chainId.toString(), 10) : undefined;
    const agent = await atClient.getAgent(agentId.toString(), resolvedChainId);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // clientAddress is optional - if not provided, it will be retrieved from ClientApp
    const feedbackResult = await agent.giveFeedback({
      ...(clientAddress && { clientAddress }),
      score: typeof score === 'number' ? score : parseInt(score, 10),
      feedback: feedback || 'Feedback submitted via admin client',
      feedbackAuth: feedbackAuth,
      tag1,
      tag2,
      feedbackUri,
      feedbackHash,
      skill,
      context,
      capability,
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

