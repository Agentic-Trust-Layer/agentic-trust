/**
 * Server-side utilities for account operations
 * 
 * This module provides utilities for:
 * - Getting account owners (EOA) from account addresses
 * - Resolving agent account addresses by name
 * - Computing counterfactual AA addresses (private key mode only)
 * - Parsing PKH DIDs
 */

import { keccak256, stringToHex, createPublicClient, http, type PublicClient } from 'viem';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';
import { getIdentityClient } from '../singletons/identityClient';
import { getENSClient } from '../singletons/ensClient';
import { getDiscoveryClient } from '../singletons/discoveryClient';
import { getAdminApp } from '../userApps/adminApp';
import { DEFAULT_CHAIN_ID, type SupportedChainId, isChainSupported, getChainById, getChainRpcUrl } from './chainConfig';

// ============================================================================
// PKH DID Parsing
// ============================================================================

const PKH_DID_PREFIX = 'did:pkh:';

export interface ParsedPkhDid {
  account: `0x${string}`;
  chainId: number;
}

/**
 * Parse a did:pkh DID to extract chainId and account address
 * 
 * @param didPkh - The did:pkh string (e.g., "did:pkh:11155111:0x1234..." or "did:pkh:0x1234...")
 * @returns Parsed DID with chainId and account address
 */
export function parsePkhDid(didPkh: string): ParsedPkhDid {
  const decoded = decodeURIComponent((didPkh || '').trim());
  if (!decoded) {
    throw new Error('Missing PKH DID parameter');
  }

  if (!decoded.startsWith(PKH_DID_PREFIX)) {
    throw new Error(`Invalid PKH DID format: ${decoded}. Expected format: did:pkh:chainId:account or did:pkh:account`);
  }

  const segments = decoded.split(':');
  const accountCandidate = segments[segments.length - 1];
  
  if (!accountCandidate || !accountCandidate.startsWith('0x')) {
    throw new Error('PKH DID is missing account component');
  }

  // Try to find chainId in the remaining segments
  const remaining = segments.slice(2, -1);
  let chainId: number = DEFAULT_CHAIN_ID;

  for (let i = remaining.length - 1; i >= 0; i -= 1) {
    const value = remaining[i];
    if (value && /^\d+$/.test(value)) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        chainId = parsed;
        break;
      }
    }
  }

  // Validate chain ID is supported (or use default) - but allow any numeric chainId
  if (!isChainSupported(chainId)) {
    console.warn(`Chain ID ${chainId} is not in supported list, but will attempt to use it`);
    // Note: We still allow unsupported chainIds since getIdentityClient may support them
  }

  // Validate account address
  if (accountCandidate.length !== 42 || !/^0x[a-fA-F0-9]{40}$/.test(accountCandidate)) {
    throw new Error('Invalid account address in PKH DID');
  }

  return {
    chainId,
    account: accountCandidate as `0x${string}`,
  };
}

// ============================================================================
// Account Owner Resolution
// ============================================================================

/**
 * Get the owner (EOA) of an account address using did:pkh format
 * 
 * @param didPkh - The did:pkh string (e.g., "did:pkh:11155111:0x1234...")
 * @returns The owner address (EOA) or null if not found or error
 */
export async function getAccountOwnerByDidPkh(didPkh: string): Promise<string | null> {
  try {
    const { chainId, account } = parsePkhDid(didPkh);
    const identityClient = await getIdentityClient(chainId);
    return await identityClient.getAccountOwner(account);
  } catch (error) {
    console.error('Error getting account owner by DID PKH:', error);
    return null;
  }
}

/**
 * Get the owner (EOA) of an account address
 * 
 * @param accountAddress - The account address (smart account or contract)
 * @param chainId - Chain ID where the account is deployed (defaults to DEFAULT_CHAIN_ID)
 * @returns The owner address (EOA) or null if not found or error
 */
export async function getAccountOwner(
  accountAddress: `0x${string}`,
  chainId?: number
): Promise<string | null> {
  try {
    const targetChainId = chainId || DEFAULT_CHAIN_ID;
    const identityClient = await getIdentityClient(targetChainId);
    return await identityClient.getAccountOwner(accountAddress);
  } catch (error) {
    console.error('Error getting account owner:', error);
    return null;
  }
}

// ============================================================================
// Agent Account Resolution
// ============================================================================

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

// ============================================================================
// Counterfactual AA Address Computation (Private Key Mode)
// ============================================================================

/**
 * Get the counterfactual AA address for an agent name (server-side computation with private key)
 * 
 * This function computes the AA address using the AdminApp's private key.
 * It should only be used when the server has a private key configured (private key mode).
 * 
 * @param agentName - The agent name
 * @param chainId - Chain ID (defaults to DEFAULT_CHAIN_ID)
 * @returns The counterfactual AA address
 */
export async function getCounterfactualAAAddressByAgentName(
  agentName: string,
  chainId?: number
): Promise<`0x${string}`> {
  if (!agentName || agentName.trim().length === 0) {
    throw new Error('agentName is required');
  }
  
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  const adminApp = await getAdminApp(undefined, targetChainId);
  
  if (!adminApp) {
    throw new Error('AdminApp not initialized. Private key mode is required for server-side counterfactual address computation.');
  }
  
  // Check hasPrivateKey first - this is the primary check
  if (!adminApp.hasPrivateKey) {
    throw new Error(
      'AdminApp does not have a private key. Private key mode is required for server-side counterfactual address computation. ' +
      'Set AGENTIC_TRUST_ADMIN_PRIVATE_KEY environment variable.'
    );
  }
  
  if (!adminApp.address) {
    throw new Error('AdminApp address is not available');
  }

  // Verify that we have either walletClient or account (required for signing)
  // Even if hasPrivateKey is true, we need to ensure the signatory is available
  if (!adminApp.walletClient && !adminApp.account) {
    throw new Error(
      'AdminApp does not have a signatory (walletClient or account). ' +
      'Private key mode is required, but AdminApp was initialized without a signatory. ' +
      'This may indicate that AGENTIC_TRUST_ADMIN_PRIVATE_KEY was not properly loaded from the environment.'
    );
  }

  const chain = getChainById(targetChainId);
  const rpcUrl = getChainRpcUrl(targetChainId);

  if (!rpcUrl) {
    throw new Error(`Missing RPC URL for chain ${targetChainId}. Configure AGENTIC_TRUST_RPC_URL_{CHAIN} environment variable.`);
  }

  // Use existing publicClient if available, else create an HTTP client
  const publicClient: PublicClient =
    (adminApp.publicClient as any) ||
    (createPublicClient({ chain: chain as any, transport: http(rpcUrl) }) as any);

  const salt = keccak256(stringToHex(agentName)) as `0x${string}`;

  // Create signatory object - must have either walletClient or account
  // toMetaMaskSmartAccount expects signatory to have either walletClient or account, not both
  // Prefer walletClient over account if both are available
  const signatory: { walletClient?: any; account?: any } = adminApp.walletClient
    ? { walletClient: adminApp.walletClient as any }
    : { account: adminApp.account! }; // Non-null assertion is safe because we check above

  const clientConfig: Record<string, unknown> = {
    client: publicClient,
    implementation: Implementation.Hybrid,
    // Use signatory (server-side) instead of signer (client-side)
    signatory,
    deployParams: [adminApp.address as `0x${string}`, [], [], []],
    deploySalt: salt,
  };

  const accountClient = await toMetaMaskSmartAccount(clientConfig as any);
  return accountClient.address as `0x${string}`;
}


