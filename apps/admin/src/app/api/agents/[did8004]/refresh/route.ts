export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { buildDid8004, parseDid8004 } from '@agentic-trust/core';

export async function POST(
  request: NextRequest,
  { params }: { params: Record<string, string> }
) {
  try {
    console.log('[api/agents/[did:8004]/refresh] raw params:', params);
    let parsed;
    const rawDidParam =
      params['did:8004'] ??
      // Some filesystems encode ":" as U+F03A (Private Use)
      params['did8004'] ??
      params['did%3A8004'] ??
      '';
    try {
      parsed = parseDid8004(rawDidParam);
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
    const canonicalDid = buildDid8004(parsed.chainId, parsed.agentId);

    const client = await getAgenticTrustClient();
    const effectiveDid =
      chainIdToUse === parsed.chainId
        ? canonicalDid
        : buildDid8004(chainIdToUse, parsed.agentId);

    console.log(
      '[api/agents/[did:8004]/refresh] refreshing DID:',
      effectiveDid,
      'chainId override:',
      chainIdOverride,
    );
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
