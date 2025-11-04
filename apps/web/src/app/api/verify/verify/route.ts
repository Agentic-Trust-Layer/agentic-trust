/**
 * Server-side API route for verifying agents
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/server-client';
import type { SignedChallenge } from '@agentic-trust/core';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { signedChallenge, audience, nonce } = body;

    if (!signedChallenge) {
      return NextResponse.json(
        { error: 'Missing required field: signedChallenge' },
        { status: 400 }
      );
    }

    const client = await getServerClient();
    const result = await client.verification.verifyAgent({
      signedChallenge: signedChallenge as SignedChallenge,
      audience: audience || 'https://agentic-trust.com',
      nonce,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('Error verifying agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to verify agent',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

