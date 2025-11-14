import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { getENSClient, buildAgentDetail, DEFAULT_CHAIN_ID } from '@agentic-trust/core/server';
import { getAdminClient } from '@/lib/server/adminClient';

export const dynamic = 'force-dynamic';

type Params = { 'did:ethr': string };

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
    const rawParam = params['did:ethr'];
    const { chainId: initialChainId, account } = parseDidEthr(rawParam);

    let chainId = initialChainId;
    let agentId: string | null = null;

    try {
      const ensClient = await getENSClient(chainId);
      const identity = await ensClient.getAgentIdentityByAccount(account);
      if (identity?.agentId) {
        agentId = identity.agentId.toString();
      }
    } catch (error) {
      console.warn('Reverse ENS lookup by account failed:', error);
    }

    const adminClient = await getAdminClient();

    if (!agentId) {
      try {
        const searchResult = await adminClient.agents.searchAgents({
          query: account,
          page: 1,
          pageSize: 1,
        });

        const candidate = searchResult.agents?.[0];
        if (candidate && typeof candidate === 'object') {
          const candidateObject = candidate as unknown as Record<string, unknown>;
          const candidateDataRaw = candidateObject.data;
          const candidateData =
            candidateDataRaw && typeof candidateDataRaw === 'object'
              ? (candidateDataRaw as Record<string, unknown>)
              : null;

          const candidateAgentIdValue =
            candidateData && candidateData.agentId !== undefined
              ? candidateData.agentId
              : candidateObject.agentId;

          if (candidateAgentIdValue !== undefined && candidateAgentIdValue !== null) {
            if (typeof candidateAgentIdValue === 'bigint') {
              agentId = candidateAgentIdValue.toString();
            } else if (
              typeof candidateAgentIdValue === 'number' &&
              Number.isFinite(candidateAgentIdValue)
            ) {
              agentId = Math.trunc(candidateAgentIdValue).toString();
            } else if (
              typeof candidateAgentIdValue === 'string' &&
              candidateAgentIdValue.trim().length > 0
            ) {
              agentId = candidateAgentIdValue.trim();
            }
          }

          const candidateChainId =
            candidateData && typeof candidateData.chainId === 'number'
              ? candidateData.chainId
              : undefined;
          if ((!chainId || Number.isNaN(chainId)) && typeof candidateChainId === 'number') {
            chainId = candidateChainId;
          }
        }
      } catch (error) {
        console.warn('Discovery search by account failed:', error);
      }
    }

    if (!agentId) {
      return NextResponse.json(
        {
          error: 'Agent not found for account',
          account,
          did: decodeURIComponent(params['did:ethr']),
        },
        { status: 404 },
      );
    }

    const effectiveChainId =
      Number.isFinite(chainId) && chainId > 0 ? chainId : DEFAULT_CHAIN_ID;

    const payload = await buildAgentDetail(adminClient as any, agentId, effectiveChainId);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error resolving agent by DID:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to resolve agent by account', message },
      { status: 400 },
    );
  }
}

