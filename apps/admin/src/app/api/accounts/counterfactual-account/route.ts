export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getCounterfactualAAAddressByAgentName } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentName, chainId } = body;

    if (!agentName || typeof agentName !== 'string' || agentName.trim().length === 0) {
      return NextResponse.json(
        { error: 'agentName is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    const targetChainId = chainId && typeof chainId === 'number' ? chainId : undefined;

    try {
      const address = await getCounterfactualAAAddressByAgentName(
        agentName.trim(),
        targetChainId
      );

      return NextResponse.json({ address });
    } catch (error) {
      // Check if it's a known error about private key mode
      if (error instanceof Error) {
        if (error.message.includes('Private key mode is required')) {
          return NextResponse.json(
            {
              error: 'Private key mode is required',
              message: error.message,
            },
            { status: 403 }
          );
        }
        if (error.message.includes('AdminApp not initialized')) {
          return NextResponse.json(
            {
              error: 'AdminApp not initialized',
              message: error.message,
            },
            { status: 500 }
          );
        }
      }
      
      // Re-throw to be caught by outer catch
      throw error;
    }
  } catch (error) {
    console.error('Error computing counterfactual SmartAccount address:', error);
    return NextResponse.json(
      {
        error: 'Failed to compute counterfactual SmartAccount address',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
