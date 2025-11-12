const AGENT_DID_PREFIX = 'did:agent:';

export function buildAgentDid(
  chainId: number | string,
  agentId: number | string,
): string {
  const chainIdStr = typeof chainId === 'number' ? chainId.toString(10) : chainId?.toString() ?? '';
  const agentIdStr = typeof agentId === 'number' ? agentId.toString(10) : agentId?.toString() ?? '';

  const normalizedChainId = chainIdStr.trim();
  const normalizedAgentId = agentIdStr.trim();

  if (!normalizedChainId) {
    throw new Error('Chain ID is required to build agent DID');
  }

  if (!normalizedAgentId) {
    throw new Error('Agent ID is required to build agent DID');
  }

  const did = `${AGENT_DID_PREFIX}${normalizedChainId}:${normalizedAgentId}`;
  return encodeURIComponent(did);
}


