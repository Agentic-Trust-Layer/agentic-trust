export const dynamic = 'force-dynamic';

import {
  directFeedbackRouteHandler,
  getAgenticTrustClient,
  parseHcs14UaidDidTarget,
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
    throw new Error(`Unsupported UAID kind for feedback-direct (target DID method "${didMethod}")`);
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
    'UAID could not be resolved to did:8004 for feedback-direct (discovery did not provide didIdentity=did:8004:...)',
  );
}

const handler = directFeedbackRouteHandler();

export async function POST(request: Request, { params }: { params: { uaid: string } }) {
  const uaid = decodeURIComponent(String(params?.uaid ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'UAID is required (expected prefix "uaid:")' },
      { status: 400 },
    );
  }

  try {
    const did8004 = await resolveErc8004DidForUaid(uaid);
    return handler(request, { params: { did8004 } });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to submit direct feedback',
        message: error instanceof Error ? error.message : 'Unknown error',
        uaid,
      },
      { status: 500 },
    );
  }
}

