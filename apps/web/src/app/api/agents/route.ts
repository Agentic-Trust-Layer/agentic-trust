/**
 * Server-side API route for agent operations
 * Handles listAgents and searchAgents
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentTrustClient } from '@/lib/server-client';

export async function GET() {
  try {
    const atClient = await getAgentTrustClient();
    const response = await atClient.agents.searchAgents();
    
    // Convert Agent instances to plain data for JSON serialization
    const agentsData = response.agents.map(agent => ({
      agentId: agent.agentId,
      agentName: agent.agentName,
      a2aEndpoint: agent.a2aEndpoint,
      createdAtTime: (agent as { data?: { createdAtTime?: string } }).data?.createdAtTime,
      updatedAtTime: (agent as { data?: { updatedAtTime?: string } }).data?.updatedAtTime,
    }));

    return NextResponse.json({
      agents: agentsData,
      total: response.total,
      page: response.page,
      pageSize: response.pageSize,
      totalPages: response.totalPages,
    });
  } catch (error: unknown) {
    console.error('Error fetching agents:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to fetch agents',
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
    const { query, params, page, pageSize } = body || {};

    if (query && typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Invalid query parameter' },
        { status: 400 }
      );
    }

    const atClient = await getAgentTrustClient();
    const response = await atClient.agents.searchAgents({
      query: typeof query === 'string' ? query.trim() : undefined,
      page: typeof page === 'number' ? page : undefined,
      pageSize: typeof pageSize === 'number' ? pageSize : undefined,
      params: params && typeof params === 'object' ? params : undefined,
    });
    
    // Convert Agent instances to plain data for JSON serialization
    const agentsData = response.agents.map(agent => ({
      agentId: agent.agentId,
      agentName: agent.agentName,
      a2aEndpoint: agent.a2aEndpoint,
      createdAtTime: (agent as { data?: { createdAtTime?: string } }).data?.createdAtTime,
      updatedAtTime: (agent as { data?: { updatedAtTime?: string } }).data?.updatedAtTime,
    }));

    return NextResponse.json({
      agents: agentsData,
      total: response.total,
      page: response.page,
      pageSize: response.pageSize,
      totalPages: response.totalPages,
    });
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

