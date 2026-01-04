import { NextRequest, NextResponse } from 'next/server';
import { getDiscoveryClient } from '@agentic-trust/core/server';

export const dynamic = 'force-dynamic';

type ApiSkill = {
  id: string;
  key: string;
  label: string;
  caption?: string | null;
  nameKey?: string | null;
  uid?: number | null;
  extendsKey?: string | null;
  category?: string | null;
};

// Per-instance cache (Vercel/Node) + CDN cache via Cache-Control headers.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const cacheByCategory = new Map<string, { at: number; skills: ApiSkill[] }>();

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
          skills: cached.skills,
          count: cached.skills.length,
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
    const raw = await (discovery as any).oasfSkills?.({
      category: category || undefined,
      limit: 10000,
      offset: 0,
      orderBy: 'category',
      orderDirection: 'ASC',
    });

    const list = Array.isArray(raw) ? raw : [];
    // If we're querying the full taxonomy and got nothing back, treat it as a backend/config error.
    // (Category-specific queries may legitimately return 0.)
    if (!category && list.length === 0) {
      return NextResponse.json(
        {
          error: 'OASF skills not available from discovery endpoint',
          message:
            'Discovery GraphQL did not return any OASF skills. Ensure the discovery deployment exposes Query.oasfSkills and the taxonomy is populated.',
        },
        { status: 503 },
      );
    }

    const skills: ApiSkill[] = list
      .map((s) => ({
        id: String(s.key),
        key: String(s.key),
        label: String(s.caption || s.key),
        caption: s.caption ?? null,
        nameKey: s.nameKey ?? null,
        uid: typeof s.uid === 'number' ? s.uid : null,
        extendsKey: s.extendsKey ?? null,
        category: s.category ?? null,
      }))
      .filter((s) => s.id);

    if (!category && skills.length === 0) {
      return NextResponse.json(
        {
          error: 'OASF skills not available from discovery endpoint',
          message:
            'Discovery GraphQL returned 0 OASF skills after normalization. Check the taxonomy payload (expects key/caption/category).',
        },
        { status: 503 },
      );
    }

    cacheByCategory.set(cacheKey, { at: now, skills });

    return NextResponse.json(
      {
        skills,
        count: skills.length,
        source: 'discovery_graphql',
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      },
    );
  } catch (error) {
    console.error('[oasf/skills] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch OASF skills',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

