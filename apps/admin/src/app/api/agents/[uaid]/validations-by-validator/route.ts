export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, getValidatorAddressValidations } from '@agentic-trust/core/server';

function parseDid8004(did: unknown): { chainId: number; agentId: string } | null {
  if (typeof did !== 'string') return null;
  const raw = did.trim();
  const m = /^did:8004:(\d+):(\d+)\b/.exec(raw);
  if (!m) return null;
  const chainId = Number(m[1]);
  const agentId = String(m[2]);
  if (!Number.isFinite(chainId) || chainId <= 0) return null;
  if (!/^\d+$/.test(agentId)) return null;
  return { chainId, agentId };
}

function serializeValidation(validation: any): any {
  return {
    ...validation,
    agentId: typeof validation?.agentId === 'bigint' ? validation.agentId.toString() : validation?.agentId,
    lastUpdate: typeof validation?.lastUpdate === 'bigint' ? validation.lastUpdate.toString() : validation?.lastUpdate,
  };
}

export async function GET(
  request: NextRequest,
  ctx: { params: { uaid: string } },
) {
  try {
    const uaid = decodeURIComponent(ctx.params.uaid);
    const validatorAddress = request.nextUrl.searchParams.get('validatorAddress');
    if (!validatorAddress) {
      return NextResponse.json({ error: 'validatorAddress is required' }, { status: 400 });
    }

    const client = await getAgenticTrustClient();
    const details = await (client as any).getAgentDetailsByUaidUniversal?.(uaid, {
      includeRegistration: false,
      allowOnChain: false,
    });
    if (!details) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Preferred: top-level chainId + agentId from universal details
    const chainId =
      typeof details?.chainId === 'number' && Number.isFinite(details.chainId) && details.chainId > 0
        ? (details.chainId as number)
        : null;
    const agentIdRaw = details?.agentId?.toString?.() ?? details?.agentId;
    const agentId = typeof agentIdRaw === 'string' && /^\d+$/.test(agentIdRaw) ? agentIdRaw : null;

    // Fallback: parse did:8004 identity when present
    const didIdentity = typeof details?.didIdentity === 'string' ? details.didIdentity : null;
    const parsed = parseDid8004(didIdentity);
    const finalChainId = chainId ?? parsed?.chainId ?? null;
    const finalAgentId = agentId ?? parsed?.agentId ?? null;

    if (!finalChainId || !finalAgentId) {
      return NextResponse.json(
        {
          error: 'Unsupported identifier',
          message: 'Could not resolve did:8004 identity for this UAID (validations are keyed by 8004 agentId).',
        },
        { status: 400 },
      );
    }

    const all = await getValidatorAddressValidations(finalChainId, validatorAddress);
    const filtered = (Array.isArray(all) ? all : []).filter((v: any) => {
      const vId = typeof v?.agentId === 'bigint' ? v.agentId.toString() : String(v?.agentId ?? '');
      return vId === finalAgentId;
    });

    return NextResponse.json({
      success: true,
      uaid,
      chainId: finalChainId,
      agentId: finalAgentId,
      validatorAddress,
      validations: filtered.map(serializeValidation),
    });
  } catch (error) {
    console.error('[api/agents/[uaid]/validations-by-validator] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load validations' },
      { status: 500 },
    );
  }
}

