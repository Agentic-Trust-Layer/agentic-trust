import { randomBytes } from 'crypto';

export type Hcs14RoutingParams = {
  registry?: string;
  proto?: string;
  nativeId?: string;
  uid?: string;
  domain?: string;
  src?: string;
};

function encodeParamValue(value: string): string {
  return encodeURIComponent(value);
}

// Minimal base58 (Bitcoin alphabet) encoder for random aidValue generation.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function toBase58(bytes: Uint8Array): string {
  if (!bytes.length) return '';
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const x = (digits[i] ?? 0) * 256 + carry;
      digits[i] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeroCount = 0;
  for (const b of bytes) {
    if (b === 0) leadingZeroCount++;
    else break;
  }
  let result = '1'.repeat(leadingZeroCount);
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[(digits[i] ?? 0) as number];
  }
  return result;
}

/**
 * Generate an HCS-14 UAID using a randomly generated canonical `aidValue`,
 * then append routing params (`;key=value`) such as registry/proto/nativeId/uid.
 *
 * Produces UAIDs of the form:
 *   uaid:aid:<aidValue>;uid=...;registry=...;nativeId=...;proto=...
 */
export async function generateHcs14UaidDidTarget(params: {
  routing: Hcs14RoutingParams;
  aidBytes?: number;
}): Promise<{ uaid: string; aidValue: string }> {
  const aidLen =
    typeof params.aidBytes === 'number' && Number.isFinite(params.aidBytes) && params.aidBytes > 0
      ? Math.floor(params.aidBytes)
      : 32;

  const aidValue = toBase58(randomBytes(aidLen));

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
    uaid: `uaid:aid:${aidValue}${suffix}`,
    aidValue,
  };
}
