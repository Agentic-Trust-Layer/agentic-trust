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
    const hasMethod = typeof (discovery as any).oasfDomains === 'function';
    const raw = hasMethod
      ? await (discovery as any).oasfDomains({
      category: category || undefined,
      limit: 10000,
      offset: 0,
      orderBy: 'category',
      orderDirection: 'ASC',
      })
      : undefined;

    const list = Array.isArray(raw) ? raw : [];

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

    const warning =
      !hasMethod
        ? 'Discovery client does not expose oasfDomains(). Taxonomy is unavailable in this deployment.'
        : !category && domains.length === 0
          ? 'Discovery GraphQL returned 0 OASF domains. Taxonomy may be unavailable or not populated in this deployment.'
          : null;

    const cacheable = domains.length > 0;
    const cacheControl = cacheable
      ? 'public, s-maxage=3600, stale-while-revalidate=86400'
      : 'no-store';

    if (cacheable) {
      cacheByCategory.set(cacheKey, { at: now, domains });
    }

    return NextResponse.json(
      {
        domains,
        count: domains.length,
        source: 'discovery_graphql',
        warning,
      },
      {
        headers: {
          'Cache-Control': cacheControl,
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

