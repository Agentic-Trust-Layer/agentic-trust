export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDidEns } from '../../_lib/didEns';

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: { didens: string };
  },
) {
  try {
    const rawDidParam = params.didens;

    if (!rawDidParam) {
      return NextResponse.json(
        { error: 'Missing ENS DID parameter' },
        { status: 400 },
      );
    }

    let parsed;
    try {
      parsed = parseDidEns(decodeURIComponent(rawDidParam));
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid ENS DID';
      return NextResponse.json(
        { error: 'Invalid ENS DID', message },
        { status: 400 },
      );
    }

    const { ensName, chainId } = parsed;
    const client = await getAgenticTrustClient();
    const isAvailable = await client.isENSNameAvailable(ensName, chainId);

    if (isAvailable === null) {
      return NextResponse.json(
        {
          error: 'Failed to check ENS availability',
          message: 'Unable to determine availability',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ available: isAvailable });
  } catch (error) {
    console.error('Error checking ENS availability:', error);
    return NextResponse.json(
      {
        error: 'Failed to check ENS availability',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}


