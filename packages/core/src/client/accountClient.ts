import { keccak256, stringToHex, createPublicClient, http, zeroAddress, createWalletClient, custom, type Address, type Chain } from 'viem';
import { sepolia } from 'viem/chains';
import type { PublicClient, WalletClient } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import { getChainRpcUrl } from '../server/lib/chainConfig';
import { requireDelegationToolkit } from '../shared/optionalDelegationToolkit';


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
export async function getCounterfactualAAAddressByAgentName(
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
  const { toMetaMaskSmartAccount, Implementation } = await requireDelegationToolkit({
    feature: 'Client AA counterfactual account computation',
  });
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


export async function getDeployedAccountClientByAgentName(
  bundlerUrl: string,
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: GetAAAccountClientOptions
): Promise<any> {

  const chain = options?.chain || sepolia;
  console.info('*********** accountClient getDeployedAccountClientByAgentName: agentName', agentName);
  console.info('*********** accountClient getDeployedAccountClientByAgentName: chain.id', chain?.id);
  console.info('*********** accountClient getDeployedAccountClientByAgentName: bundlerUrl', bundlerUrl);


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
  const { toMetaMaskSmartAccount, Implementation } = await requireDelegationToolkit({
    feature: 'Client AA deployed account detection',
  });
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
