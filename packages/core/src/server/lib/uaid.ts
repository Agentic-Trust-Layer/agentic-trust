export type Hcs14RoutingParams = {
  registry?: string;
  proto?: string;
  nativeId?: string;
  uid?: string;
  domain?: string;
  src?: string;
};

export type ParsedUaidDidTarget = {
  uaid: string;
  targetDid: string;
  routing: Record<string, string>;
};

function encodeParamValue(value: string): string {
  // UAID params are delimited with ';' and '='. We only encode the characters that
  // would break parsing, while keeping CAIP-10 / DID strings human-readable.
  return value
    .replace(/%/g, '%25')
    .replace(/;/g, '%3B')
    .replace(/=/g, '%3D');
}

function decodeParamValue(value: string): string {
  return String(value || '')
    .replace(/%3D/gi, '=')
    .replace(/%3B/gi, ';')
    .replace(/%25/gi, '%');
}

function didMethodSpecificId(did: string): string {
  const decoded = decodeURIComponent((did || '').trim());
  if (!decoded) {
    throw new Error('Missing DID');
  }
  const parts = decoded.split(':');
  // did:<method>:<method-specific-id...>
  if (parts.length < 3 || parts[0] !== 'did') {
    throw new Error(`Invalid DID: ${decoded}`);
  }
  return parts.slice(2).join(':');
}

/**
 * Parse a UAID DID-target:
 *   uaid:did:<methodSpecificId>;k=v;...
 *
 * Returns the reconstructed target DID (e.g. did:ethr:..., did:web:...).
 */
export function parseHcs14UaidDidTarget(rawUaid: string): ParsedUaidDidTarget {
  const uaid = decodeURIComponent(String(rawUaid ?? '').trim());
  if (!uaid) {
    throw new Error('Missing UAID');
  }
  if (!uaid.startsWith('uaid:did:')) {
    throw new Error(`Unsupported UAID format: ${uaid}`);
  }

  const withoutPrefix = uaid.slice('uaid:did:'.length);
  const [msid, ...rest] = withoutPrefix.split(';');
  const methodSpecificId = String(msid ?? '').trim();
  if (!methodSpecificId) {
    throw new Error(`Invalid UAID (missing target DID): ${uaid}`);
  }

  const routing: Record<string, string> = {};
  for (const part of rest) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1);
    if (!k) continue;
    routing[k] = decodeParamValue(v);
  }

  return {
    uaid,
    targetDid: `did:${methodSpecificId}`,
    routing,
  };
}

/**
 * Generate an HCS-14 UAID in DID-target form:
 *   uaid:did:<did:ethr...>;uid=...;registry=...;proto=...;nativeId=...;domain=...
 *
 * This allows construction *before* ERC-8004 identity registration, since the
 * agent account DID (did:ethr) exists prior to minting the identity NFT.
 */
export async function generateHcs14UaidDidTarget(params: {
  targetDid: string;
  routing: Hcs14RoutingParams;
}): Promise<{ uaid: string }> {
  const targetDid = String(params.targetDid ?? '').trim();
  const methodSpecificId = didMethodSpecificId(targetDid);

  const routing = params.routing || {};
  const parts: string[] = [];
  for (const [key, value] of Object.entries(routing)) {
    if (value === undefined || value === null) continue;
    const trimmed = String(value).trim();
    if (!trimmed) continue;
    parts.push(`${key}=${encodeParamValue(trimmed)}`);
  }

  const suffix = parts.length > 0 ? `;${parts.join(';')}` : '';
  return {
    // For uaid:did, {id} is the DID method-specific identifier (no "did:<method>:" prefix).
    uaid: `uaid:did:${methodSpecificId}${suffix}`,
  };
}
