export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAgenticTrustClient, fetchA2AAgentCard } from '@agentic-trust/core/server';

export async function GET(
  _request: Request,
  { params }: { params: { did8004: string } },
) {
  try {
    const rawParam = params.did8004;
    const did8004 = rawParam ? decodeURIComponent(rawParam) : null;

    if (!did8004) {
      return NextResponse.json(
        { error: 'Agent DID is required' },
        { status: 400 },
      );
    }

    const client = await getAgenticTrustClient();
    const agentDetail = await client.getAgentDetailsByDid(did8004);

    const a2aEndpoint =
      (agentDetail as Record<string, unknown>).a2aEndpoint ??
      (agentDetail as Record<string, unknown>).agentAccountEndpoint ??
      null;

    if (typeof a2aEndpoint !== 'string' || a2aEndpoint.length === 0) {
      return NextResponse.json(
        { error: 'Agent does not have an A2A endpoint configured' },
        { status: 404 },
      );
    }

    const card = await fetchA2AAgentCard(a2aEndpoint);
    if (!card) {
      return NextResponse.json(
        { error: 'Failed to fetch agent card from provider' },
        { status: 502 },
      );
    }

    return NextResponse.json({ card });
  } catch (error) {
    console.error('[Agents][card] Failed to load agent card:', error);
    return NextResponse.json(
      {
        error: 'Failed to load agent card',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}


