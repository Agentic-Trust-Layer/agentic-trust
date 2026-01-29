import { parseDid8004 } from '@agentic-trust/core';
import { parseHcs14UaidDidTarget } from '@agentic-trust/core/server';

export type ParsedUaidDid8004 = {
  uaid: string;
  did8004: string;
  chainId: number;
  agentId: string;
};

/**
 * Accepts a UAID and returns the parsed did:8004 target.
 * Throws if the UAID does not target did:8004 (i.e. on-chain admin routes unavailable).
 */
export function resolveDid8004FromUaid(input: string): ParsedUaidDid8004 {
  const raw = decodeURIComponent(String(input ?? '').trim());
  if (!raw) {
    throw new Error('Missing agent identifier (uaid)');
  }

  if (!raw.startsWith('uaid:')) {
    throw new Error('Only UAID is supported (expected prefix "uaid:")');
  }

  const did8004 = parseHcs14UaidDidTarget(raw).targetDid;

  if (!did8004.startsWith('did:8004:')) {
    throw new Error(`UAID must target did:8004 (got target=${did8004})`);
  }

  const parsed = parseDid8004(did8004);
  return {
    uaid: raw,
    did8004: parsed.did,
    chainId: parsed.chainId,
    agentId: parsed.agentId,
  };
}

