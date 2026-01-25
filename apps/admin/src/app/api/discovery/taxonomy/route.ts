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

export async function GET() {
  try {
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

    return NextResponse.json(
      {
        intentTypes: intentList,
        taskTypes: taskList,
        intentTaskMappings: mappingList,
        source: 'discovery_graphql',
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
