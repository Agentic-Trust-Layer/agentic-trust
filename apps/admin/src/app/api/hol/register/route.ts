export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, registerHolAgent } from '@agentic-trust/core/server';

const COOKIE_KEY = 'hol_rb_ledger_key';
const COOKIE_ACCOUNT = 'hol_rb_ledger_account';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const uaidHOL = typeof body?.uaidHOL === 'string' ? body.uaidHOL.trim() : '';
    const endpointFromBody = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    const communicationProtocol =
      typeof body?.communicationProtocol === 'string' && body.communicationProtocol.trim()
        ? body.communicationProtocol.trim()
        : 'a2a';
    const additionalRegistries = Array.isArray(body?.additionalRegistries)
      ? (body.additionalRegistries as unknown[]).filter((v) => typeof v === 'string') as string[]
      : null;

    if (!uaidHOL.startsWith('uaid:')) {
      return NextResponse.json(
        { error: 'Invalid HOL UAID', message: 'Expected uaidHOL to start with "uaid:"' },
        { status: 400 },
      );
    }

    // Pull best-effort agent details to enrich the registry entry.
    let agentName: string | null = null;
    let description: string | null = null;
    let image: string | null = null;
    let descriptorJson: unknown = null;
    let endpoint: string | null = endpointFromBody || null;
    try {
      const client = await getAgenticTrustClient();
      const detail = await (client as any).getAgentDetailsByUaidUniversal?.(uaidHOL, {
        includeRegistration: false,
        allowOnChain: false,
      });
      agentName = typeof detail?.agentName === 'string' ? detail.agentName : null;
      description = typeof detail?.description === 'string' ? detail.description : null;
      image = typeof detail?.image === 'string' ? detail.image : null;
      if (!endpoint && typeof (detail as any)?.a2aEndpoint === 'string' && (detail as any).a2aEndpoint.trim()) {
        endpoint = String((detail as any).a2aEndpoint).trim();
      }
      const raw = (detail as any)?.identity8004DescriptorJson ?? (detail as any)?.rawJson ?? null;
      if (typeof raw === 'string' && raw.trim()) {
        try {
          descriptorJson = JSON.parse(raw);
        } catch {
          descriptorJson = raw;
        }
      }
    } catch {
      // best-effort only; allow UAID-only registration attempt
    }
    if (!endpoint) {
      return NextResponse.json(
        {
          error: 'Missing endpoint',
          message: 'HOL registration requires an A2A endpoint. Provide `endpoint` or ensure the agent has `a2aEndpoint` in details.',
        },
        { status: 400 },
      );
    }

    const ledgerKey = request.cookies.get(COOKIE_KEY)?.value ?? '';
    const ledgerAccountId = request.cookies.get(COOKIE_ACCOUNT)?.value ?? '';
    if (!ledgerKey || !ledgerAccountId) {
      return NextResponse.json(
        {
          error: 'Not authenticated with Hashpack',
          message: 'Connect Hashpack and authenticate ledger signing before registering to HOL.',
        },
        { status: 401 },
      );
    }
    const result = await registerHolAgent({
      uaidHOL,
      endpoint,
      communicationProtocol,
      additionalRegistries: additionalRegistries ?? undefined,
      name: agentName ?? undefined,
      description: description ?? undefined,
      image: image ?? undefined,
      descriptor: descriptorJson ?? undefined,
      ledgerKey,
      ledgerAccountId,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'HOL registration failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

