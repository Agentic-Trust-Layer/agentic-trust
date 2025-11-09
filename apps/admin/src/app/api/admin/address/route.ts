import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/client';

export async function GET() {
  try {
  // Check if private key mode is enabled (server-side check)
  const usePrivateKey = process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY ? true : false;

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
