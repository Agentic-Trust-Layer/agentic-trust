export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { AIAgentDiscoveryClient } from '@agentic-trust/8004-ext-sdk';

function normalizeDiscoveryUrl(value: string | undefined | null): string | null {
  const raw = (value || '').toString().trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (/\/graphql-kb$/i.test(raw)) return raw;
  if (/\/graphql$/i.test(raw)) return raw.replace(/\/graphql$/i, '/graphql-kb');
  return `${raw}/graphql-kb`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const chainId = typeof body.chainId === 'number' ? Math.floor(body.chainId) : Number.NaN;
    const first =
      typeof body.first === 'number' && Number.isFinite(body.first) && body.first > 0
        ? Math.floor(body.first)
        : 50;
    const skip =
      typeof body.skip === 'number' && Number.isFinite(body.skip) && body.skip >= 0
        ? Math.floor(body.skip)
        : 0;

    if (!Number.isFinite(chainId)) {
      return NextResponse.json({ error: 'chainId is required (number)' }, { status: 400 });
    }

    const endpoint = normalizeDiscoveryUrl(process.env.AGENTIC_TRUST_DISCOVERY_URL);
    if (!endpoint) {
      return NextResponse.json({ error: 'Missing AGENTIC_TRUST_DISCOVERY_URL' }, { status: 500 });
    }

    const apiKey =
      (process.env.GRAPHQL_ACCESS_CODE || process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || '').trim() ||
      undefined;

    const client = new AIAgentDiscoveryClient({
      endpoint,
      apiKey,
    });

    const registries = await client.erc8122Registries({
      chainId,
      first,
      skip,
    });

    return NextResponse.json({
      ok: true,
      chainId,
      first,
      skip,
      registries,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch ERC-8122 registries' },
      { status: 500 },
    );
  }
}

