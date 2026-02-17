import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;

  try {
    const base = 'https://sync.agentkg.io';

    const tryFetch = async (path: string): Promise<Response> =>
      fetch(`${base}${path}`, { method: 'GET', headers: { accept: 'application/json' } });

    // Upstream has been seen with job status at `/jobs/<id>` (and sometimes `/sync/jobs/<id>`).
    let upstream = await tryFetch(`/sync/jobs/${encodeURIComponent(jobId)}`);
    if (upstream.status === 404) {
      upstream = await tryFetch(`/jobs/${encodeURIComponent(jobId)}`);
    }

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

