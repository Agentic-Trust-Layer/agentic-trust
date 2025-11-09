import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

export async function GET() {
  try {
    // Check if private key mode is enabled
    const usePrivateKey = process.env.NEXT_PUBLIC_AGENTIC_TRUST_ADMIN_USE_PRIVATE_KEY === 'true';

    if (!usePrivateKey) {
      return NextResponse.json(
        { error: 'Private key mode not enabled' },
        { status: 400 }
      );
    }

    const client = await getAdminClient();
    const adminAddress = await client.getAdminEOAAddress();

    return NextResponse.json({
      address: adminAddress,
      mode: 'private_key'
    });
  } catch (error) {
    console.error('Error getting admin address:', error);
    return NextResponse.json(
      {
        error: 'Failed to get admin address',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
