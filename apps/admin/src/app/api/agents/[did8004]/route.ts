import { NextRequest, NextResponse } from 'next/server';
import { buildAgentRecord } from '../_lib/agentRecord';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ 'did:8004': string }> }
) {
  try {
    const { 'did:8004': didAgent } = await params;

    const payload = await buildAgentRecord(didAgent);

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error in get agent info route:', error);
    if (error instanceof Error && error.message.toLowerCase().includes('8004 did')) {
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: 'Failed to get agent information',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

