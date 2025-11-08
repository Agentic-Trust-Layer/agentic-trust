import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

export async function GET(_request: NextRequest) {
  try {
    const client = await getAdminClient();

    // List all agents
    const agentsData : any[] = []

    /*
    const { agents } = await client.agents.listAgents();

    
    // Convert to plain data for JSON serialization
    const agentsData = agents.map(agent => ({
      agentId: agent.agentId,
      agentName: agent.agentName,
      a2aEndpoint: agent.a2aEndpoint,
      createdAtTime: agent.data?.createdAtTime,
      updatedAtTime: agent.data?.updatedAtTime,
    }));


    */

    return NextResponse.json({
      success: true,
      agents: agentsData,
      total: agentsData.length,
    });
  } catch (error: unknown) {
    console.error('Error listing agents:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to list agents',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

