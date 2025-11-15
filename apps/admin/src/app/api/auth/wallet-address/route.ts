export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * POST /api/auth/wallet-address
 * Store wallet address in session cookie
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;

    if (!address || typeof address !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid address' },
        { status: 400 }
      );
    }

    const cookieStore = cookies();
    
    // Store wallet address in cookie (for direct wallet connection)
    cookieStore.set('wallet_address', address, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error storing wallet address:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to store wallet address', message: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/wallet-address
 * Retrieve wallet address from session cookie
 */
export async function GET() {
  try {
    const cookieStore = cookies();
    const walletAddress = cookieStore.get('wallet_address')?.value;

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'No wallet address found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ address: walletAddress });
  } catch (error: unknown) {
    console.error('Error retrieving wallet address:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to retrieve wallet address', message: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/wallet-address
 * Clear wallet address from session cookie
 */
export async function DELETE() {
  try {
    const cookieStore = cookies();
    cookieStore.delete('wallet_address');

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error clearing wallet address:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to clear wallet address', message: errorMessage },
      { status: 500 }
    );
  }
}
