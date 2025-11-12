import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';
import { parseAgentDid } from '../../_lib/agentDid';

export async function POST(
  request: NextRequest,
  { params }: { params: { 'did:agent': string } }
) {
  try {
    let parsed;
    try {
      parsed = parseAgentDid(params['did:agent']);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid agent DID';
      return NextResponse.json(
        { error: 'Invalid agent DID', message },
        { status: 400 }
      );
    }

    // Parse body if present (optional for refresh endpoint)
    let chainIdOverride: number | undefined;
    try {
      const body = await request.json();
      chainIdOverride =
        typeof body.chainId === 'number' && Number.isFinite(body.chainId)
          ? body.chainId
          : undefined;
    } catch (error) {
      chainIdOverride = undefined;
    }

    const chainIdToUse = chainIdOverride ?? parsed.chainId;

    const client = await getAdminClient();
    const result = await client.agents.refreshAgent(parsed.agentId, chainIdToUse);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: unknown) {
    console.error('Error refreshing agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to refresh agent',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

