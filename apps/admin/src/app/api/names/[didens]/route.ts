export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';
import { parseDidEns } from '../_lib/didEns';

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: { [key: string]: string | undefined };
  },
) {
  try {
    const rawDidParam =
      params['did:ens'] ??
      params['didens'] ??
      params['did꞉ens']; // handle private-use colon fallbacks

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
        { status: 400 }
      );
    }

    const { ensName, chainId } = parsed;
    const client = await getAgenticTrustClient();
    const nameInfo = await client.getENSInfo(ensName, chainId);
    return NextResponse.json({ nameInfo });
  } catch (error) {
    console.error('Error fetching ENS name info:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch ENS name info',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}