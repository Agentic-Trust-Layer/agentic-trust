import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;

  try {
    const upstream = await fetch(`https://sync.agentkg.io/sync/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });

    const json = (await upstream.json().catch(() => null)) as any;
    const text = json ? '' : await upstream.text().catch(() => '');

    return NextResponse.json(
      {
        ok: upstream.ok,
        status: upstream.status,
        body: json ?? text,
      },
      { status: upstream.ok ? 200 : 502 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'sync job lookup failed',
      },
      { status: 502 },
    );
  }
}

