import { NextRequest, NextResponse } from 'next/server';
import { getServerCounterfactualAAAddressByAgentName } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentName, chainId } = body ?? {};
    if (!agentName || typeof agentName !== 'string') {
      return NextResponse.json({ error: 'agentName is required' }, { status: 400 });
    }
    const address = await getServerCounterfactualAAAddressByAgentName(agentName, chainId ? Number(chainId) : undefined);
    return NextResponse.json({ address });
  } catch (error) {
    console.error('Error computing server AA address:', error);
    return NextResponse.json(
      { error: 'Failed to compute AA address', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


