export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDiscoveryClient } from '@agentic-trust/core/server';

export async function GET(_request: Request, { params }: { params: { uaid: string } }) {
  const uaid = decodeURIComponent(String(params?.uaid ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'UAID is required (expected prefix "uaid:")' },
      { status: 400 },
    );
  }

  try {
    const discovery = await getDiscoveryClient();
    const agent = await (discovery as any).getAgentByUaidFull?.(uaid);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found in discovery', uaid },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        uaid,
        rawJson: typeof (agent as any).rawJson === 'string' ? (agent as any).rawJson : null,
        onchainMetadataJson:
          typeof (agent as any).onchainMetadataJson === 'string' ? (agent as any).onchainMetadataJson : null,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load agent descriptor from discovery',
        message: error instanceof Error ? error.message : 'Unknown error',
        uaid,
      },
      { status: 500 },
    );
  }
}

