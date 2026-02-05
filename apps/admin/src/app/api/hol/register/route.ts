export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, registerHolAgent } from '@agentic-trust/core/server';

const COOKIE_KEY = 'hol_rb_ledger_key';
const COOKIE_ACCOUNT = 'hol_rb_ledger_account';

export async function POST(request: NextRequest) {

  const body = await request.json().catch(() => null);
  const uaid = typeof body?.uaid === 'string' ? body.uaid.trim() : '';
  const endpointFromBody = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
  const communicationProtocol =
    typeof body?.communicationProtocol === 'string' && body.communicationProtocol.trim()
      ? body.communicationProtocol.trim()
      : 'a2a';


  if (!uaid.startsWith('uaid:')) {
    return NextResponse.json(
      { error: 'Invalid HOL UAID', message: 'Expected uaidHOL to start with "uaid:"' },
      { status: 400 },
    );
  }

  if (!endpointFromBody) {
    return NextResponse.json(
      {
        error: 'Missing endpoint',
        message: 'HOL registration requires an A2A endpoint. Provide `endpoint` in the request body.',
      },
      { status: 400 },
    );
  }

  try {
    if (/^(uaid:|did:)/i.test(endpointFromBody)) {
      throw new Error('Endpoint must be a URL (not a UAID/DID).');
    }
    const url = new URL(endpointFromBody);
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error(`Unsupported endpoint URL scheme "${url.protocol}"`);
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Invalid endpoint',
        message: e instanceof Error ? e.message : 'Endpoint must be a valid URL',
      },
      { status: 400 },
    );
  }

  // Pull best-effort agent details to enrich the registry entry.

  let agentName: string | null = null;
  let description: string | null = null;
  let image: string | null = null;
  let descriptorJson: unknown = null;
  const endpoint = endpointFromBody;
  try {
    const client = await getAgenticTrustClient();
    const agentDetail = await (client as any).getAgentDetailsByUaidUniversal?.(uaid, {
      includeRegistration: false,
      allowOnChain: false,
    });
    agentName = typeof agentDetail?.agentName === 'string' ? agentDetail.agentName : null;
    description = typeof agentDetail?.description === 'string' ? agentDetail.description : null;
    image = typeof agentDetail?.image === 'string' ? agentDetail.image : null;
    const raw = (agentDetail as any)?.identity8004DescriptorJson ?? (agentDetail as any)?.rawJson ?? null;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        descriptorJson = JSON.parse(raw);
      } catch {
        descriptorJson = raw;
      }
    }

    console.log('agentDetail', agentDetail);
    return


 

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
      uaid: uaid ?? '',
      endpoint,
      communicationProtocol,
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

