export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import {
  getAgentValidationsSummary,
  getAgenticTrustClient,
  parseHcs14UaidDidTarget,
} from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';

export async function GET(request: Request, { params }: { params: { uaid: string } }) {
  void request;

  const serialize = (value: any): any => {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(serialize);
    if (value && typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
      return out;
    }
    return value;
  };

  const uaid = decodeURIComponent(String(params?.uaid ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'UAID is required (expected prefix "uaid:")' },
      { status: 400 },
    );
  }

  try {
    console.log('validations for uaid:', uaid);
    const { targetDid } = parseHcs14UaidDidTarget(uaid);
    const didMethod = String(targetDid.split(':')[1] ?? '').trim();

    // UAID-only policy:
    // - If UAID targets did:8004, query the ERC-8004 on-chain validation registry directly.
    // - If UAID targets did:ethr or a smart-account DID method, resolve to did:8004 via discovery,
    //   then query the ERC-8004 on-chain validation registry.
    // - Otherwise: loud error (unsupported kind).

    let did8004: string | null = null;

    if (didMethod === '8004') {
      console.log('validations for did:8004:', targetDid);
      did8004 = targetDid;
    } else {
      console.log('validations for did:ethr:', targetDid);
      const isResolvableKind =
        didMethod === 'ethr' || didMethod === 'pkh' || didMethod === 'erc4337' || didMethod === 'caip10';

      if (!isResolvableKind) {
        return NextResponse.json(
          {
            error: 'Unsupported UAID kind for validations',
            message: `UAID target DID method "${didMethod}" is not supported for on-chain validations.`,
            uaid,
            targetDid,
          },
          { status: 400 },
        );
      }

      const client = await getAgenticTrustClient();
      // getAgentDetailsByUaidUniversal will:
      // - upgrade to did:8004 if discovery provides didIdentity=did:8004
      // - otherwise return KB-only minimal details
      const details = await (client as any).getAgentDetailsByUaidUniversal?.(uaid, {
        includeRegistration: false,
      });

      const resolvedDidIdentity =
        details && typeof details === 'object' ? (details as any).didIdentity : null;

      if (typeof resolvedDidIdentity === 'string' && resolvedDidIdentity.startsWith('did:8004:')) {
        did8004 = resolvedDidIdentity;
      } else {
        return NextResponse.json(
          {
            error: 'UAID could not be resolved to did:8004 for validations',
            message:
              'This UAID is not a did:8004 UAID, and discovery did not provide a did:8004 identity to query the on-chain validation registry.',
            uaid,
            targetDid,
            discoveredDidIdentity: resolvedDidIdentity ?? null,
          },
          { status: 500 },
        );
      }
    }

    const { chainId, agentId } = parseDid8004(did8004);
    const summary = await getAgentValidationsSummary(chainId, agentId);

    return NextResponse.json(
      {
        pending: summary.pending.map(serialize),
        completed: summary.completed.map(serialize),
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load validations',
        message: error instanceof Error ? error.message : 'Unknown error',
        uaid,
      },
      { status: 500 },
    );
  }
}

