export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { parseDid8004 } from '@agentic-trust/core';
import { getAgentValidationsSummary } from '@agentic-trust/core/server';

/**
 * Convert BigInt values to strings for JSON serialization
 */
function serializeValidation(validation: any): any {
  if (!validation) {
    return null;
  }
  const result: any = {};
  for (const [key, value] of Object.entries(validation)) {
    if (typeof value === 'bigint') {
      result[key] = value.toString();
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ did8004: string }> },
) {
  try {
    const { did8004 } = await params;
    const parsed = parseDid8004(did8004);
    
    const searchParams = request.nextUrl.searchParams;
    const validatorAddress = searchParams.get('validatorAddress');
    
    if (!validatorAddress) {
      return NextResponse.json(
        { error: 'validatorAddress parameter is required' },
        { status: 400 },
      );
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(validatorAddress)) {
      return NextResponse.json(
        { error: 'Invalid validatorAddress format' },
        { status: 400 },
      );
    }

    // Get all validation requests for the agent
    const summary = await getAgentValidationsSummary(parsed.chainId, parsed.agentId);

    // Filter requests by validator address
    const allRequests = [...summary.pending, ...summary.completed];
    const matchingRequests = allRequests.filter(
      (req) => req.validatorAddress?.toLowerCase() === validatorAddress.toLowerCase()
    );

    // Return the most recent request (if any)
    const latestRequest = matchingRequests.length > 0 
      ? matchingRequests.sort((a, b) => {
          const aTime = typeof a.lastUpdate === 'bigint' ? Number(a.lastUpdate) : typeof a.lastUpdate === 'number' ? a.lastUpdate : 0;
          const bTime = typeof b.lastUpdate === 'bigint' ? Number(b.lastUpdate) : typeof b.lastUpdate === 'number' ? b.lastUpdate : 0;
          return bTime - aTime;
        })[0]
      : null;

    return NextResponse.json({
      validatorAddress,
      request: serializeValidation(latestRequest),
      totalRequests: matchingRequests.length,
    });
  } catch (error) {
    console.error('[API] Error fetching validation by validator:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch validation by validator',
      },
      { status: 500 },
    );
  }
}

