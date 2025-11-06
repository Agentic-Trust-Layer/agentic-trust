import { NextRequest, NextResponse } from 'next/server';
import { getIPFSStorage } from '@agentic-trust/core';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

    // First, get the tokenURI from the contract
    const contractResponse = await fetch(`${request.nextUrl.origin}/api/agents/${agentId}/contract`);
    if (!contractResponse.ok) {
      throw new Error('Failed to get tokenURI from contract');
    }
    const contractData = await contractResponse.json();
    const tokenURI = contractData.tokenURI;

    if (!tokenURI) {
      return NextResponse.json({
        success: true,
        agentId,
        registration: null,
        error: 'No tokenURI found for this agent',
      });
    }

    // Get IPFS storage and retrieve registration JSON
    const ipfsStorage = getIPFSStorage();
    const registration = await ipfsStorage.getJson(tokenURI);

    return NextResponse.json({
      success: true,
      agentId,
      tokenURI,
      registration,
    });
  } catch (error: unknown) {
    console.error('Error fetching agent from IPFS:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to fetch agent from IPFS',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

