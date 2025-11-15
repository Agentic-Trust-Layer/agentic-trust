export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Store admin private key in session
 * POST /api/auth/session - Store private key
 * GET /api/auth/session - Get stored private key (if exists)
 * DELETE /api/auth/session - Clear session
 */
export async function POST(request: NextRequest) {
  let body: { privateKey?: string };
  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload for session:', error);
    return NextResponse.json(
      { error: 'Invalid or missing JSON body' },
      { status: 400 },
    );
  }

  try {
    const { privateKey } = body;

    if (!privateKey || typeof privateKey !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid privateKey' },
        { status: 400 }
      );
    }

    // Normalize private key: ensure it has 0x prefix
    let normalizedKey = privateKey.trim();
    if (!normalizedKey.startsWith('0x')) {
      normalizedKey = `0x${normalizedKey}`;
    }
    
    // Validate private key format (must be 64 hex characters after 0x)
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedKey)) {
      return NextResponse.json(
        { error: `Invalid private key format. Expected 64 hex characters, got ${normalizedKey.length - 2} after 0x prefix` },
        { status: 400 }
      );
    }

    // Store in httpOnly cookie (secure)
    const cookieStore = await cookies();
    cookieStore.set('admin_private_key', normalizedKey, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error storing session:', error);
    return NextResponse.json(
      { error: 'Failed to store session' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const privateKey = cookieStore.get('admin_private_key')?.value;

    if (!privateKey) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401 }
      );
    }

    // Return a minimal response (don't expose full key to client)
    return NextResponse.json({ 
      authenticated: true,
      address: extractAddressFromPrivateKey(privateKey),
    });
  } catch (error: unknown) {
    console.error('Error getting session:', error);
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('admin_private_key');
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error clearing session:', error);
    return NextResponse.json(
      { error: 'Failed to clear session' },
      { status: 500 }
    );
  }
}

/**
 * Extract address from private key (simple validation)
 * In production, use proper crypto library
 */
function extractAddressFromPrivateKey(privateKey: string): string {
  // This is a placeholder - in production, derive the address properly
  // For now, return a partial hash for display purposes only
  return '0x' + privateKey.slice(2, 42).padEnd(40, '0');
}
