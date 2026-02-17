import { NextResponse } from 'next/server';
import { createPublicClient, http, decodeEventLog, parseAbiItem, namehash, type Chain } from 'viem';
import { getChainById, getChainEnvVar, requireChainEnvVar } from '@agentic-trust/core/server';

function normalizeOrg(input: string): string {
  const t = (input || '').trim().toLowerCase();
  if (!t) return '';
  return t.endsWith('.eth') ? t.slice(0, -4) : t;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const orgRaw = url.searchParams.get('org') || '8004-agent.eth';
  const chainIdRaw = url.searchParams.get('chainId') || '59144';
  const fromBlockRaw = url.searchParams.get('fromBlock');
  const toBlockRaw = url.searchParams.get('toBlock');

  const chainId = Number(chainIdRaw);
  if (!Number.isFinite(chainId)) {
    return NextResponse.json({ ok: false, error: `Invalid chainId=${chainIdRaw}` }, { status: 400 });
  }

  const org = normalizeOrg(orgRaw);
  if (!org) {
    return NextResponse.json({ ok: false, error: 'Missing org' }, { status: 400 });
  }

  const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', chainId);
  const registry = (getChainEnvVar('AGENTIC_TRUST_ENS_REGISTRY', chainId) || '').trim();
  if (!registry || !registry.startsWith('0x') || registry.length !== 42) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Missing/invalid ENS registry address for chainId=${chainId}. ` +
          `Set AGENTIC_TRUST_ENS_REGISTRY_* env var to a contract address.`,
      },
      { status: 500 },
    );
  }

  const chain = getChainById(chainId) as unknown as Chain;
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const orgEns = `${org}.eth`;
  const orgNode = namehash(orgEns);

  // Best-effort support for L2 registries that emit the label string on create.
  // (Standard ENS L1 registry emits NewOwner with labelhash only; we can't recover the label string.)
  const candidates = [
    parseAbiItem('event SubnodeCreated(bytes32 indexed baseNode, string label, address indexed owner, bytes32 node)'),
    parseAbiItem('event SubnodeCreated(bytes32 indexed parent, string label, address indexed owner)'),
    parseAbiItem('event SubnodeCreated(bytes32 indexed baseNode, string label, address indexed owner)'),
  ];

  const toBlock = toBlockRaw ? (toBlockRaw === 'latest' ? 'latest' : BigInt(toBlockRaw)) : 'latest';
  const fromBlock = fromBlockRaw ? BigInt(fromBlockRaw) : undefined;

  const labelsToOwner = new Map<string, string>();

  let resolvedFromBlock: bigint | undefined = fromBlock;
  if (resolvedFromBlock === undefined) {
    try {
      const latest = await client.getBlockNumber();
      const lookback = 250_000n;
      resolvedFromBlock = latest > lookback ? latest - lookback : 0n;
    } catch {
      resolvedFromBlock = undefined;
    }
  }

  for (const abiItem of candidates) {
    try {
      const logs = await client.getLogs({
        address: registry as `0x${string}`,
        event: abiItem,
        fromBlock: resolvedFromBlock,
        toBlock,
      });

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: [abiItem],
            data: log.data,
            topics: log.topics,
          }) as {
            args?: {
              baseNode?: unknown;
              parent?: unknown;
              label?: unknown;
              owner?: unknown;
            };
          };

          const parentNode =
            (typeof decoded?.args?.baseNode === 'string' ? (decoded.args.baseNode as `0x${string}`) : undefined) ??
            (typeof decoded?.args?.parent === 'string' ? (decoded.args.parent as `0x${string}`) : undefined) ??
            null;
          if (parentNode && parentNode.toLowerCase() !== orgNode.toLowerCase()) continue;

          const label = typeof decoded?.args?.label === 'string' ? decoded.args.label.trim().toLowerCase() : '';
          const owner = typeof decoded?.args?.owner === 'string' ? decoded.args.owner : '';
          if (!label) continue;
          if (!owner || !owner.startsWith('0x') || owner.length !== 42) continue;
          labelsToOwner.set(label, owner);
        } catch {
          // ignore decode errors for individual logs
        }
      }
    } catch {
      // ignore if the registry doesn't have this event signature
    }
  }

  const labels = Array.from(labelsToOwner.keys()).sort((a, b) => a.localeCompare(b));

  return NextResponse.json({
    ok: true,
    chainId,
    org: orgEns,
    registry,
    count: labels.length,
    labels,
  });
}

