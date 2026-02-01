export const dynamic = 'force-dynamic';

import {
  getAgenticTrustClient,
  getFeedbackRouteHandler,
  parseHcs14UaidDidTarget,
  prepareFeedbackRouteHandler,
} from '@agentic-trust/core/server';
import { NextResponse } from 'next/server';

async function resolveErc8004DidForUaid(uaid: string): Promise<string> {
  const { targetDid } = parseHcs14UaidDidTarget(uaid);
  const didMethod = String(targetDid.split(':')[1] ?? '').trim();

  if (didMethod === '8004') {
    return targetDid;
  }

  const isResolvableKind =
    didMethod === 'ethr' || didMethod === 'pkh' || didMethod === 'erc4337' || didMethod === 'caip10';

  if (!isResolvableKind) {
    throw new Error(`Unsupported UAID kind for feedback (target DID method "${didMethod}")`);
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
    'UAID could not be resolved to did:8004 for feedback (discovery did not provide didIdentity=did:8004:...)',
  );
}

const getHandler = getFeedbackRouteHandler();
const postHandler = prepareFeedbackRouteHandler();

export async function GET(request: Request, { params }: { params: { uaid: string } }) {
  const uaid = decodeURIComponent(String(params?.uaid ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'UAID is required (expected prefix "uaid:")' },
      { status: 400 },
    );
  }

  try {
    // UAID-first: pass UAID through to core. Core will resolve to did8004 only when needed
    // (e.g. on-chain 8004 SDK / reputation summary), and will use UAID for KB reads.
    return getHandler(request, { params: { uaid } as any });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load feedback',
        message: error instanceof Error ? error.message : 'Unknown error',
        uaid,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: { params: { uaid: string } }) {
  const uaid = decodeURIComponent(String(params?.uaid ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'UAID is required (expected prefix "uaid:")' },
      { status: 400 },
    );
  }

  try {
    // POST prepares an ERC-8004 transaction (8004 SDK boundary), so we resolve UAID -> did:8004 here.
    const did8004 = await resolveErc8004DidForUaid(uaid);
    return postHandler(request, { params: { did8004 } });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to prepare feedback',
        message: error instanceof Error ? error.message : 'Unknown error',
        uaid,
      },
      { status: 500 },
    );
  }
}

