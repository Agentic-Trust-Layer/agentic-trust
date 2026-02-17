import { NextResponse } from 'next/server';
import { getENSClient } from '@agentic-trust/core/server';

function normalizeOrgName(input: string): string {
  const t = (input || '').trim().toLowerCase();
  if (!t) return '';
  return t.endsWith('.eth') ? t.replace(/\.eth$/i, '') : t;
}

function buildEnsName(params: { name: string; orgName: string }): string {
  const rawName = (params.name || '').trim();
  const rawOrg = normalizeOrgName(params.orgName);
  if (!rawName) return '';

  const lower = rawName.toLowerCase();
  if (lower.endsWith('.eth') || lower.includes('.')) {
    // Treat as full ENS name if it has dots (ex: foo.8004-agent.eth)
    return lower.endsWith('.eth') ? lower : `${lower}.eth`;
  }
  if (!rawOrg) return '';
  return `${lower}.${rawOrg}.eth`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || '';
  const orgName = url.searchParams.get('org') || '8004-agent.eth';
  const chainIdRaw = url.searchParams.get('chainId') || '59144';
  const chainId = Number(chainIdRaw);

  const allowed = new Set([1, 11155111, 59144, 59141]);
  if (!allowed.has(chainId)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported chainId=${chainIdRaw}. Use 1, 11155111, 59144, or 59141.` },
      { status: 400 },
    );
  }

  const fullName = buildEnsName({ name, orgName });
  if (!fullName) {
    return NextResponse.json(
      { ok: false, error: 'Missing name (and/or org). Provide ?name=alice or ?name=alice.8004-agent.eth' },
      { status: 400 },
    );
  }

  try {
    const ens = await getENSClient(chainId);

    const extra = ens as unknown as {
      getAgentUrlByName?: (name: string) => Promise<unknown>;
      getAgentImageByName?: (name: string) => Promise<unknown>;
      getAgentDescriptionByName?: (name: string) => Promise<unknown>;
      getAgentIdentityByName?: (name: string) => Promise<unknown>;
    };

    const [account, agentUrl, image, description, identity] = await Promise.all([
      ens.getAgentAccountByName(fullName).catch(() => null),
      extra.getAgentUrlByName?.(fullName).catch(() => null),
      extra.getAgentImageByName?.(fullName).catch(() => null),
      extra.getAgentDescriptionByName?.(fullName).catch(() => null),
      extra.getAgentIdentityByName?.(fullName).catch(() => null),
    ]);

    return NextResponse.json({
      ok: true,
      chainId,
      ensName: fullName,
      account,
      agentUrl,
      image,
      description,
      identity,
    });
  } catch (error) {
    console.error('[api/ens/linea/agent] failed', error);
    return NextResponse.json(
      {
        ok: false,
        error:
          (error instanceof Error ? error.message : 'ENS lookup failed') +
          ' (check your AGENTIC_TRUST_ENS_REGISTRY_* / AGENTIC_TRUST_ENS_RESOLVER_* env vars are set to contract addresses)',
      },
      { status: 500 },
    );
  }
}

