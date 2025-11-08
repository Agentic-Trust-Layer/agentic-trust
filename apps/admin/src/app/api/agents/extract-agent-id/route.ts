import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const chainId = raw?.chainId;
    const receipt = raw?.receipt
      ? JSON.parse(
          JSON.stringify(raw.receipt, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
          )
        )
      : null;

    if (!receipt) {
      return NextResponse.json(
        { error: 'receipt is required' },
        { status: 400 }
      );
    }

    const client = await getAdminClient();
    const agentId = await client.agents.extractAgentIdFromReceipt(receipt, chainId);

    return NextResponse.json({
      success: true,
      agentId,
    });
  } catch (error) {
    console.error('Error extracting agentId:', error);
    return NextResponse.json(
      {
        error: 'Failed to extract agentId',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

