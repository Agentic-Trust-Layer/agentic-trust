export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

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

function parseAgentIdFromUaid(uaid: string): string {
  const raw = String(uaid || '').trim();
  const did8004 = /^uaid:did:8004:(\d+):(\d+)$/.exec(raw);
  if (did8004) {
    return did8004[2];
  }
  const marker = ';nativeId=';
  const idx = raw.indexOf(marker);
  if (idx !== -1) {
    const start = idx + marker.length;
    const tail = raw.slice(start);
    const end = tail.indexOf(';');
    const nativeId = (end === -1 ? tail : tail.slice(0, end)).trim();
    if (nativeId) {
      // If nativeId is a DID, prefer the trailing numeric segment (e.g. did:8122:...:<agentId>).
      const parts = nativeId.split(':').filter(Boolean);
      const last = parts.length > 0 ? parts[parts.length - 1] : '';
      if (/^\d+$/.test(last)) return last;
      return nativeId;
    }
  }
  return raw;
}

type KbRankedAgentsResponse = {
  kbAgents?: {
    total?: number | null;
    hasMore?: boolean | null;
    agents?: Array<{
      iri?: string | null;
      uaid?: string | null;
      agentName?: string | null;
      agentDescription?: string | null;
      agentImage?: string | null;
      agentTypes?: string[] | null;
      createdAtTime?: number | null;
      updatedAtTime?: number | null;
      trustLedgerTotalPoints?: number | null;
      trustLedgerBadgeCount?: number | null;
      trustLedgerComputedAt?: number | null;
      trustLedgerBadges?: Array<{
        iri?: string | null;
        awardedAt?: number | null;
        definition?: {
          badgeId?: string | null;
          name?: string | null;
          iconRef?: string | null;
          points?: number | null;
        } | null;
      }> | null;
      atiOverallScore?: number | null;
      atiOverallConfidence?: number | null;
      atiVersion?: string | null;
      atiComputedAt?: number | null;
    }> | null;
  } | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const chainId = typeof body.chainId === 'number' ? Math.floor(body.chainId) : Number.NaN;
    const first = typeof body.pageSize === 'number' && Number.isFinite(body.pageSize) && body.pageSize > 0
      ? Math.floor(body.pageSize)
      : 18;
    const page = typeof body.page === 'number' && Number.isFinite(body.page) && body.page > 0
      ? Math.floor(body.page)
      : 1;
    const skip = Math.max(0, (page - 1) * first);

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
      (process.env.GRAPHQL_ACCESS_CODE || process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || '').trim();
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

    const query = `
      query KbRankedAgents($chainId: Int!, $first: Int!, $skip: Int!) {
        kbAgents(
          where: { chainId: $chainId }
          first: $first
          skip: $skip
          orderBy: bestRank
          orderDirection: DESC
        ) {
          total
          hasMore
          agents {
            iri
            uaid
            agentName
            agentDescription
            agentImage
            agentTypes
            createdAtTime
            updatedAtTime

            trustLedgerTotalPoints
            trustLedgerBadgeCount
            trustLedgerComputedAt
            trustLedgerBadges {
              iri
              awardedAt
              definition {
                badgeId
                name
                iconRef
                points
              }
            }

            atiOverallScore
            atiOverallConfidence
            atiVersion
            atiComputedAt
          }
        }
      }
    `;

    const res = await fetch(resolved.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        query,
        variables: { chainId, first, skip },
      }),
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      return NextResponse.json(
        { error: json?.error || json?.message || `Ranked agents query failed (${res.status})` },
        { status: 502 },
      );
    }
    if (json?.errors?.length) {
      return NextResponse.json(
        { error: json.errors?.[0]?.message || 'Ranked agents query failed (GraphQL error)' },
        { status: 502 },
      );
    }

    const data = (json?.data ?? {}) as KbRankedAgentsResponse;
    const payload = data.kbAgents;
    const list = Array.isArray(payload?.agents) ? payload?.agents : [];
    const total =
      typeof payload?.total === 'number' && Number.isFinite(payload.total) ? payload.total : list.length;

    const agents = list.map((a, idx) => {
      const uaid = typeof a?.uaid === 'string' ? a.uaid : null;
      const derivedAgentId = uaid ? parseAgentIdFromUaid(uaid) : String(a?.iri ?? '');
      const trustLedgerScore =
        typeof a?.trustLedgerTotalPoints === 'number' && Number.isFinite(a.trustLedgerTotalPoints)
          ? a.trustLedgerTotalPoints
          : null;
      const trustLedgerBadgeCount =
        typeof a?.trustLedgerBadgeCount === 'number' && Number.isFinite(a.trustLedgerBadgeCount)
          ? a.trustLedgerBadgeCount
          : null;

      return {
        chainId,
        agentId: derivedAgentId || String(skip + idx + 1),
        uaid,
        agentName: typeof a?.agentName === 'string' ? a.agentName : null,
        description: typeof a?.agentDescription === 'string' ? a.agentDescription : null,
        image: typeof a?.agentImage === 'string' ? a.agentImage : null,
        agentTypes: Array.isArray((a as any)?.agentTypes) ? ((a as any).agentTypes as string[]) : null,
        createdAtTime: typeof a?.createdAtTime === 'number' ? a.createdAtTime : null,
        updatedAtTime: typeof a?.updatedAtTime === 'number' ? a.updatedAtTime : null,

        // Map ranked fields into the UI's existing slots.
        trustLedgerScore,
        trustLedgerBadgeCount,
        trustLedgerOverallRank: skip + idx + 1,
        trustLedgerBadges: Array.isArray(a?.trustLedgerBadges) ? a.trustLedgerBadges : null,
        atiOverallScore: typeof a?.atiOverallScore === 'number' ? a.atiOverallScore : null,
        atiOverallConfidence: typeof a?.atiOverallConfidence === 'number' ? a.atiOverallConfidence : null,
        atiVersion: typeof a?.atiVersion === 'string' ? a.atiVersion : null,
        atiComputedAt: typeof a?.atiComputedAt === 'number' ? a.atiComputedAt : null,
        // passthrough for debugging/inspection if needed
        trustLedgerComputedAt: typeof a?.trustLedgerComputedAt === 'number' ? a.trustLedgerComputedAt : null,
      };
    });

    return NextResponse.json({
      success: true,
      agents,
      total,
      page,
      pageSize: first,
      totalPages: Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, first))),
      hasMore: Boolean(payload?.hasMore),
      debug: process.env.NODE_ENV === 'development'
        ? { endpoint: resolved.endpoint, endpointSource: resolved.source, chainId, first, skip }
        : undefined,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch ranked agents' },
      { status: 500 },
    );
  }
}

