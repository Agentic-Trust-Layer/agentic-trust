export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';
import type { MessageRequest } from '@agentic-trust/core/server';
import { resolveDid8004FromUaid } from '../../_lib/uaid';

export async function POST(
  req: Request,
  { params }: { params: { uaid: string } }
) {
  try {
    const { did8004 } = resolveDid8004FromUaid(params.uaid);
    let parsed;
    try {
      parsed = parseDid8004(did8004);
    } catch {
      return NextResponse.json({ error: 'Invalid did:8004 format' }, { status: 400 });
    }

    const body = (await req.json()) as MessageRequest;

    if (!body.message && !body.payload && !body.skillId) {
      return NextResponse.json(
        { error: 'At least one of message, payload, or skillId is required' },
        { status: 400 },
      );
    }

    const client = await getAgenticTrustClient();
    const agent = await client.agents.getAgent(parsed.agentId.toString(), parsed.chainId);

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const response = await agent.sendMessage(body);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[Send Message API] Error:', error);
    const errorMessage = error?.message || 'Failed to send message';
    const isClientError =
      errorMessage.includes('Session package is required') ||
      errorMessage.includes('is required') ||
      errorMessage.includes('Invalid') ||
      errorMessage.includes('not found');

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: isClientError ? 400 : 500 },
    );
  }
}

