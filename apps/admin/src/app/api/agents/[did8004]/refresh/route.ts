import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';
import { build8004Did, parse8004Did } from '@agentic-trust/core';

export async function POST(
  request: NextRequest,
  { params }: { params: { 'did:8004': string } }
) {
  try {
    let parsed;
    const didParam = params['did:8004'];
    try {
      parsed = parse8004Did(didParam);
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

    const client = await getAdminClient();
    const effectiveDid =
      chainIdToUse === parsed.chainId
        ? didParam
        : build8004Did(chainIdToUse, parsed.agentId);
    const refreshFn =
      typeof (client.agents as any).refreshAgentByDid === 'function'
        ? (client.agents as any).refreshAgentByDid.bind(client.agents)
        : async (did: string) => {
            const { agentId, chainId } = parse8004Did(did);
            return client.agents.refreshAgent(agentId, chainId);
          };

    const result = await refreshFn(effectiveDid);

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

