/**
 * Agent Feedback API
 * 
 * Handles feedback authentication for agents
 */

import type { PublicClient, Account } from 'viem';
import { ethers } from 'ethers';
import type { AIAgentReputationClient } from '@erc8004/agentic-trust-sdk';
import { createRequire } from 'module';
import path from 'path';

// Import IdentityRegistry ABI
// Use createRequire for ES modules compatibility in Node.js
const require = createRequire(import.meta.url);

const getIdentityRegistryAbi = (): any => {
  // Use require() since this is server-side code (Next.js API routes)
  // require() works in Node.js and Next.js server-side environments
  // We resolve via package.json to avoid webpack bundling issues
  try {
    // First try: resolve from package.json location (most reliable in monorepos and Next.js)
    try {
      const packagePath = require.resolve('@erc8004/agentic-trust-sdk/package.json');
      const packageDir = path.dirname(packagePath);
      const abiPath = path.join(packageDir, 'abis', 'IdentityRegistry.json');
      
      // Verify file exists before requiring
      const fs = require('fs');
      if (fs.existsSync(abiPath)) {
        return require(abiPath);
      }
      throw new Error(`ABI file not found at ${abiPath}`);
    } catch (packageError: any) {
      // Fallback: try the exported path directly
      try {
        // Note: The exports pattern should match "./abis/IdentityRegistry.json"
        const abiPath = require.resolve('@erc8004/agentic-trust-sdk/abis/IdentityRegistry.json');
        return require(abiPath);
      } catch (resolveError: any) {
        // Last resort: try to find it in node_modules manually
        try {
          // Get the package directory from node_modules
          const corePackagePath = require.resolve('@agentic-trust/core/package.json');
          const corePackageDir = path.dirname(corePackagePath);
          const nodeModulesDir = path.join(corePackageDir, '..', '..');
          const sdkAbiPath = path.join(
            nodeModulesDir,
            '@erc8004',
            'agentic-trust-sdk',
            'abis',
            'IdentityRegistry.json'
          );
          const fs = require('fs');
          if (fs.existsSync(sdkAbiPath)) {
            return require(sdkAbiPath);
          }
          throw new Error(`ABI file not found at ${sdkAbiPath}`);
        } catch (nodeModulesError: any) {
          throw new Error(
            `IdentityRegistry ABI not available. ` +
            `Tried: package.json resolution (${packageError?.message || packageError}), ` +
            `exported path (${resolveError?.message || resolveError}), ` +
            `and node_modules path (${nodeModulesError?.message || nodeModulesError}).`
          );
        }
      }
    }
  } catch (error: any) {
    throw new Error(
      `Failed to load IdentityRegistry ABI: ${error?.message || error}`
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

  // Load IdentityRegistry ABI (synchronous since we use require)
  const identityRegistryAbi = getIdentityRegistryAbi();

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

  return signature as `0x${string}`;
}

