import { NextRequest, NextResponse } from 'next/server';
import { buildAgentRecord } from '../_lib/agentRecord';
import { parseAgentDid } from '../_lib/agentDid';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ 'did:agent': string }> }
) {
  try {
    const { 'did:agent': didAgent } = await params;
    let parsed;
    try {
      parsed = parseAgentDid(didAgent);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid agent DID';
      return NextResponse.json(
        { error: 'Invalid agent DID', message },
        { status: 400 }
      );
    }

    const { agentId, chainId } = parsed;

    const payload = await buildAgentRecord(agentId, chainId);

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error in get agent info route:', error);
    return NextResponse.json(
      {
        error: 'Failed to get agent information',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

