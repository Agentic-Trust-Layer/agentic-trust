export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function GET() {
  try {
    const usePrivateKey = !!process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY;

    if (!usePrivateKey) {
      return NextResponse.json({
        address: null,
        mode: 'wallet',
        hasPrivateKey: false,
      });
    }

    const client = await getAgenticTrustClient();
    const adminAddress = await client.getAdminEOAAddress();

    return NextResponse.json({
      address: adminAddress,
      mode: 'private_key',
      hasPrivateKey: true,
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