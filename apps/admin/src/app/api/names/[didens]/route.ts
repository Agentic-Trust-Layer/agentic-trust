import { NextRequest, NextResponse } from 'next/server';
import { isENSNameAvailable } from '@agentic-trust/core/server';
import { parseEnsDid } from '../_lib/ensDid';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ 'did:ens': string }> }
) {
  try {
    let parsed;
    try {
      parsed = parseEnsDid((await params)['did:ens']);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid ENS DID';
      return NextResponse.json(
        { error: 'Invalid ENS DID', message },
        { status: 400 }
      );
    }

    const { ensName, chainId } = parsed;

    const isAvailable = await isENSNameAvailable(ensName, chainId);

    if (isAvailable === null) {
      return NextResponse.json(
        {
          error: 'Failed to check ENS availability',
          message: 'Unable to determine availability',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      available: isAvailable,
    });
  } catch (error) {
    console.error('Error checking ENS availability:', error);
    return NextResponse.json(
      {
        error: 'Failed to check ENS availability',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
