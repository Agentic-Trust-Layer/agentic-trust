import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';
import type { DiscoverParams } from '@agentic-trust/core/server';
import { discoverAgents, type DiscoverRequest } from '@agentic-trust/core/server';

const DEFAULT_PAGE_SIZE = 10;

function toNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type SearchResultPayload = import('@agentic-trust/core/server').DiscoverResponse;

function mapAgentsResponse(data: SearchResultPayload) {
  const { agents, total, page, pageSize, totalPages } = data;
  const agentsData = agents.map((agent: any) => ({
    agentId: agent.agentId,
    agentName: agent.agentName,
    a2aEndpoint: agent.a2aEndpoint,
    createdAtTime: agent.data?.createdAtTime,
    updatedAtTime: agent.data?.updatedAtTime,
    agentType: agent.data?.type,
    agentOwner: agent.data?.agentOwner,
  }));

  return {
    success: true,
    agents: agentsData,
    total,
    page: page ?? 1,
    pageSize: pageSize ?? agents.length,
    totalPages: totalPages ?? Math.max(1, Math.ceil((total ?? agents.length) / (pageSize ?? Math.max(agents.length, 1)))),
  };
}

async function mapClientSearch(options: DiscoverRequest): Promise<SearchResultPayload> {
  return discoverAgents(options, getAdminClient);
}

function parseParamsParam(raw: string | null): DiscoverParams | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as unknown as DiscoverParams) : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  try {
    const urlParams = request.nextUrl.searchParams;
    const page = toNumber(urlParams.get('page'));
    const pageSize = toNumber(urlParams.get('pageSize')) ?? DEFAULT_PAGE_SIZE;
    const query = urlParams.get('query')?.trim();
    const params = parseParamsParam(urlParams.get('params'));
    const orderBy = urlParams.get('orderBy')?.trim() || undefined;
    const orderDirectionRaw = urlParams.get('orderDirection')?.trim().toUpperCase();
    const orderDirection =
      orderDirectionRaw === 'ASC' || orderDirectionRaw === 'DESC' ? (orderDirectionRaw as 'ASC' | 'DESC') : undefined;

    const response = await mapClientSearch({
      page,
      pageSize,
      query: query && query.length > 0 ? query : undefined,
      params,
      orderBy,
      orderDirection,
    });

    return NextResponse.json(mapAgentsResponse(response));
  } catch (error: unknown) {
    console.error('Error searching agents:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to search agents',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const page = typeof body.page === 'number' ? body.page : undefined;
    const pageSize =
      typeof body.pageSize === 'number' && Number.isFinite(body.pageSize)
        ? body.pageSize
        : DEFAULT_PAGE_SIZE;
    const query =
      typeof body.query === 'string' && body.query.trim().length > 0 ? body.query.trim() : undefined;
    const params: DiscoverParams | undefined =
      body.params && typeof body.params === 'object' ? (body.params as DiscoverParams) : undefined;
    const orderBy: string | undefined =
      typeof body.orderBy === 'string' && body.orderBy.trim().length > 0 ? body.orderBy.trim() : undefined;
    const orderDirection: 'ASC' | 'DESC' | undefined =
      typeof body.orderDirection === 'string' && ['ASC', 'DESC'].includes(body.orderDirection.toUpperCase())
        ? (body.orderDirection.toUpperCase() as 'ASC' | 'DESC')
        : undefined;

    const response = await mapClientSearch({
      page,
      pageSize,
      query,
      params,
      orderBy,
      orderDirection,
    });

    return NextResponse.json(mapAgentsResponse(response));
  } catch (error: unknown) {
    console.error('Error searching agents:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to search agents',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}
