import {
  buildDid8004,
  parseDid8004 as baseParseDid8004,
  resolveDid8004,
  type BuildDid8004Options,
  type ParsedDid8004,
} from '@agentic-trust/8004-ext-sdk';

function normalizeDidInput(value: string): string {
  if (!value) {
    return value;
  }

  let normalized = value.trim();

  if (normalized.includes('%')) {
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // ignore decode errors, fall back to original
    }
  }

  // Some filesystems encode ":" as U+F03A (private-use)
  normalized = normalized.replace(/\uF03A/g, ':');

  return normalized;
}

export function parseDid8004(value: string): ParsedDid8004 {
  return baseParseDid8004(normalizeDidInput(value));
}

export { buildDid8004, resolveDid8004 };
export type { BuildDid8004Options, ParsedDid8004 };

export const normalizeDid8004 = normalizeDidInput;
