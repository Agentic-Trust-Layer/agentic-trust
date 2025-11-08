/**
 * Bundler Utilities for Account Abstraction
 * 
 * Provides utilities for sending UserOperations via bundlers
 * for Account Abstraction (AA) accounts
 */

import { createBundlerClient } from 'viem/account-abstraction';
import { http, zeroAddress, type Chain } from 'viem';

// Dynamic import for permissionless (optional dependency)
async function getPimlicoClient(bundlerUrl: string) {
  try {
    // @ts-ignore - permissionless is an optional dependency
    const { createPimlicoClient } = await import('permissionless/clients/pimlico');
    return createPimlicoClient({ transport: http(bundlerUrl) } as any);
  } catch (error) {
    throw new Error(
      'permissionless package not installed. Install it with: pnpm add permissionless ' +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Send a sponsored UserOperation via bundler
 * 
 * @param params - UserOperation parameters
 * @returns UserOperation hash
 */
export async function sendSponsoredUserOperation(params: {
  bundlerUrl: string;
  chain: Chain;
  accountClient: any; 
  calls: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }[];
}): Promise<`0x${string}`> {
  const { bundlerUrl, chain, accountClient, calls } = params;

  const pimlicoClient = await getPimlicoClient(bundlerUrl);
  const bundlerClient = createBundlerClient({ 
    transport: http(bundlerUrl), 
    paymaster: true as any,
    chain: chain as any, 
    paymasterContext: { mode: 'SPONSORED' } 
  } as any);

  const { fast: fee } = await (pimlicoClient as any).getUserOperationGasPrice();

  const userOpHash = await (bundlerClient as any).sendUserOperation({ 
    account: accountClient, 
    calls,
    ...fee
  });

  return userOpHash as `0x${string}`;
}

/**
 * Wait for UserOperation receipt
 * 
 * @param params - Receipt parameters
 * @returns UserOperation receipt
 */
export async function waitForUserOperationReceipt(params: {
  bundlerUrl: string;
  chain: Chain;
  hash: `0x${string}`;
}): Promise<any> {
  const { bundlerUrl, chain, hash } = params;

  const bundlerClient = createBundlerClient({ 
    transport: http(bundlerUrl), 
    paymaster: true as any,
    chain: chain as any, 
    paymasterContext: { mode: 'SPONSORED' } 
  } as any);

  return await (bundlerClient as any).waitForUserOperationReceipt({ hash });
}

/**
 * Deploy smart account if needed
 * 
 * @param params - Deployment parameters
 * @returns true if account was deployed, false if already deployed
 */
export async function deploySmartAccountIfNeeded(params: {
  bundlerUrl: string;
  chain: Chain;
  account: { isDeployed: () => Promise<boolean> };
}): Promise<boolean> {
  const { bundlerUrl, chain, account } = params;

  const isDeployed = await account.isDeployed();
  if (isDeployed) return false;

  const pimlico = await getPimlicoClient(bundlerUrl);
  const bundlerClient = createBundlerClient({ 
    transport: http(bundlerUrl), 
    paymaster: true as any, 
    chain: chain as any, 
    paymasterContext: { mode: 'SPONSORED' } 
  } as any);

  const { fast } = await (pimlico as any).getUserOperationGasPrice();

  const userOperationHash = await (bundlerClient as any).sendUserOperation({ 
    account, 
    calls: [{ to: zeroAddress }], 
    ...fast 
  });

  await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOperationHash });

  return true;
}

/**
 * Check if an address is a smart contract (has code)
 * 
 * @param publicClient - Viem public client
 * @param address - Address to check
 * @returns true if address has code (is a contract), false if EOA
 */
export async function isSmartContract(
  publicClient: any,
  address: `0x${string}`
): Promise<boolean> {
  try {
    const code = await publicClient.getBytecode({ address });
    return code !== undefined && code !== '0x';
  } catch {
    return false;
  }
}

