const ENS_DID_PREFIX = 'did:ens:';

export interface ParsedEnsDid {
  ensName: string;
  chainId: number;
}

export function parseEnsDid(raw: string | undefined | null): ParsedEnsDid {
  const decoded = decodeURIComponent((raw ?? '').trim());
  if (!decoded) {
    throw new Error('Missing ENS DID parameter');
  }

  if (!decoded.startsWith(ENS_DID_PREFIX)) {
    throw new Error(`Invalid ENS DID format: ${decoded}. Expected format: did:ens:chainId:ensname`);
  }

  const parts = decoded.split(':');
  if (parts.length < 4) {
    throw new Error(`ENS DID missing components: ${decoded}. Expected format: did:ens:chainId:ensname`);
  }

  const chainIdPart = parts[2];
  const ensNamePart = parts.slice(3).join(':').trim();

  const chainId = Number.parseInt(chainIdPart, 10);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error(`Invalid chainId in ENS DID: ${decoded}`);
  }

  if (!ensNamePart) {
    throw new Error(`Invalid ENS name in ENS DID: ${decoded}`);
  }

  return {
    chainId,
    ensName: ensNamePart,
  };
}

export function buildEnsDid(chainId: number | string, ensName: string): string {
  const chainIdStr = typeof chainId === 'number' ? chainId.toString(10) : chainId?.toString() ?? '';
  const ensNameStr = ensName?.toString() ?? '';

  const normalizedChainId = chainIdStr.trim();
  const normalizedEnsName = ensNameStr.trim();

  if (!normalizedChainId) {
    throw new Error('Chain ID is required to build ENS DID');
  }

  if (!normalizedEnsName) {
    throw new Error('ENS name is required to build ENS DID');
  }

  const chainIdNum = Number.parseInt(normalizedChainId, 10);
  if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
    throw new Error(`Invalid chain ID: ${normalizedChainId}`);
  }

  const did = `${ENS_DID_PREFIX}${normalizedChainId}:${normalizedEnsName}`;
  return encodeURIComponent(did);
}

/**
 * Build an ENS DID from agent name and organization name
 * 
 * @param chainId - Chain ID where the ENS name should be registered
 * @param agentName - The agent name (e.g., "my-agent" or "My Agent")
 * @param orgName - The organization name (e.g., "8004-agent" or "8004-agent.eth")
 * @returns URL-encoded ENS DID string (e.g., "did:ens:11155111:my-agent.8004-agent.eth")
 */
export function buildEnsDidFromAgentAndOrg(
  chainId: number | string,
  agentName: string,
  orgName: string
): string {
  if (!agentName || typeof agentName !== 'string') {
    throw new Error('Agent name is required');
  }

  if (!orgName || typeof orgName !== 'string') {
    throw new Error('Organization name is required');
  }

  // Normalize agent name: lowercase and replace spaces with hyphens
  const agentNameLabel = agentName.trim().toLowerCase().replace(/\s+/g, '-');
  if (!agentNameLabel) {
    throw new Error('Agent name cannot be empty');
  }

  // Normalize org name: lowercase and remove .eth suffix if present
  const orgNameClean = orgName.trim().toLowerCase().replace(/\.eth$/i, '');
  if (!orgNameClean) {
    throw new Error('Organization name cannot be empty');
  }

  // Construct full ENS name: agentName.orgName.eth
  const fullEnsName = `${agentNameLabel}.${orgNameClean}.eth`;

  // Build and return encoded ENS DID
  return buildEnsDid(chainId, fullEnsName);
}

