import { NextRequest, NextResponse } from 'next/server';
import { handleCreateAgent } from '@agentic-trust/core/server';
import { getClient } from '@/lib/client'; // Replace with your app's client getter

/**
 * Create agent API endpoint
 * Auto-generated from @agentic-trust/core
 * 
 * To customize, replace getClient with your app-specific client getter function
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await handleCreateAgentForEOA(body, getClient);
    
    // Check if result is an error
    if ('error' in result) {
      const status = result.error.includes('Missing required') || result.error.includes('Invalid') ? 400 : 500;
      return NextResponse.json(result, { status });
    }
    
    // Success response
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in create agent route:', error);
    return NextResponse.json(
      {
        error: 'Failed to create agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

