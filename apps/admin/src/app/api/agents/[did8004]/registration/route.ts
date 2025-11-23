export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, uploadRegistration } from '@agentic-trust/core/server';
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

export async function PUT(
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

    const body = await request.json();
    const registrationRaw = body?.registration;

    if (!registrationRaw) {
      return NextResponse.json(
        { error: 'Missing registration payload in request body' },
        { status: 400 },
      );
    }

    let registration: unknown;
    if (typeof registrationRaw === 'string') {
      try {
        registration = JSON.parse(registrationRaw);
      } catch (error) {
        return NextResponse.json(
          {
            error: 'Invalid registration JSON string',
            message: error instanceof Error ? error.message : 'Failed to parse JSON',
          },
          { status: 400 },
        );
      }
    } else if (typeof registrationRaw === 'object') {
      registration = registrationRaw;
    } else {
      return NextResponse.json(
        { error: 'registration must be a JSON object or stringified JSON' },
        { status: 400 },
      );
    }

    // Upload updated registration JSON to IPFS using core helper
    const uploadResult = await uploadRegistration(registration as any);

    // Prepare agent update calls via AgenticTrustClient (client-side AA/bundler execution)
    const client = await getAgenticTrustClient();
    const prepared = await (client as any).prepareUpdateAgent({
      agentId: parsed.agentId,
      chainId: parsed.chainId,
      tokenUri: uploadResult.tokenUri,
    });

    const jsonSafeCalls = (prepared.calls || []).map((call: any) => ({
      to: call.to as string,
      data: call.data as string,
      value:
        typeof call.value === 'bigint'
          ? call.value.toString()
          : call.value ?? '0',
    }));

    return NextResponse.json({
      success: true,
      cid: uploadResult.cid,
      tokenUri: uploadResult.tokenUri,
      chainId: prepared.chainId,
      identityRegistry: prepared.identityRegistry,
      bundlerUrl: prepared.bundlerUrl,
      calls: jsonSafeCalls,
    });
  } catch (error: unknown) {
    console.error('Error updating agent registration:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to update agent registration',
        message,
        details: process.env.NODE_ENV === 'development' ? stack : undefined,
      },
      { status: 500 },
    );
  }
}


