/**
 * Server-side API route for creating verification challenges
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/server-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentDid, audience } = body;

    if (!agentDid || typeof agentDid !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid agentDid parameter' },
        { status: 400 }
      );
    }

    const client = await getServerClient();
    const challenge = client.verification.createChallenge({
      agentDid: agentDid.trim(),
      audience: audience || 'https://agentic-trust.com',
    });

    return NextResponse.json(challenge);
  } catch (error: unknown) {
    console.error('Error creating challenge:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to create challenge',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

