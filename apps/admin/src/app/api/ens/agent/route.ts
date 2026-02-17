import { NextResponse } from 'next/server';
import { getAgenticTrustClient, getChainById, getChainEnvVar, requireChainEnvVar } from '@agentic-trust/core/server';
import { createPublicClient, http, namehash, zeroAddress, type Address, type Chain } from 'viem';

const ENS_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'resolver',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const ENS_RESOLVER_ABI = [
  {
    type: 'function',
    name: 'addr',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'text',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

async function resolveEnsViaRegistry(params: {
  chainId: number;
  fullName: string;
}): Promise<{
  name: string;
  account: string | null;
  url: string | null;
  image: string | null;
  description: string | null;
}> {
  const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', params.chainId);
  const chain = getChainById(params.chainId) as unknown as Chain;
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const registry =
    (getChainEnvVar('AGENTIC_TRUST_ENS_REGISTRY', params.chainId) || '').trim() ||
    '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

  const node = namehash(params.fullName);
  let resolver: Address | null = null;
  try {
    resolver = (await client.readContract({
      address: registry as Address,
      abi: ENS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    })) as Address;
  } catch {
    resolver = null;
  }

  if (!resolver || resolver === zeroAddress) {
    return { name: params.fullName, account: null, url: null, image: null, description: null };
  }

  const readText = async (key: string) => {
    try {
      const v = await client.readContract({
        address: resolver as Address,
        abi: ENS_RESOLVER_ABI,
        functionName: 'text',
        args: [node, key],
      });
      const s = typeof v === 'string' ? v.trim() : '';
      return s || null;
    } catch {
      return null;
    }
  };

  let account: string | null = null;
  try {
    const addr = await client.readContract({
      address: resolver as Address,
      abi: ENS_RESOLVER_ABI,
      functionName: 'addr',
      args: [node],
    });
    const a = typeof addr === 'string' ? addr : '';
    account = a && a !== zeroAddress ? a : null;
  } catch {
    account = null;
  }

  // Common ENS text keys used by app.ens.domains & ecosystem:
  // - url: arbitrary URL
  // - avatar: ENS avatar record (may be an https URL or eip155/ipfs URI)
  // - description: human description
  const [url, image, description] = await Promise.all([
    readText('url'),
    readText('avatar'),
    readText('description'),
  ]);

  return { name: params.fullName, account, url, image, description };
}

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
    // For Ethereum L1, resolve like app.ens.domains does:
    // registry.resolver(namehash) -> resolver.addr + resolver.text records.
    const useMainnetResolvers = chainId === 1;
    const info = useMainnetResolvers
      ? await resolveEnsViaRegistry({ chainId, fullName })
      : await (async () => {
          const client = await getAgenticTrustClient();
          const i = await client.getENSInfo(fullName, chainId);
          return {
            name: i.name,
            account: i.account ?? null,
            url: i.url ?? null,
            image: i.image ?? null,
            description: i.description ?? null,
          };
        })();

    // Best-effort: some ENS clients implement identity lookup; not all.
    let identity: unknown = null;
    // On L2 (ex: Linea), identity resolvers are often not configured / not supported.
    // Avoid noisy contract "resolver() returned no data" errors by skipping on non-L1.
    const canTryIdentity = chainId === 1 || chainId === 11155111;
    if (canTryIdentity) {
      try {
        const { getENSClient } = await import('@agentic-trust/core/server');
        const ens = await getENSClient(chainId);
        const extra = ens as unknown as { getAgentIdentityByName?: (name: string) => Promise<unknown> | unknown };
        if (extra.getAgentIdentityByName) {
          try {
            identity = await extra.getAgentIdentityByName(fullName);
          } catch {
            identity = null;
          }
        }
      } catch {
        identity = null;
      }
    }

    return NextResponse.json({
      ok: true,
      chainId,
      ensName: info.name,
      account: info.account ?? null,
      agentUrl: info.url ?? null,
      image: info.image ?? null,
      description: info.description ?? null,
      identity,
    });
  } catch (error) {
    console.error('[api/ens/agent] failed', error);
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

