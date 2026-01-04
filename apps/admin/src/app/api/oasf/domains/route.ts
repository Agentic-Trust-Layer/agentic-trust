import { NextRequest, NextResponse } from 'next/server';
import { getDiscoveryClient } from '@agentic-trust/core/server';

export const dynamic = 'force-dynamic';

type ApiDomain = {
  id: string;
  key: string;
  label: string;
  caption?: string | null;
  nameKey?: string | null;
  uid?: number | null;
  extendsKey?: string | null;
  category?: string | null;
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const cacheByCategory = new Map<string, { at: number; domains: ApiDomain[] }>();

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const category = (url.searchParams.get('category') || '').trim();
    const cacheKey = category || '__all__';

    const now = Date.now();
    const cached = cacheByCategory.get(cacheKey);
    if (cached && now - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(
        {
          domains: cached.domains,
          count: cached.domains.length,
          source: 'cache',
        },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
          },
        },
      );
    }

    const discovery = await getDiscoveryClient();
    const raw = await (discovery as any).oasfDomains?.({
      category: category || undefined,
      limit: 10000,
      offset: 0,
      orderBy: 'category',
      orderDirection: 'ASC',
    });

    const list = Array.isArray(raw) ? raw : [];
    if (!category && list.length === 0) {
      return NextResponse.json(
        {
          error: 'OASF domains not available from discovery endpoint',
          message:
            'Discovery GraphQL did not return any OASF domains. Ensure the discovery deployment exposes Query.oasfDomains and the taxonomy is populated.',
        },
        { status: 503 },
      );
    }

    const domains: ApiDomain[] = list
      .map((d) => ({
        id: String(d.key),
        key: String(d.key),
        label: String(d.caption || d.key),
        caption: d.caption ?? null,
        nameKey: d.nameKey ?? null,
        uid: typeof d.uid === 'number' ? d.uid : null,
        extendsKey: d.extendsKey ?? null,
        category: d.category ?? null,
      }))
      .filter((d) => d.id);

    if (!category && domains.length === 0) {
      return NextResponse.json(
        {
          error: 'OASF domains not available from discovery endpoint',
          message:
            'Discovery GraphQL returned 0 OASF domains after normalization. Check the taxonomy payload (expects key/caption/category).',
        },
        { status: 503 },
      );
    }

    cacheByCategory.set(cacheKey, { at: now, domains });

    return NextResponse.json(
      {
        domains,
        count: domains.length,
        source: 'discovery_graphql',
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      },
    );
  } catch (error) {
    console.error('[oasf/domains] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch OASF domains',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

