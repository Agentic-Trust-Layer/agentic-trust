import { NextRequest, NextResponse } from 'next/server';
import { isENSAvailable } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orgName,
      agentName,
      chainId,
    } = body ?? {};

    if (!agentName || typeof agentName !== 'string') {
      return NextResponse.json(
        { error: 'agentName is required' },
        { status: 400 }
      );
    }

    if (!orgName || typeof orgName !== 'string') {
      return NextResponse.json(
        { error: 'orgName is required' },
        { status: 400 }
      );
    }

    const isAvailable = await isENSAvailable(orgName, agentName, chainId);

    return NextResponse.json({
      available: isAvailable,
    });
  } catch (error) {
    console.error('Error checking ENS availability:', error);
    return NextResponse.json(
      {
        error: 'Failed to check ENS availability',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
