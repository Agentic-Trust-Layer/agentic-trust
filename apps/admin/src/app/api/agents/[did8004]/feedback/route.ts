export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';

const DID_PARAM_KEYS = ['did:8004', 'did8004', 'did꞉8004'] as const;

function getDidParam(params: Record<string, string | undefined>): string {
  for (const key of DID_PARAM_KEYS) {
    const value = params[key];
    if (value) {
      return decodeURIComponent(value);
    }
  }
  throw new Error('Missing did:8004 parameter');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Record<string, string | undefined> },
) {
  try {
    const agentDid = getDidParam(params);

    let parsed;
    try {
      parsed = parseDid8004(agentDid);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid 8004 DID';
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message },
        { status: 400 },
      );
    }

    const url = request.nextUrl;
    const searchParams = url.searchParams;

    const includeRevokedParam = searchParams.get('includeRevoked');
    const includeRevoked =
      includeRevokedParam === 'true' || includeRevokedParam === '1';

    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    const limit =
      typeof limitParam === 'string' && limitParam.trim().length > 0
        ? Number.parseInt(limitParam, 10)
        : 100; // default: fetch up to 100 feedback entries
    const offset =
      typeof offsetParam === 'string' && offsetParam.trim().length > 0
        ? Number.parseInt(offsetParam, 10)
        : 0;

    const client = await getAgenticTrustClient();

    const [feedback, summary] = await Promise.all([
      client.getAgentFeedback({
        agentId: parsed.agentId,
        chainId: parsed.chainId,
        includeRevoked,
        limit,
        offset,
      }),
      client.getReputationSummary({
        agentId: parsed.agentId,
        chainId: parsed.chainId,
      }).catch((error: unknown) => {
        console.warn(
          '[agents/[did:8004]/feedback] getReputationSummary failed:',
          error,
        );
        return null;
      }),
    ]);

    console.info("feedback", JSON.stringify(feedback, null, 2));

    const normalizedSummary =
      summary && typeof (summary as any).count === 'bigint'
        ? {
            count: (summary as any).count.toString(),
            averageScore: (summary as any).averageScore,
          }
        : summary;

    return NextResponse.json({
      agentDid,
      agentId: parsed.agentId,
      chainId: parsed.chainId,
      includeRevoked,
      feedback,
      summary: normalizedSummary,
    });
  } catch (error: unknown) {
    console.error('Error fetching agent feedback:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to fetch agent feedback',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 },
    );
  }
}


