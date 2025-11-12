import { NextRequest, NextResponse } from 'next/server';
import { getServerCounterfactualAAAddressByAgentName } from '@agentic-trust/core/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const searchParams = request.nextUrl.searchParams;
    const chainIdParam = searchParams.get('chainId');
    const chainId = chainIdParam ? Number.parseInt(chainIdParam, 10) : undefined;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const decodedName = decodeURIComponent(name).trim();

    if (!decodedName) {
      return NextResponse.json({ error: 'name is required and cannot be empty' }, { status: 400 });
    }

    const address = await getServerCounterfactualAAAddressByAgentName(
      decodedName,
      chainId
    );

    return NextResponse.json({ address });
  } catch (error) {
    console.error('Error computing server AA address:', error);
    return NextResponse.json(
      {
        error: 'Failed to compute AA address',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

