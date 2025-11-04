/**
 * Server-side API route for signing verification challenges
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/server-client';
import type { Challenge } from '@agentic-trust/core';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { challenge, keyId, algorithm } = body;

    if (!challenge || !keyId || typeof keyId !== 'string') {
      return NextResponse.json(
        { error: 'Missing required fields: challenge, keyId' },
        { status: 400 }
      );
    }

    const client = await getServerClient();
    const signed = await client.verification.signChallenge(
      challenge as Challenge,
      keyId.trim(),
      algorithm || 'ES256K'
    );

    return NextResponse.json(signed);
  } catch (error: unknown) {
    console.error('Error signing challenge:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to sign challenge',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

