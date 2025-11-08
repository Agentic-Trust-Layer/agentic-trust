import { NextRequest, NextResponse } from 'next/server';
import { handleResolveAccount } from '@agentic-trust/core/server';
import { getAdminClient } from '@/lib/client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    console.log("*********** resolve-account route: request", request);
    const body = await request.json();
    console.log("*********** resolve-account route: body", body);
    const result = await handleResolveAccount(body, getAdminClient);

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('Error in resolve account route:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to resolve account', message: errorMessage },
      { status: 500 }
    );
  }
}

