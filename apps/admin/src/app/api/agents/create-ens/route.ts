import { NextRequest, NextResponse } from 'next/server';
import { handleCreateENS } from '@agentic-trust/core/server';
import { getAdminClient } from '@/lib/client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const result = await handleCreateENS(body, getAdminClient);
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }
    
    return NextResponse.json({
      success: true,
      txHashes: result.txHashes,
    });
  } catch (error) {
    console.error('Error in create-ens API route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

