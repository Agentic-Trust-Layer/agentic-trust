import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const chainId = url.searchParams.get('chainId') || 'all';

  try {
    const upstream = await fetch(
      `https://8004-agent.io/sync/agent-pipeline?chainId=${encodeURIComponent(chainId)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    );

    const text = await upstream.text().catch(() => '');

    return NextResponse.json(
      {
        ok: upstream.ok,
        status: upstream.status,
        body: text,
      },
      { status: upstream.ok ? 200 : 502 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'sync failed',
      },
      { status: 502 },
    );
  }
}

