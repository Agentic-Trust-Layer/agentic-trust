export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, parseHcs14UaidDidTarget } from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';

async function resolveErc8004DidForUaid(uaid: string): Promise<string> {
  const { targetDid } = parseHcs14UaidDidTarget(uaid);
  const didMethod = String(targetDid.split(':')[1] ?? '').trim();

  if (didMethod === '8004') {
    return targetDid;
  }

  const isResolvableKind =
    didMethod === 'ethr' || didMethod === 'pkh' || didMethod === 'erc4337' || didMethod === 'caip10';

  if (!isResolvableKind) {
    throw new Error(`Unsupported UAID kind for validation-responses (target DID method "${didMethod}")`);
  }

  const client = await getAgenticTrustClient();
  const details = await (client as any).getAgentDetailsByUaidUniversal?.(uaid, {
    includeRegistration: false,
  });

  const resolvedDidIdentity = details && typeof details === 'object' ? (details as any).didIdentity : null;
  if (typeof resolvedDidIdentity === 'string' && resolvedDidIdentity.startsWith('did:8004:')) {
    return resolvedDidIdentity;
  }

  throw new Error(
    'UAID could not be resolved to did:8004 for validation-responses (discovery did not provide didIdentity=did:8004:...)',
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  const uaid = decodeURIComponent(String(params?.uaid ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'UAID is required (expected prefix "uaid:")' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get('limit');
  const offsetRaw = url.searchParams.get('offset');
  const orderBy = url.searchParams.get('orderBy') ?? undefined;
  const orderDirectionRaw = url.searchParams.get('orderDirection') ?? undefined;

  const limit = limitRaw != null ? Number(limitRaw) : undefined;
  const offset = offsetRaw != null ? Number(offsetRaw) : undefined;
  const orderDirection = orderDirectionRaw === 'ASC' || orderDirectionRaw === 'DESC' ? orderDirectionRaw : undefined;

  try {
    const did8004 = await resolveErc8004DidForUaid(uaid);
    const { chainId, agentId } = parseDid8004(did8004);

    const client = await getAgenticTrustClient();
    const result = await (client as any).searchValidationRequestsAdvanced?.({
      chainId,
      agentId,
      limit: Number.isFinite(limit as number) ? (limit as number) : undefined,
      offset: Number.isFinite(offset as number) ? (offset as number) : undefined,
      orderBy,
      orderDirection,
    });

    return NextResponse.json(
      {
        validationRequests: Array.isArray(result?.validationRequests) ? result.validationRequests : [],
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load validation responses',
        message: error instanceof Error ? error.message : 'Unknown error',
        uaid,
      },
      { status: 500 },
    );
  }
}

