/**
 * Agent Feedback API
 * 
 * Handles feedback authentication for agents
 */

import type { PublicClient, Account } from 'viem';
import { ethers } from 'ethers';
import type { AIAgentReputationClient } from '@erc8004/agentic-trust-sdk';

// Cache for the ABI to avoid reloading it multiple times
let abiCache: any = null;

/**
 * Load IdentityRegistry ABI using dynamic import
 * NOTE: This function should only be called server-side (Next.js API routes)
 */
const getIdentityRegistryAbi = async (): Promise<any> => {
  // Return cached ABI if available
  if (abiCache) {
    return abiCache;
  }

  // Dynamic import works with webpack's module resolution and the package.json exports
  try {
    const abiModule = await import('@erc8004/agentic-trust-sdk/abis/IdentityRegistry.json');
    abiCache = abiModule.default || abiModule;
    return abiCache;
  } catch (error: any) {
    throw new Error(
      `Failed to load IdentityRegistry ABI: ${error?.message || error}. ` +
      `Make sure @erc8004/agentic-trust-sdk is installed and the ABI file exists.`
    );
  }
};

export interface RequestAuthParams {
  publicClient: PublicClient;
  reputationRegistry: `0x${string}`;
  agentId: bigint;
  clientAddress: `0x${string}`;
  signer: Account;
  walletClient?: any;
  indexLimitOverride?: bigint;
  expirySeconds?: number;
  chainIdOverride?: bigint;
}

/**
 * Create feedback auth signature
 */
export async function createFeedbackAuth(
  params: RequestAuthParams,
  reputationClient: AIAgentReputationClient
): Promise<`0x${string}`> {
  const {
    publicClient,
    reputationRegistry,
    agentId,
    clientAddress,
    signer,
    walletClient,
    indexLimitOverride,
    expirySeconds = 3600,
    chainIdOverride,
  } = params;

  // Get identity registry from reputation client
  const identityReg = await reputationClient.getIdentityRegistry();

  // Load IdentityRegistry ABI (async dynamic import)
  const identityRegistryAbi = await getIdentityRegistryAbi();

  // Ensure IdentityRegistry operator approvals are configured for sessionAA
  console.info("**********************************");
  try {
    const ownerOfAgent = await publicClient.readContract({
      address: identityReg as `0x${string}`,
      abi: identityRegistryAbi as any,
      functionName: 'ownerOf' as any,
      args: [agentId],
    }) as `0x${string}`;

    const isOperator = await publicClient.readContract({
      address: identityReg as `0x${string}`,
      abi: identityRegistryAbi as any,
      functionName: 'isApprovedForAll' as any,
      args: [ownerOfAgent, signer.address as `0x${string}`],
    }) as boolean;

    const tokenApproved = await publicClient.readContract({
      address: identityReg as `0x${string}`,
      abi: identityRegistryAbi as any,
      functionName: 'getApproved' as any,
      args: [agentId],
    }) as `0x${string}`;

    console.info('IdentityRegistry approvals:', { ownerOfAgent, isOperator, tokenApproved });
    if (!isOperator && tokenApproved.toLowerCase() !== (signer.address as string).toLowerCase()) {
      throw new Error(`IdentityRegistry approval missing: neither isApprovedForAll nor getApproved`);
    }
  } catch (e: any) {
    console.warn('[IdentityRegistry] approval check failed:', e?.message || e);
    throw e;
  }

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const chainId = chainIdOverride ?? BigInt(publicClient.chain?.id ?? 0);

  const U64_MAX = 18446744073709551615n;
  const lastIndexFetched = indexLimitOverride !== undefined
    ? (indexLimitOverride - 1n)
    : await reputationClient.getLastIndex(agentId, clientAddress);
  let indexLimit = lastIndexFetched + 1n;
  let expiry = nowSec + BigInt(expirySeconds);
  if (expiry > U64_MAX) {
    console.warn('[FeedbackAuth] Computed expiry exceeds uint64; clamping to max');
    expiry = U64_MAX;
  }

  // Build FeedbackAuth struct via ReputationClient
  const authStruct = reputationClient.createFeedbackAuth(
    agentId,
    clientAddress,
    indexLimit,
    expiry,
    chainId,
    signer.address as `0x${string}`,
  );

  // Sign keccak256(encoded tuple) with provided signer (sessionAA via ERC-1271)
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'uint256', 'uint256', 'uint256', 'address', 'address'],
    [
      authStruct.agentId,
      authStruct.clientAddress,
      authStruct.indexLimit,
      authStruct.expiry,
      authStruct.chainId,
      authStruct.identityRegistry,
      authStruct.signerAddress,
    ]
  );
  const messageHash = ethers.keccak256(encoded) as `0x${string}`;
  
  // Sign the message hash using the wallet client
  if (!walletClient) {
    throw new Error('walletClient is required for signing feedback auth');
  }
  
  const signature = await walletClient.signMessage({
    account: signer,
    message: { raw: ethers.getBytes(messageHash) },
  });

  // Return encoded tuple + signature concatenated
  // Contract expects: encoded(FeedbackAuth struct) + signature
  // This matches the format expected by the contract's giveFeedback function
  const feedbackAuth = ethers.concat([encoded, signature]) as `0x${string}`;
  
  return feedbackAuth;
}

