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

    const accessCode = (process.env.GRAPHQL_ACCESS_CODE || process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || '').trim();
    if (!accessCode) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Missing discovery access code. Set GRAPHQL_ACCESS_CODE (preferred) or AGENTIC_TRUST_DISCOVERY_API_KEY.',
        },
        { status: 500 },
      );
    }

    const discoveryClient = await getDiscoveryClient({ apiKey: accessCode });
    const agents = await discoveryClient.getOwnedAgents(eoaAddress, {
      limit,
      offset,
      orderBy: orderBy as
        | 'agentId'
        | 'agentName'
        | 'createdAtTime'
        | 'createdAtBlock'
        | 'agentIdentityOwnerAccount'
        | 'eoaAgentIdentityOwnerAccount'
        | 'eoaAgentAccount'
        | 'agentCategory'
        | 'trustLedgerScore'
        | 'trustLedgerBadgeCount'
        | 'trustLedgerOverallRank'
        | 'trustLedgerCapabilityRank',
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
    const message = String(error?.message ?? '');
    const isKbOwnedAgentsNull =
      message.includes('kbOwnedAgentsAllChains') &&
      message.includes('Cannot return null for non-nullable field');

    return NextResponse.json(
      {
        success: false,
        error: isKbOwnedAgentsNull
          ? 'Discovery backend error: kbOwnedAgentsAllChains returned null for a non-nullable field. Fix KB resolver to return {agents:[], total:0, hasMore:false} instead of null.'
          : (error?.message || 'Failed to fetch owned agents'),
      },
      { status: isKbOwnedAgentsNull ? 502 : 500 }
    );
  }
}

