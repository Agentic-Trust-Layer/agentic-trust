import { NextRequest, NextResponse } from 'next/server';
import { getAccountOwnerByDidPkh, parsePkhDid } from '@agentic-trust/core/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ 'did:pkh': string }> }
) {
  try {
    const didPkh = (await params)['did:pkh'];
    
    let parsed;
    try {
      parsed = parsePkhDid(didPkh);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid PKH DID';
      return NextResponse.json(
        { error: 'Invalid PKH DID', message },
        { status: 400 }
      );
    }

    const { account, chainId } = parsed;

    const owner = await getAccountOwnerByDidPkh(didPkh);

    if (owner === null) {
      return NextResponse.json(
        {
          error: 'Account owner not found',
          message: 'Unable to retrieve owner for the given account address',
          account,
          chainId,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      owner,
      account,
      chainId,
    });
  } catch (error) {
    console.error('Error getting account owner:', error);
    return NextResponse.json(
      {
        error: 'Failed to get account owner',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

