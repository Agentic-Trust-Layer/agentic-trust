import type { ValidationStatus } from '@agentic-trust/8004-sdk';
import { buildDid8004 } from '../../index';
import { getValidationRegistryClient } from '../singletons/validationClient';
import { keccak256, stringToHex, createPublicClient, http, createWalletClient, type Chain } from 'viem';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/smart-accounts-kit';
import { privateKeyToAccount } from 'viem/accounts';
import { getChainRpcUrl, getChainById, DEFAULT_CHAIN_ID, requireChainEnvVar } from './chainConfig';

export interface ValidationStatusWithHash extends ValidationStatus {
  requestHash: string;
}

export interface AgentValidationsSummary {
  agentId: string;
  chainId: number;
  did8004: string;
  pending: ValidationStatusWithHash[];
  completed: ValidationStatusWithHash[];
}

export async function getAgentValidationsSummary(
  chainId: number,
  agentId: string | number,
): Promise<AgentValidationsSummary> {
  const client = await getValidationRegistryClient(chainId);

  const numericAgentId =
    typeof agentId === 'string' ? Number.parseInt(agentId, 10) : Number(agentId);
  if (!Number.isFinite(numericAgentId) || numericAgentId <= 0) {
    throw new Error('Invalid agentId');
  }

  const agentIdBigInt = BigInt(numericAgentId);

  const requestHashes = await client.getAgentValidations(agentIdBigInt);
  console.log(`[getAgentValidationsSummary] Found ${requestHashes.length} validation request hash(es) for agent ${numericAgentId} on chain ${chainId}`);

  const pending: ValidationStatusWithHash[] = [];
  const completed: ValidationStatusWithHash[] = [];

  for (const hash of requestHashes) {
    try {
      const status = await client.getValidationStatus(hash);
      console.log(`[getAgentValidationsSummary] Validation ${hash}: response=${status.response}, validator=${status.validatorAddress}`);
      const entry: ValidationStatusWithHash = {
        requestHash: hash,
        ...status,
      };
      if (status.response === 0) {
        pending.push(entry);
      } else {
        completed.push(entry);
      }
    } catch (error) {
      console.warn(`[getAgentValidationsSummary] Failed to get status for hash ${hash}:`, error);
      // Ignore invalid entries but continue
    }
  }

  const did8004 = buildDid8004(chainId, numericAgentId);
  
  console.log(`[getAgentValidationsSummary] Summary for agent ${numericAgentId}: pending=${pending.length}, completed=${completed.length}`);

  return {
    agentId: String(numericAgentId),
    chainId,
    did8004,
    pending,
    completed,
  };
}

/**
 * Create a validator account abstraction using the name 'name-validator' as the seed from a private key.
 * The validator address is determined server-side based on AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY.
 */
export async function createValidatorAccountAbstraction(
  validatorName: string,
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

  // Create salt from validator name 'name-validator'

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

/**
 * Get validation requests for a validator address
 */
export async function getValidatorAddressValidations(
  chainId: number,
  validatorAddress: string,
): Promise<ValidationStatusWithHash[]> {
  const client = await getValidationRegistryClient(chainId);

  const requestHashes = await client.getValidatorRequests(validatorAddress);
  console.log(`[getValidatorAddressValidations] Found ${requestHashes.length} validation request hash(es) for validator ${validatorAddress} on chain ${chainId}`);

  const results: ValidationStatusWithHash[] = [];

  for (const hash of requestHashes) {
    try {
      const status = await client.getValidationStatus(hash);
      const entry: ValidationStatusWithHash = {
        requestHash: hash,
        ...status,
      };
      results.push(entry);
    } catch (error) {
      console.warn(`[getValidatorAddressValidations] Failed to get status for hash ${hash}:`, error);
      // Ignore invalid entries but continue
    }
  }

  return results;
}


