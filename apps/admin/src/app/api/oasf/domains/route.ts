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

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const category = (url.searchParams.get('category') || '').trim();

    const discovery = await getDiscoveryClient();
    const hasMethod = typeof (discovery as any).oasfDomains === 'function';
    
    if (!hasMethod) {
      console.warn('[oasf/domains] Discovery client does not expose oasfDomains() method');
      return NextResponse.json(
        {
          domains: [],
          count: 0,
          source: 'discovery_graphql',
          warning: 'Discovery client does not expose oasfDomains(). Taxonomy is unavailable in this deployment.',
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

    console.log('[oasf/domains] Calling discovery.oasfDomains with params:', params);

    let raw: any;
    let queryError: Error | null = null;
    try {
      raw = await (discovery as any).oasfDomains(params);
    } catch (err) {
      queryError = err instanceof Error ? err : new Error(String(err));
      console.error('[oasf/domains] Error calling discovery.oasfDomains:', queryError);
      if (raw === undefined) {
        raw = [];
      }
    }

    console.log('[oasf/domains] Raw response from discovery:', {
      isArray: Array.isArray(raw),
      length: Array.isArray(raw) ? raw.length : 'N/A',
      sample: Array.isArray(raw) && raw.length > 0 ? raw[0] : null,
      error: queryError ? queryError.message : null,
    });

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
      !category && domains.length === 0
        ? 'Discovery GraphQL returned 0 OASF domains. Taxonomy may be unavailable or not populated in this deployment.'
        : null;

    if (warning) {
      console.warn('[oasf/domains]', warning);
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
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      },
    );
  } catch (error) {
    console.error('[oasf/domains] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch OASF domains',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

