import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { DEFAULT_CHAIN_ID, getAgenticTrustClient } from '@agentic-trust/core/server';

export const dynamic = 'force-dynamic';

type Params = { didethr: string };

function parseDidEthr(raw: string): { chainId: number; account: `0x${string}` } {
  const decoded = decodeURIComponent(raw || '').trim();
  if (!decoded) {
    throw new Error('Missing DID parameter');
  }

  if (!decoded.startsWith('did:ethr:')) {
    throw new Error('Unsupported DID format. Expected did:ethr:...');
  }

  const segments = decoded.split(':');
  const accountCandidate = segments[segments.length - 1];
  if (!accountCandidate || !accountCandidate.startsWith('0x')) {
    throw new Error('DID is missing account component');
  }

  const remaining = segments.slice(2, -1);
  let chainId: number = DEFAULT_CHAIN_ID;

  for (let i = remaining.length - 1; i >= 0; i -= 1) {
    const value = remaining[i];
    if (value && /^\d+$/.test(value)) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        chainId = parsed;
        break;
      }
    }
  }

  const account = accountCandidate as `0x${string}`;
  if (!isAddress(account)) {
    throw new Error('Invalid account address in DID');
  }

  return { chainId, account };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const rawParam = params.didethr;
    const { chainId: initialChainId, account } = parseDidEthr(rawParam);

    const atp = await getAgenticTrustClient();

    const agentInfo = await atp.getAgentByAccount(account, initialChainId);

    if (!agentInfo) {
      return NextResponse.json(
        {
          error: 'Agent not found for account',
          account,
          did: decodeURIComponent(rawParam),
        },
        { status: 404 },
      );
    }

    return NextResponse.json(agentInfo);
  } catch (error) {
    console.error('Error resolving agent by DID:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to resolve agent by account', message },
      { status: 400 },
    );
  }
}


