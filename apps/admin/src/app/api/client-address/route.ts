export const dynamic = 'force-dynamic';

/**
 * Server-side API route for getting the client address
 * Returns the address associated with the private key from the ClientApp singleton
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClientApp } from '@agentic-trust/core/server';

export async function GET(request: NextRequest) {
  try {
    // Get client app account (session/AA or EOA) from ClientApp
    const clientApp = await getClientApp();
    const clientAppAccount = clientApp?.address;
    
    if (!clientAppAccount) {
      return NextResponse.json(
        { error: 'Failed to get client app account' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      clientAddress: clientAppAccount,
    });
  } catch (error: unknown) {
    console.error('Error getting client app account:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to get client app account',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

