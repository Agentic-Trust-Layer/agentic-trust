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

function resolveDiscoveryEndpoint(): { endpoint: string; source: string } | null {
  const candidates = [
    { key: 'AGENTIC_TRUST_DISCOVERY_URL', value: process.env.AGENTIC_TRUST_DISCOVERY_URL },
    { key: 'NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_URL', value: process.env.NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_URL },
  ];
  const picked = candidates.find((c) => typeof c.value === 'string' && c.value.trim().length > 0) ?? null;
  const endpoint = normalizeDiscoveryUrl(picked?.value ?? null);
  if (!endpoint || !picked) return null;
  return { endpoint, source: picked.key };
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

    const resolved = resolveDiscoveryEndpoint();
    if (!resolved) {
      return NextResponse.json(
        {
          error:
            'Missing discovery URL. Set AGENTIC_TRUST_DISCOVERY_URL (preferred) or NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_URL.',
        },
        { status: 500 },
      );
    }

    const apiKey =
      (process.env.GRAPHQL_ACCESS_CODE || process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || '').trim() ||
      undefined;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Missing discovery access code. Set GRAPHQL_ACCESS_CODE (preferred) or AGENTIC_TRUST_DISCOVERY_API_KEY on the server.',
          endpoint: resolved.endpoint,
          endpointSource: resolved.source,
        },
        { status: 500 },
      );
    }

    const client = new AIAgentDiscoveryClient({ endpoint: resolved.endpoint, apiKey });
    const registries = await client.erc8122Registries({ chainId, first, skip });

    return NextResponse.json({
      ok: true,
      chainId,
      first,
      skip,
      registries,
    });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('[api/registries/8122] failed', error);
    return NextResponse.json(
      (() => {
        const msg = error?.message || 'Failed to fetch ERC-8122 registries';
        const hint =
          typeof msg === 'string' && msg.includes('Cannot return null for non-nullable field Query.kbErc8122Registries')
            ? 'Discovery backend resolver failed for kbErc8122Registries (server bug / not deployed / misconfigured).'
            : undefined;
        return { error: msg, hint };
      })(),
      { status: 500 },
    );
  }
}

