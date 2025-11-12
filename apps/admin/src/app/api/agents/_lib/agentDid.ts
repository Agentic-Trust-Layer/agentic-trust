const AGENT_DID_PREFIX = 'did:agent:';

export interface ParsedAgentDid {
  agentId: string;
  chainId: number;
}

export function parseAgentDid(raw: string | undefined | null): ParsedAgentDid {
  const decoded = decodeURIComponent((raw ?? '').trim());
  if (!decoded) {
    throw new Error('Missing agent DID parameter');
  }

  if (!decoded.startsWith(AGENT_DID_PREFIX)) {
    throw new Error(`Invalid agent DID format: ${decoded}`);
  }

  const parts = decoded.split(':');
  if (parts.length < 4) {
    throw new Error(`Agent DID missing components: ${decoded}`);
  }

  const chainIdPart = parts[2];
  const agentIdPart = parts.slice(3).join(':').trim();

  const chainId = Number.parseInt(chainIdPart, 10);
  if (!Number.isFinite(chainId)) {
    throw new Error(`Invalid chainId in agent DID: ${decoded}`);
  }

  if (!agentIdPart) {
    throw new Error(`Invalid agentId in agent DID: ${decoded}`);
  }

  return {
    chainId,
    agentId: agentIdPart,
  };
}


