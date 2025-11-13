const DID_8004_PREFIX = 'did:8004:';

export interface Parsed8004Did {
  /**
   * DID without any URL fragment (decoded form)
   * e.g. did:8004:eip155:11155111:724
   */
  did: string;
  /**
   * DID method – always "8004"
   */
  method: '8004';
  /**
   * Optional namespace between method and chain id (e.g. "eip155")
   */
  namespace?: string;
  /**
   * Chain id component parsed as a number
   */
  chainId: number;
  /**
   * Agent identifier component (string to preserve full precision)
   */
  agentId: string;
  /**
   * Optional fragment (portion after '#', decoded)
   */
  fragment?: string;
  /**
   * Encoded DID string suitable for use in URLs
   */
  encoded: string;
}

export interface Build8004DidOptions {
  namespace?: string;
  fragment?: string;
  /**
   * When true (default) the resulting DID is URI-encoded.
   */
  encode?: boolean;
}

function normaliseComponent(value: number | string, label: string): string {
  const stringValue =
    typeof value === 'number' ? Number.isFinite(value) ? value.toString(10) : '' : value?.toString() ?? '';
  const trimmed = stringValue.trim();
  if (!trimmed) {
    throw new Error(`${label} is required to build did:8004 identifier`);
  }
  return trimmed;
}

function encodeIfNeeded(value: string, encode: boolean | undefined): string {
  return encode === false ? value : encodeURIComponent(value);
}

/**
 * Construct a did:8004 identifier.
 *
 * @param chainId - numeric or string chain id
 * @param agentId - agent identifier (string or number)
 * @param namespaceOrOptions - optional namespace string or options bag
 * @param options - optional options when namespace is provided as third argument
 */
export function build8004Did(
  chainId: number | string,
  agentId: number | string,
  namespaceOrOptions?: string | Build8004DidOptions,
  options?: Build8004DidOptions,
): string {
  let namespace: string | undefined;
  let opts: Build8004DidOptions | undefined;

  if (typeof namespaceOrOptions === 'object' && namespaceOrOptions !== null) {
    opts = namespaceOrOptions;
  } else {
    namespace = namespaceOrOptions;
    opts = options;
  }

  const chainComponent = normaliseComponent(chainId, 'Chain ID');
  const agentComponent = normaliseComponent(agentId, 'Agent ID');
  const encode = opts?.encode ?? true;
  const fragment = opts?.fragment ? opts.fragment.replace(/^#/, '').trim() : undefined;

  const prefix = DID_8004_PREFIX.slice(0, -1); // "did:8004"
  const segments = namespace
    ? [prefix, namespace, chainComponent, agentComponent]
    : [prefix, chainComponent, agentComponent];

  const baseDid = segments.join(':');
  const didWithFragment = fragment ? `${baseDid}#${fragment}` : baseDid;

  return encodeIfNeeded(didWithFragment, encode);
}

/**
 * Parse a did:8004 identifier.
 *
 * Accepts encoded or decoded strings and supports identifiers with or without
 * an intermediate namespace (e.g. did:8004:eip155:11155111:724).
 */
export function parse8004Did(raw: string | undefined | null): Parsed8004Did {
  const encodedInput = (raw ?? '').toString().trim();
  if (!encodedInput) {
    throw new Error('Missing did:8004 identifier');
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedInput);
  } catch (error) {
    throw new Error(`Invalid percent-encoding in did:8004 identifier: ${(error as Error).message}`);
  }

  const [baseDidRaw, fragment] = decoded.split('#', 2);
  const baseDid = baseDidRaw ?? '';

  if (!baseDid) {
    throw new Error(`Invalid did:8004 identifier: ${decoded}`);
  }

  if (!baseDid.startsWith(DID_8004_PREFIX)) {
    throw new Error(`Invalid did:8004 identifier: ${decoded}`);
  }

  const parts = baseDid.split(':');
  if (parts.length < 4 || parts[0] !== 'did' || parts[1] !== '8004') {
    throw new Error(`Malformed did:8004 identifier: ${decoded}`);
  }

  let namespace: string | undefined;
  let chainIndex = 2;
  if (parts.length >= 5) {
    namespace = parts[2];
    chainIndex = 3;
  }

  const chainComponent = parts[chainIndex];
  const agentComponent = parts.slice(chainIndex + 1).join(':');

  if (!chainComponent) {
    throw new Error(`Chain id missing in did:8004 identifier: ${decoded}`);
  }

  const chainId = Number.parseInt(chainComponent, 10);
  if (!Number.isFinite(chainId)) {
    throw new Error(`Invalid chain id in did:8004 identifier: ${decoded}`);
  }

  const agentId = agentComponent.trim();
  if (!agentId) {
    throw new Error(`Agent id missing in did:8004 identifier: ${decoded}`);
  }

  return {
    did: baseDid,
    method: '8004',
    namespace,
    chainId,
    agentId,
    fragment: fragment?.trim() || undefined,
    encoded: encodeIfNeeded(baseDid + (fragment ? `#${fragment}` : ''), true),
  };
}

