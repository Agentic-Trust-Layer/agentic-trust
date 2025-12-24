export async function POST(req: Request) {
  // NOTE:
  // This route intentionally does NOT send a transaction server-side.
  // It ONLY prepares an AgentOperationPlan (bundlerUrl + calls) for client-side AA execution.
  console.log('[API /associate] POST (prepare-only) request received');
  try {
    const { NextResponse } = await import('next/server');
    const { prepareAssociationRequest } = await import('@agentic-trust/core/server');

    const body = (await req.json()) as {
      did8004?: string; // initiator agent DID
      initiatorDid?: string; // alias for did8004
      initiatorAddress?: `0x${string}`;
      approverAddress?: string; // counterparty account address
      assocType?: number;
      description?: string;
      validAt?: number;
      data?: `0x${string}`;
      initiatorSignature?: `0x${string}`;
      approverSignature?: `0x${string}`;
      mode?: 'smartAccount' | 'eoa';

      // Back-compat fields from the previous server-send implementation:
      initiatorAddress?: string;
      approverAddressLegacy?: string;
    };

    const did8004 = (body.did8004 || body.initiatorDid || '').trim();
    const approverAddress = (body.approverAddress || '').trim();

    console.log('[API /associate] prepare payload:', {
      did8004,
      approverAddress,
      assocType: body.assocType,
      hasDescription: !!body.description,
      mode: body.mode,
      legacyProvided: {
        initiatorAddress: !!body.initiatorAddress,
        approverAddressLegacy: !!body.approverAddressLegacy,
      },
    });

    if (!did8004) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'did8004 (initiator DID) is required. This endpoint now prepares a client-side transaction; it no longer sends with ADMIN_PRIVATE_KEY.',
        },
        { status: 400 },
      );
    }
    if (!approverAddress) {
      return NextResponse.json({ ok: false, error: 'approverAddress is required' }, { status: 400 });
    }

    const plan = await prepareAssociationRequest(undefined, {
      did8004,
      initiatorAddress: body.initiatorAddress,
      approverAddress,
      assocType: body.assocType,
      description: body.description,
      validAt: body.validAt,
      data: body.data,
      initiatorSignature: body.initiatorSignature,
      approverSignature: body.approverSignature,
      mode: body.mode ?? 'smartAccount',
    });

    return NextResponse.json(plan);
  } catch (e: unknown) {
    const { NextResponse } = await import('next/server');
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[API /associate] prepare-only error:', e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


