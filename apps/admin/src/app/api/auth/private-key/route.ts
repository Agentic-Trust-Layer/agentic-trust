import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Get private key from session (server-side only)
 * This is used by API routes to get the authenticated user's private key
 */
export async function GET(): Promise<NextResponse> {
  try {
    const cookieStore = await cookies();
    const privateKey = cookieStore.get('admin_private_key')?.value;

    if (!privateKey) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Return private key (this is server-side only, never exposed to client)
    return NextResponse.json({ privateKey });
  } catch (error: unknown) {
    console.error('Error getting private key:', error);
    return NextResponse.json(
      { error: 'Failed to get private key' },
      { status: 500 }
    );
  }
}

