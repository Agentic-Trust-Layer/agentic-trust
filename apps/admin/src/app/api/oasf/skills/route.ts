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

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const category = (url.searchParams.get('category') || '').trim();

    const discovery = await getDiscoveryClient();
    const hasMethod = typeof (discovery as any).oasfSkills === 'function';
    
    if (!hasMethod) {
      console.warn('[oasf/skills] Discovery client does not expose oasfSkills() method');
      return NextResponse.json(
        {
          skills: [],
          count: 0,
          source: 'discovery_graphql',
          warning: 'Discovery client does not expose oasfSkills(). Taxonomy is unavailable in this deployment.',
        },
        {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        },
      );
    }

    const params: {
      category?: string;
      limit?: number;
      offset?: number;
      orderBy?: string;
      orderDirection?: string;
    } = {
      limit: 10000,
      offset: 0,
    };
    if (category) params.category = category;

    console.log('[oasf/skills] Calling discovery.oasfSkills with params:', params);

    let raw: any;
    let queryError: Error | null = null;
    try {
      raw = await (discovery as any).oasfSkills(params);
    } catch (err) {
      queryError = err instanceof Error ? err : new Error(String(err));
      console.error('[oasf/skills] Error calling discovery.oasfSkills:', queryError);
      // The discovery client may catch and return [] for some errors, so check if raw is undefined
      if (raw === undefined) {
        raw = [];
      }
    }

    console.log('[oasf/skills] Raw response from discovery:', {
      isArray: Array.isArray(raw),
      length: Array.isArray(raw) ? raw.length : 'N/A',
      sample: Array.isArray(raw) && raw.length > 0 ? raw[0] : null,
      error: queryError ? queryError.message : null,
    });

    const list = Array.isArray(raw) ? raw : [];

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

    const warning =
      !category && skills.length === 0
        ? 'Discovery GraphQL returned 0 OASF skills. Taxonomy may be unavailable or not populated in this deployment.'
        : null;

    if (warning) {
      console.warn('[oasf/skills]', warning);
    }

    return NextResponse.json(
      {
        skills,
        count: skills.length,
        source: 'discovery_graphql',
        warning,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      },
    );
  } catch (error) {
    console.error('[oasf/skills] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch OASF skills',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

