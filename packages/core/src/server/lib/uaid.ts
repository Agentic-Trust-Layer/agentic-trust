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
  // UAID DID-target idPart must be "<method>:<method-specific-id...>" so that
  // parseHcs14UaidDidTarget can reconstruct "did:<method>:..." correctly.
  // Example targetDid "did:ethr:11155111:0xabc..." => idPart "ethr:11155111:0xabc..."
  return parts.slice(1).join(':');
}

/**
 * Parse a UAID DID-target:
 *   uaid:did:<methodSpecificId>;k=v;...
 *
 * Also supports UAID AID-target:
 *   uaid:aid:<agentId>;k=v;...
 * where <agentId> (between ':' and ';') is the canonical agent identifier.
 *
 * Returns the reconstructed target DID (e.g. did:ethr:..., did:web:...).
 */
export function parseHcs14UaidDidTarget(rawUaid: string): ParsedUaidDidTarget {
  const uaid = decodeURIComponent(String(rawUaid ?? '').trim());
  if (!uaid) {
    throw new Error('Missing UAID');
  }

  const isDidTarget = uaid.startsWith('uaid:did:');
  const isAidTarget = uaid.startsWith('uaid:aid:');
  if (!isDidTarget && !isAidTarget) {
    throw new Error(`Unsupported UAID format: ${uaid}`);
  }

  const withoutPrefix = uaid.slice(isDidTarget ? 'uaid:did:'.length : 'uaid:aid:'.length);
  const [idPart, ...rest] = withoutPrefix.split(';');
  const id = String(idPart ?? '').trim();
  if (!id) {
    throw new Error(`Invalid UAID (missing target): ${uaid}`);
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
    // For uaid:did, reconstruct the did:<method>:<msid...> target.
    // For uaid:aid, there is no DID target; treat "aid:<id>" as the target identifier string.
    targetDid: isDidTarget ? `did:${id}` : `aid:${id}`,
    routing,
  };
}

/**
 * Generate an HCS-14 UAID in DID-target form:
 *   uaid:did:<method>:<methodSpecificId...>;uid=...;registry=...;proto=...;nativeId=...;domain=...
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
    // For uaid:did, {id} is "<method>:<methodSpecificId...>" (no leading "did:").
    uaid: `uaid:did:${methodSpecificId}${suffix}`,
  };
}
