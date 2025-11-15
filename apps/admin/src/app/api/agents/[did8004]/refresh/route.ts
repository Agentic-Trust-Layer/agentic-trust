import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { buildDid8004, parseDid8004 } from '@agentic-trust/core';

export async function POST(
  request: NextRequest,
  { params }: { params: { 'did:8004': string } }
) {
  try {
    let parsed;
    const rawDidParam = params['did:8004'];
    const decodedDidParam = decodeURIComponent(rawDidParam ?? '');
    try {
      parsed = parseDid8004(decodedDidParam);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid 8004 DID';
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message },
        { status: 400 },
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

    const client = await getAgenticTrustClient();
    const effectiveDid =
      chainIdToUse === parsed.chainId
        ? decodedDidParam
        : buildDid8004(chainIdToUse, parsed.agentId);

    const result = await client.agents.refreshAgentByDid(effectiveDid);

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
      { status: 500 },
    );
  }
}

