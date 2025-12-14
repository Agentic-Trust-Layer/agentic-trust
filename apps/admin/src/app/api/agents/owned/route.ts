export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDiscoveryClient } from '@agentic-trust/core/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const eoaAddress = searchParams.get('eoaAddress');
    const source = searchParams.get('source') || 'unknown';

    if (!eoaAddress) {
      return NextResponse.json(
        { error: 'eoaAddress parameter is required' },
        { status: 400 }
      );
    }

    if (typeof eoaAddress !== 'string' || !eoaAddress.startsWith('0x')) {
      return NextResponse.json(
        { error: 'Invalid EOA address format' },
        { status: 400 }
      );
    }

    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const orderBy = searchParams.get('orderBy') || 'agentId';
    const orderDirection = (searchParams.get('orderDirection') || 'DESC') as 'ASC' | 'DESC';

    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    const discoveryClient = await getDiscoveryClient();
    const agents = await discoveryClient.getOwnedAgents(eoaAddress, {
      limit,
      offset,
      orderBy: orderBy as 'agentId' | 'agentName' | 'createdAtTime' | 'createdAtBlock' | 'agentOwner' | 'eoaOwner',
      orderDirection,
    });

    const addrPreview =
      typeof eoaAddress === 'string' && eoaAddress.length > 10
        ? `${eoaAddress.slice(0, 6)}…${eoaAddress.slice(-4)}`
        : eoaAddress;
    console.info('[API][agents/owned]', { source, eoa: addrPreview, count: agents.length });

    return NextResponse.json({
      success: true,
      agents,
      total: agents.length,
    });
  } catch (error: any) {
    console.error('[API] Error fetching owned agents:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to fetch owned agents',
      },
      { status: 500 }
    );
  }
}

