import { keccak256, stringToHex, createPublicClient, http, zeroAddress, createWalletClient, custom, getAddress, type Address, type Chain } from 'viem';
import { sepolia } from 'viem/chains';
import type { PublicClient, WalletClient } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import { getChainRpcUrl } from '../server/lib/chainConfig';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/smart-accounts-kit';

type GetAAAccountClientOptions = {
  chain?: Chain;
  publicClient?: PublicClient;
  walletClient?: WalletClient;
  ethereumProvider?: any;
  includeDeployParams?: boolean;
  accountAddress?: `0x${string}`;
};

/**
 * Get the counterfactual AA address for an agent name (client-side computation)
 * 
 * This function computes the AA address without creating a full account client.
 * It uses the wallet provider (MetaMask/Web3Auth) to compute the address.
 * 
 * @param agentName - The agent name
 * @param eoaAddress - The EOA address (owner of the AA account)
 * @param options - Options for chain, ethereumProvider, etc.
 * @returns The counterfactual AA address
 */
export async function getCounterfactualSmartAccountAddressByAgentName(
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: GetAAAccountClientOptions
): Promise<`0x${string}`> {
  // Use the existing function to get the account client, then return just the address
  const accountClient = await getCounterfactualAccountClientByAgentName(
    agentName,
    eoaAddress,
    options
  );
  return accountClient.address as `0x${string}`;
}

/**
 * @deprecated Use getCounterfactualSmartAccountAddressByAgentName
 */
export async function getCounterfactualAAAddressByAgentName(
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: GetAAAccountClientOptions,
): Promise<`0x${string}`> {
  return getCounterfactualSmartAccountAddressByAgentName(agentName, eoaAddress, options);
}

export async function getCounterfactualAccountClientByAgentName(
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: GetAAAccountClientOptions
): Promise<any> {

  const chain = options?.chain || sepolia;

  let walletClient: WalletClient;
  if (options?.walletClient) {
    walletClient = options.walletClient;
  } 
  else if (options?.ethereumProvider) {
    walletClient = createWalletClient({
      chain: chain as any,
      transport: custom(options.ethereumProvider),
      account: eoaAddress as Address,
    });
  }
  else {
    throw new Error('No wallet client found. Ensure MetaMask/Web3Auth is available or pass walletClient in options.');
  }


  let publicClient: PublicClient;
  if (options?.publicClient) {
    publicClient = options.publicClient;
  }
  else if (options?.ethereumProvider) {
    publicClient = createPublicClient({
      chain: chain as any,
      transport: custom(options?.ethereumProvider),
    }) as any;
  }
  else {
    throw new Error('No public client found. Ensure RPC URL is available or pass publicClient in options.');
  }
  
  const salt: `0x${string}` = keccak256(stringToHex(agentName)) as `0x${string}`;
  const clientConfig: Record<string, unknown> = {
    client: publicClient,
    implementation: Implementation.Hybrid,
    signer: {
      walletClient,
    },
    deployParams: [eoaAddress as `0x${string}`, [], [], []],
    deploySalt: salt,
  };

  let counterfactualAccountClient  = await toMetaMaskSmartAccount(clientConfig as any);

  return counterfactualAccountClient;
}

/**
 * Build a deployed MetaMask smart account client from a known smart account address.
 * Prefer this when you already know the correct agent smart account address (agentAccount),
 * since name-based derivation is case-sensitive.
 */
export async function getDeployedAccountClientByAddress(
  accountAddress: `0x${string}`,
  eoaAddress: `0x${string}`,
  options?: GetAAAccountClientOptions,
): Promise<any> {
  const chain = options?.chain || sepolia;

  // Ensure eoaAddress is properly formatted (normalize once at the start)
  const normalizedEoa = getAddress(eoaAddress) as Address;

  let walletClient: WalletClient;
  if (options?.walletClient) {
    walletClient = options.walletClient;
  } else if (options?.ethereumProvider) {
    // Use the connected user's MetaMask wallet to sign user operations
    // This is the same pattern used for giving feedback and registering agents
    walletClient = createWalletClient({
      chain: chain as any,
      transport: custom(options.ethereumProvider),
      account: normalizedEoa,
    });
    console.log('[getDeployedAccountClientByAddress] Created wallet client with connected user account:', normalizedEoa);
  } else {
    throw new Error(
      'No wallet client found. Ensure MetaMask/Web3Auth is available or pass walletClient in options.',
    );
  }

  const rpcUrl = getChainRpcUrl(chain.id);
  const publicClient: PublicClient = options?.publicClient
    ? options.publicClient
    : (createPublicClient({
        chain: chain as any,
        transport: rpcUrl ? http(rpcUrl) : custom(options?.ethereumProvider),
      }) as any);

  // Create account client with the connected user's wallet as the signer
  // This ensures MetaMask will prompt for signatures when sending user operations
  const accountClient = await toMetaMaskSmartAccount({
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    signer: { walletClient } as any,
    address: accountAddress,
  } as any);

  console.log('[getDeployedAccountClientByAddress] Created account client with connected user signer:', {
    accountAddress,
    eoaAddress: normalizedEoa,
    hasWalletClient: !!walletClient,
    walletClientAccount: walletClient?.account?.address,
  });

  return accountClient;
}


export async function getDeployedAccountClientByAgentName(
  bundlerUrl: string,
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: GetAAAccountClientOptions
): Promise<any> {
  // Extract only the name to the left of the first '.'
  const normalizedAgentName = agentName.includes('.') ? agentName.split('.')[0] : agentName;
  
  // Ensure we have a valid non-empty string
  if (!normalizedAgentName || normalizedAgentName.trim().length === 0) {
    throw new Error('Agent name is required and cannot be empty');
  }

  const chain = options?.chain || sepolia;
  console.info('*********** accountClient getDeployedAccountClientByAgentName: agentName', agentName, 'normalized:', normalizedAgentName);



  let walletClient: WalletClient;
  if (options?.walletClient) {
    walletClient = options.walletClient;
  } 
  else if (options?.ethereumProvider) {
    walletClient = createWalletClient({
      chain: chain as any,
      transport: custom(options.ethereumProvider),
      account: eoaAddress as Address,
    });
  }
  else {
    throw new Error('No wallet client found. Ensure MetaMask/Web3Auth is available or pass walletClient in options.');
  }


  let publicClient: PublicClient;
  if (options?.publicClient) {
    publicClient = options.publicClient;
  }
  else if (options?.ethereumProvider) {
    publicClient = createPublicClient({
      chain: chain as any,
      transport: custom(options?.ethereumProvider),
    }) as any;
  }
  else {
    throw new Error('No public client found. Ensure RPC URL is available or pass publicClient in options.');
  }

  const salt: `0x${string}` = keccak256(stringToHex(normalizedAgentName)) as `0x${string}`;
  const clientConfig: Record<string, unknown> = {
    client: publicClient,
    implementation: Implementation.Hybrid,
    signer: {
      walletClient,
    },
    deployParams: [eoaAddress as `0x${string}`, [], [], []],
    deploySalt: salt,
  };

  let counterfactualAccountClient  = await toMetaMaskSmartAccount(clientConfig as any);

  // Check deployment status with provided publicClient, then fall back to HTTP RPC if available
  let isDeployed = false;
  try {
    const code = await publicClient.getBytecode({ address: counterfactualAccountClient.address });
    isDeployed = !!code && code !== "0x";
  } catch {}
  if (!isDeployed) {
    try {
      const rpcUrl = getChainRpcUrl(chain.id);
      console.info('*********** accountClient getDeployedAccountClientByAgentName: checking on RPC', rpcUrl);
      if (rpcUrl) {
        const httpClient = createPublicClient({ chain: chain as any, transport: http(rpcUrl) });
        const codeHttp = await httpClient.getBytecode({ address: counterfactualAccountClient.address });
        isDeployed = !!codeHttp && codeHttp !== "0x";
      }
    } catch {}
  }

  console.info('*********** accountClient getDeployedAccountClientByAgentName: isDeployed', isDeployed);
  if (!isDeployed && bundlerUrl) {
      console.info('*********** accountClient getDeployedAccountClientByAgentName: deploying via bundler');
      const pimlico = await getPimlicoClient(bundlerUrl);
      const bundlerClient = createBundlerClient({
        transport: http(bundlerUrl),
        paymaster: true as any,
        chain: chain as any,
        paymasterContext: { mode: 'SPONSORED' },
      } as any);
      const { fast: fee } = await (pimlico as any).getUserOperationGasPrice();
      console.info('*********** accountClient getDeployedAccountClientByAgentName: gas price', fee);
      const userOperationHash = await (bundlerClient as any).sendUserOperation({
        account: counterfactualAccountClient as any,
        calls: [ { to: zeroAddress } ],
        ...fee,
      });
      console.info('*********** accountClient getDeployedAccountClientByAgentName: userOperationHash', userOperationHash);
      await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOperationHash });

      // After deployment, mark as deployed so we rebuild below
      isDeployed = true;
  }

  if (isDeployed) {
    // Rebuild a "clean" smart account client with address only (no factory/deploy params)
    // using an HTTP public client to avoid provider quirks.
    try {
      const rpcUrl = getChainRpcUrl(chain.id);
      const httpClient = createPublicClient({ chain: chain as any, transport: http(rpcUrl) }) as any;
      console.info('*********** accountClient getDeployedAccountClientByAgentName: rebuilding deployed account client (address-only)');
      const deployedAccountClient = await toMetaMaskSmartAccount({
        client: httpClient,
        implementation: Implementation.Hybrid,
        signer: {
          walletClient: walletClient as any,
        },
        address: counterfactualAccountClient.address,
      });
      console.info('*********** accountClient getDeployedAccountClientByAgentName: agentAccountClient', deployedAccountClient.address);
      return deployedAccountClient;
    } catch (rebuildErr) {
      console.warn('*********** accountClient getDeployedAccountClientByAgentName: rebuild failed, falling back to existing client', rebuildErr);
      return counterfactualAccountClient;
    }
  }

  console.info('*********** accountClient getDeployedAccountClientByAgentName: agentAccountClient', counterfactualAccountClient.address);
  return counterfactualAccountClient;
}

// ============================================================================
// Bundler Utilities
// ============================================================================

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

  console.log('[sendSponsoredUserOperation] Preparing user operation:', {
    bundlerUrl,
    chainId: chain.id,
    callsCount: calls.length,
    accountClientAddress: accountClient?.address,
    hasAccountClient: !!accountClient,
  });

  const pimlicoClient = await getPimlicoClient(bundlerUrl);
  const bundlerClient = createBundlerClient({ 
    transport: http(bundlerUrl), 
    paymaster: true as any,
    chain: chain as any, 
    paymasterContext: { mode: 'SPONSORED' } 
  } as any);

  const { fast: fee } = await (pimlicoClient as any).getUserOperationGasPrice();

  console.log('[sendSponsoredUserOperation] Sending user operation (MetaMask should prompt for signature)...');
  try {
    const userOpHash = await (bundlerClient as any).sendUserOperation({
      account: accountClient,
      calls,
      ...fee,
    });

    console.log('[sendSponsoredUserOperation] User operation sent:', userOpHash);
    return userOpHash as `0x${string}`;
  } catch (err) {
    // Ensure upstream UIs always get a human-readable message.
    const anyErr = err as any;
    const parts: string[] = [];
    const shortMessage = typeof anyErr?.shortMessage === 'string' ? anyErr.shortMessage : '';
    const message = typeof anyErr?.message === 'string' ? anyErr.message : '';
    const details = typeof anyErr?.details === 'string' ? anyErr.details : '';
    const causeMsg =
      typeof anyErr?.cause?.shortMessage === 'string'
        ? anyErr.cause.shortMessage
        : typeof anyErr?.cause?.message === 'string'
          ? anyErr.cause.message
          : '';
    const metaMessagesRaw = Array.isArray(anyErr?.metaMessages)
      ? anyErr.metaMessages
      : Array.isArray(anyErr?.cause?.metaMessages)
        ? anyErr.cause.metaMessages
        : null;
    const metaMessages = metaMessagesRaw ? metaMessagesRaw.map((m: any) => String(m)) : null;
    if (shortMessage) parts.push(shortMessage);
    if (message && message !== shortMessage) parts.push(message);
    if (details && details !== message) parts.push(details);
    if (causeMsg && !parts.includes(causeMsg)) parts.push(causeMsg);
    if (metaMessages?.length) parts.push(`metaMessages:\n- ${metaMessages.join('\n- ')}`);

    let errorJson = '';
    try {
      errorJson = JSON.stringify(
        {
          name: anyErr?.name,
          code: anyErr?.code,
          message: anyErr?.message,
          shortMessage: anyErr?.shortMessage,
          details: anyErr?.details,
          data: anyErr?.data,
          metaMessages,
          cause: anyErr?.cause
            ? {
                name: anyErr.cause?.name,
                code: anyErr.cause?.code,
                message: anyErr.cause?.message,
                shortMessage: anyErr.cause?.shortMessage,
                details: anyErr.cause?.details,
                data: anyErr.cause?.data,
                metaMessages: Array.isArray(anyErr.cause?.metaMessages)
                  ? anyErr.cause.metaMessages.map((m: any) => String(m))
                  : undefined,
              }
            : undefined,
        },
        null,
        2,
      );
    } catch {
      // ignore
    }

    const summary = parts.filter(Boolean).join(' | ') || 'Unknown bundler error';
    const suffix = errorJson ? `\n\nBundler error details:\n${errorJson}` : '';
    throw new Error(`Bundler sendUserOperation failed: ${summary}${suffix}`);
  }
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

  try {
    return await (bundlerClient as any).waitForUserOperationReceipt({ hash });
  } catch (err) {
    const anyErr = err as any;
    const msg =
      (typeof anyErr?.shortMessage === 'string' && anyErr.shortMessage) ||
      (typeof anyErr?.details === 'string' && anyErr.details) ||
      (typeof anyErr?.message === 'string' && anyErr.message) ||
      String(err);
    throw new Error(`Bundler waitForUserOperationReceipt failed: ${msg}`);
  }
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
