import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type AccessCodeRequest = {
  address?: string;
};

function resolveGraphiqlBaseUrl(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_URL,
    process.env.AGENTIC_TRUST_DISCOVERY_URL,
    process.env.NEXT_PUBLIC_GRAPHQL_API_URL,
    process.env.GRAPHQL_API_URL,
  ];

  const raw = candidates.find(value => typeof value === 'string' && value.trim().length > 0);
  if (!raw) {
    return null;
  }

  const normalized = raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(graphql|graphiql)\/?$/i, '');

  return `${normalized}/graphiql`;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as AccessCodeRequest;
    const address = typeof body.address === 'string' ? body.address.trim() : '';

    if (!address) {
      return NextResponse.json({ error: 'Wallet address is required.' }, { status: 400 });
    }

    const accessCode =
      process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || process.env.GRAPHQL_ACCESS_CODE;

    if (!accessCode) {
      console.error('[getAccessCode] Missing AGENTIC_TRUST_DISCOVERY_API_KEY environment variable.');
      return NextResponse.json(
        { error: 'GraphQL access code is not configured on this deployment.' },
        { status: 500 },
      );
    }

    const graphiqlUrl = resolveGraphiqlBaseUrl();

    if (!graphiqlUrl) {
      console.warn('[getAccessCode] No GraphQL base URL configured.');
    }

    return NextResponse.json({
      accessCode,
      graphiqlUrl,
    });
  } catch (error) {
    console.error('[getAccessCode] Unexpected error', error);
    return NextResponse.json(
      {
        error: 'Failed to retrieve GraphQL access code.',
      },
      { status: 500 },
    );
  }
}


