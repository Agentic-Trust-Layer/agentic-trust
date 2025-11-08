import { getENSClient } from '../singletons/ensClient';
import { getDiscoveryClient } from '../singletons/discoveryClient';

export type AgentAccountResolution = {
  account: `0x${string}` | null;
  method: 'ens-identity' | 'ens-direct' | 'discovery' | 'deterministic' | null;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function isValidAddress(value: unknown): value is `0x${string}` {
  return (
    typeof value === 'string' &&
    value.startsWith('0x') &&
    value.length === 42 &&
    value.toLowerCase() !== ZERO_ADDRESS
  );
}

export function extractAgentAccountFromDiscovery(agent: unknown): `0x${string}` | null {
  if (!agent || typeof agent !== 'object') {
    return null;
  }

  const record = agent as Record<string, unknown>;

  const directAccount = record.agentAccount;
  if (isValidAddress(directAccount)) {
    return directAccount;
  }

  const endpoint = record.agentAccountEndpoint;
  if (typeof endpoint === 'string' && endpoint.includes(':')) {
    const parts = endpoint.split(':');
    const maybeAccount = parts[parts.length - 1];
    if (isValidAddress(maybeAccount)) {
      return maybeAccount as `0x${string}`;
    }
  }

  const rawJson = record.rawJson;
  if (typeof rawJson === 'string' && rawJson.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const rawAccount =
        parsed.agentAccount ||
        (parsed.agent && typeof parsed.agent === 'object'
          ? (parsed.agent as Record<string, unknown>).account
          : undefined) ||
        parsed.account;

      if (isValidAddress(rawAccount)) {
        return rawAccount as `0x${string}`;
      }
    } catch (error) {
      console.warn('Failed to parse discovery agent rawJson:', error);
    }
  }

  return null;
}

/**
 * Resolve the agent account address using ENS. Falls back to deterministic indication when not found.
 */
export async function getAgentAccountByAgentName(agentName: string): Promise<AgentAccountResolution> {
  const trimmed = agentName?.trim();

  if (!trimmed) {
    return {
      account: null,
      method: null,
    };
  }

  try {
    const ensClient = await getENSClient();

    if (!ensClient) {
      return {
        account: null,
        method: null,
      };
    }

    const ensRegistryAddress = (ensClient as any)?.ensRegistryAddress as string | undefined;
    if (!isValidAddress(ensRegistryAddress)) {
      return {
        account: null,
        method: null,
      };
    }

    try {
      const { account } = await ensClient.getAgentIdentityByName(trimmed);
      if (isValidAddress(account)) {
        return {
          account,
          method: 'ens-identity',
        };
      }
    } catch (ensError) {
      console.warn('ENS identity resolution failed:', ensError);
    }

    try {
      const directAccount = await ensClient.getAgentAccountByName(trimmed);
      if (isValidAddress(directAccount)) {
        return {
          account: directAccount,
          method: 'ens-direct',
        };
      }
    } catch (ensError) {
      console.warn('ENS direct resolution failed:', ensError);
    }

    try {
      const discoveryClient = await getDiscoveryClient();
      if (discoveryClient) {
        try {
          const agent = await discoveryClient.getAgentByName(trimmed);
          const account = extractAgentAccountFromDiscovery(agent);

          if (isValidAddress(account)) {
            return {
              account,
              method: 'discovery',
            };
          }
        } catch (discoveryError) {
          console.warn('Discovery client lookup failed:', discoveryError);
        }
      }
    } catch (discoveryInitError) {
      console.warn('Failed to initialize discovery client for account lookup:', discoveryInitError);
    }

    return {
      account: null,
      method: 'deterministic',
    };
  } catch (error) {
    console.error('Error resolving agent account by name:', error);
    return {
      account: null,
      method: null,
    };
  }
}
