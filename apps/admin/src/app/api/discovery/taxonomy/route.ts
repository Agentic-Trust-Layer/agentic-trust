import { NextResponse } from 'next/server';
import { getDiscoveryClient } from '@agentic-trust/core/server';

export const dynamic = 'force-dynamic';

export type TaxonomyIntentType = { key: string; label?: string | null; description?: string | null };
export type TaxonomyTaskType = { key: string; label?: string | null; description?: string | null };
export type TaxonomyMapping = {
  intent: TaxonomyIntentType;
  task: TaxonomyTaskType;
  requiredSkills: string[];
  optionalSkills: string[];
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let cached: { at: number; intentTypes: TaxonomyIntentType[]; taskTypes: TaxonomyTaskType[]; mappings: TaxonomyMapping[] } | null = null;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const bypassCache = url.searchParams.get('nocache') === 'true' || url.searchParams.get('_') !== null;
    
    const now = Date.now();
    if (!bypassCache && cached && now - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(
        {
          intentTypes: cached.intentTypes,
          taskTypes: cached.taskTypes,
          intentTaskMappings: cached.mappings,
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
    const [intentTypes, taskTypes, mappings] = await Promise.all([
      typeof (discovery as any).intentTypes === 'function'
        ? (discovery as any).intentTypes({ limit: 10000, offset: 0 })
        : [],
      typeof (discovery as any).taskTypes === 'function'
        ? (discovery as any).taskTypes({ limit: 10000, offset: 0 })
        : [],
      typeof (discovery as any).intentTaskMappings === 'function'
        ? (discovery as any).intentTaskMappings({ limit: 10000, offset: 0 })
        : [],
    ]);

    const intentList = Array.isArray(intentTypes) ? intentTypes : [];
    const taskList = Array.isArray(taskTypes) ? taskTypes : [];
    const mappingList = Array.isArray(mappings) ? mappings : [];

    if (intentList.length > 0 || taskList.length > 0 || mappingList.length > 0) {
      cached = {
        at: now,
        intentTypes: intentList,
        taskTypes: taskList,
        mappings: mappingList,
      };
    }

    return NextResponse.json(
      {
        intentTypes: intentList,
        taskTypes: taskList,
        intentTaskMappings: mappingList,
        source: 'discovery_graphql',
      },
      {
        headers: {
          'Cache-Control': bypassCache
            ? 'no-store, no-cache, must-revalidate'
            : intentList.length > 0 || taskList.length > 0 || mappingList.length > 0
              ? 'public, s-maxage=3600, stale-while-revalidate=86400'
              : 'no-store',
        },
      },
    );
  } catch (error) {
    console.error('[discovery/taxonomy] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch discovery taxonomy',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
