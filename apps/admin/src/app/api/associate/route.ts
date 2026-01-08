export async function POST(req: Request) {
  // NOTE:
  // This route intentionally does NOT send a transaction server-side.
  // It ONLY prepares an AgentOperationPlan (bundlerUrl + calls) for client-side AA execution.
  console.log('[API /associate] POST (prepare-only) request received');
  try {
    const { NextResponse } = await import('next/server');
    const { prepareAssociationRequest, getAssociationsClient } = await import('@agentic-trust/core/server');
    const { parseDid8004 } = await import('@agentic-trust/core');
    const { getAssociationsProxyAddress } = await import('../../../lib/config');

    const jsonSafe = (value: any): any => {
      if (typeof value === 'bigint') return value.toString();
      if (Array.isArray(value)) return value.map(jsonSafe);
      if (value && typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
        return out;
      }
      return value;
    };

    const normalizeDid = (input: unknown): string => {
      const raw = String(input ?? '').trim();
      if (!raw) return '';
      let out = raw;
      for (let i = 0; i < 2; i++) {
        try {
          const decoded = decodeURIComponent(out);
          if (decoded === out) break;
          out = decoded;
        } catch {
          break;
        }
      }
      return out.replace(/%3A/gi, ':');
    };

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
      approverAddressLegacy?: string;

      // Optional: provide a fully-built SignedAssociationRecord (SAR) to avoid server-side re-computation
      // of the record digest (helps prevent mismatches across different formatEvmV1 implementations).
      sar?: any;
    };

    const did8004 = normalizeDid(body.did8004 || body.initiatorDid || '');
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
    const parsed = (() => {
      try {
        return parseDid8004(did8004);
      } catch (e: any) {
        return null;
      }
    })();
    if (!parsed) {
      return NextResponse.json({ ok: false, error: 'Invalid did8004' }, { status: 400 });
    }

    // If SAR is provided, prepare the tx directly from it (no recomputation).
    if (body.sar) {
      // Normalize SAR: JSON.parse converts BigInt to string, so we need to convert uint40 fields back to numbers.
      // Also ensure bytes fields are proper hex strings.
      const normalizeSar = (sar: any): any => {
        if (!sar || typeof sar !== 'object') return sar;
        return {
          ...sar,
          revokedAt: typeof sar.revokedAt === 'string' ? Number(sar.revokedAt) : (typeof sar.revokedAt === 'number' ? sar.revokedAt : 0),
          validAt: typeof sar.validAt === 'string' ? Number(sar.validAt) : (typeof sar.validAt === 'number' ? sar.validAt : 0),
          validUntil: typeof sar.validUntil === 'string' ? Number(sar.validUntil) : (typeof sar.validUntil === 'number' ? sar.validUntil : 0),
          record: sar.record ? {
            ...sar.record,
            validAt: typeof sar.record.validAt === 'string' ? Number(sar.record.validAt) : (typeof sar.record.validAt === 'number' ? sar.record.validAt : 0),
            validUntil: typeof sar.record.validUntil === 'string' ? Number(sar.record.validUntil) : (typeof sar.record.validUntil === 'number' ? sar.record.validUntil : 0),
          } : sar.record,
        };
      };
      const normalizedSar = normalizeSar(body.sar);
      console.log('[API /associate] Normalized SAR:', {
        revokedAt: normalizedSar.revokedAt,
        recordValidAt: normalizedSar.record?.validAt,
        recordValidUntil: normalizedSar.record?.validUntil,
        hasRecord: !!normalizedSar.record,
      });

      // Use admin app's association proxy address instead of core's
      const associationsProxyAddress = getAssociationsProxyAddress();
      console.log('[API /associate] Using associations proxy address:', associationsProxyAddress);

      // Create associations client with admin's proxy address
      const associationsClient = await (async () => {
        const { AIAgentAssociationClient } = await import('@agentic-trust/8004-ext-sdk');
        const { getChainRpcUrl } = await import('@agentic-trust/core/server');
        const { encodeFunctionData } = await import('viem');

        const rpcUrl = getChainRpcUrl(parsed.chainId);
        if (!rpcUrl) throw new Error(`No RPC URL for chain ${parsed.chainId}`);

        // Create a minimal AccountProvider for read-only operations
        const accountProvider = {
          chain: () => ({ id: parsed.chainId, rpcUrl }),
          encodeFunctionData: async (params: any) => {
            return encodeFunctionData(params) as any;
          },
          send: async () => { throw new Error('Not implemented'); },
        };

        return AIAgentAssociationClient.create(accountProvider as any, associationsProxyAddress as `0x${string}`);
      })();

      console.log('[API /associate] About to prepare tx with SAR:', {
        associationId: normalizedSar.associationId,
        initiatorAddress: normalizedSar.initiatorAddress,
        approverAddress: normalizedSar.approverAddress,
        revokedAt: normalizedSar.revokedAt,
        initiatorKeyType: normalizedSar.initiatorKeyType,
        approverKeyType: normalizedSar.approverKeyType,
        hasInitiatorSig: !!(normalizedSar.initiatorSignature && normalizedSar.initiatorSignature !== '0x'),
        hasApproverSig: !!(normalizedSar.approverSignature && normalizedSar.approverSignature !== '0x'),
        recordValidAt: normalizedSar.record?.validAt,
        recordValidUntil: normalizedSar.record?.validUntil,
        recordDataLength: normalizedSar.record?.data?.length,
      });
      const { txRequest } = await associationsClient.prepareStoreAssociationTx({ sar: normalizedSar } as any);
      console.log('[API /associate] Prepared txRequest:', {
        to: txRequest.to,
        dataLength: txRequest.data?.length,
        value: txRequest.value,
      });
      const mode = body.mode ?? 'smartAccount';
      if (mode === 'eoa') {
        return NextResponse.json(jsonSafe({
          success: true,
          operation: 'update',
          mode: 'eoa',
          chainId: parsed.chainId,
          calls: [],
          bundlerUrl: undefined,
          transaction: {
            to: txRequest.to,
            data: txRequest.data,
            value: txRequest.value ?? BigInt(0),
            chainId: parsed.chainId,
          },
          metadata: { kind: 'erc8092.storeAssociation' },
        }));
      }
      return NextResponse.json(jsonSafe({
        success: true,
        operation: 'update',
        mode: 'smartAccount',
        chainId: parsed.chainId,
        bundlerUrl: undefined,
        calls: [
          {
            to: txRequest.to,
            data: txRequest.data,
            value: txRequest.value ?? 0n,
          },
        ],
        transaction: undefined,
        metadata: { kind: 'erc8092.storeAssociation' },
      }));
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


