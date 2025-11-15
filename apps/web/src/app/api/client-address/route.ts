export const dynamic = 'force-dynamic';

/**
 * Server-side API route for getting the client address
 * Returns the address associated with the private key from the ClientApp singleton
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function GET(request: NextRequest) {
  try {
    // Get server-side client
    const atClient = await getAgenticTrustClient();
    
    // Get client address using AgenticTrustClient method
    const clientAddress = await atClient.getClientAddress();
    
    if (!clientAddress) {
      return NextResponse.json(
        { error: 'Failed to get client address' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      clientAddress,
    });
  } catch (error: unknown) {
    console.error('Error getting client address:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to get client address',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}
