import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const chainId = url.searchParams.get('chainId') || 'all';

  try {
    const upstream = await fetch(
      `https://sync.agentkg.io/sync/agent-pipeline?chainId=${encodeURIComponent(chainId)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    );

    const json = (await upstream.json().catch(() => null)) as any;
    const text = json ? '' : await upstream.text().catch(() => '');

    const jobId =
      typeof json?.jobId === 'string'
        ? json.jobId
        : typeof json?.jobId === 'number'
          ? String(json.jobId)
          : null;
    const statusUrl =
      typeof json?.statusUrl === 'string'
        ? json.statusUrl
        : typeof json?.status_url === 'string'
          ? json.status_url
          : null;

    return NextResponse.json(
      {
        ok: upstream.ok,
        status: upstream.status,
        jobId,
        statusUrl,
        body: json ?? text,
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

