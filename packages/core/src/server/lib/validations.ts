import { buildDid8004 } from '../../index';
import { getValidationClient } from '../singletons/validationClient';
import { keccak256, stringToHex, createPublicClient, http, createWalletClient, type Chain } from 'viem';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';
import { privateKeyToAccount } from 'viem/accounts';
import { getChainRpcUrl, getChainById, DEFAULT_CHAIN_ID, requireChainEnvVar } from './chainConfig';

export interface AgentValidationsSummary {
  agentId: string;
  chainId: number;
  did8004: string;
  pending: unknown[];
  completed: unknown[];
}

export async function getAgentValidationsSummary(
  chainId: number,
  agentId: string | number,
): Promise<AgentValidationsSummary> {
  const client = await getValidationClient(chainId);

  const numericAgentId =
    typeof agentId === 'string' ? Number.parseInt(agentId, 10) : Number(agentId);
  if (!Number.isFinite(numericAgentId) || numericAgentId <= 0) {
    throw new Error('Invalid agentId');
  }

  const agentIdBigInt = BigInt(numericAgentId);

  const requestHashes = await client.getAgentValidations(agentIdBigInt);

  const pending: unknown[] = [];
  const completed: unknown[] = [];

  for (const hash of requestHashes) {
    try {
      const status = await client.getValidationStatus(hash);
      if (status.response === 0) {
        pending.push(status);
      } else {
        completed.push(status);
      }
    } catch {
      // Ignore invalid entries but continue
    }
  }

  const did8004 = buildDid8004(chainId, numericAgentId);

  return {
    agentId: String(numericAgentId),
    chainId,
    did8004,
    pending,
    completed,
  };
}

/**
 * Create a validator account abstraction using the name 'validator-ens' as the seed from a private key.
 * The validator address is determined server-side based on AGENTIC_TRUST_VALIDATOR_ENS_PRIVATE_KEY.
 */
export async function createValidatorAccountAbstraction(
  validatorPrivateKey: string,
  chainId?: number,
): Promise<{ accountClient: any; address: `0x${string}` }> {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  const chain = getChainById(targetChainId) as Chain;
  const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);

  // Normalize private key
  const normalizedKey = validatorPrivateKey.startsWith('0x') 
    ? validatorPrivateKey 
    : `0x${validatorPrivateKey}`;

  // Create account from private key
  const account = privateKeyToAccount(normalizedKey as `0x${string}`);
  const eoaAddress = account.address;

  // Create public and wallet clients
  const publicClient = createPublicClient({
    chain: chain as any,
    transport: http(rpcUrl),
  }) as any;

  const walletClient = createWalletClient({
    account,
    chain: chain as any,
    transport: http(rpcUrl),
  }) as any;

  // Create salt from validator name 'validator-ens'
  const validatorName = 'validator-ens';
  const salt: `0x${string}` = keccak256(stringToHex(validatorName)) as `0x${string}`;

  // Create account abstraction with validator name as seed
  const clientConfig: Record<string, unknown> = {
    client: publicClient,
    implementation: Implementation.Hybrid,
    signer: {
      walletClient,
    },
    deployParams: [eoaAddress as `0x${string}`, [], [], []],
    deploySalt: salt,
  };

  const accountClient = await toMetaMaskSmartAccount(clientConfig as any);
  const validatorAddress = accountClient.address as `0x${string}`;

  return { accountClient, address: validatorAddress };
}


