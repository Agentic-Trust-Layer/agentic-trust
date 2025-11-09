import { keccak256, stringToHex, createPublicClient, http, zeroAddress, createWalletClient, custom, type Address, type Chain } from 'viem';
import { sepolia } from 'viem/chains';
import type { PublicClient, WalletClient } from 'viem';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';
import { getAgentAccountByAgentName } from '../server/lib/agentAccount';

import { createBundlerClient } from 'viem/account-abstraction';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { getChainRpcUrl } from '../server/lib/chainConfig';


type GetAAAccountClientOptions = {
  chain?: Chain;
  publicClient?: PublicClient;
  walletClient?: WalletClient;
  ethereumProvider?: any;
  includeDeployParams?: boolean;
  accountAddress?: `0x${string}`;
};

export async function getCounterfactualAccountClientByAgentName(
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: GetAAAccountClientOptions
): Promise<any> {

  const chain = options?.chain || sepolia;
  console.info('*********** aaClient getCounterfactualAccountClientByAgentName: agentName', agentName);
  console.info('*********** aaClient getCounterfactualAccountClientByAgentName: chain.id', chain?.id);


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

  console.info('*********** aaClient getCounterfactualAccountClientByAgentName: counterfactualAccountClient', counterfactualAccountClient.address);
  return counterfactualAccountClient;
}


export async function getDeployedAccountClientByAgentName(
  bundlerUrl: string,
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: GetAAAccountClientOptions
): Promise<any> {

  const chain = options?.chain || sepolia;
  console.info('*********** aaClient getDeployedAccountClientByAgentName: agentName', agentName);
  console.info('*********** aaClient getDeployedAccountClientByAgentName: chain.id', chain?.id);
  console.info('*********** aaClient getDeployedAccountClientByAgentName: bundlerUrl', bundlerUrl);


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
  
  /*
  else {
    const provider = options?.ethereumProvider || (typeof window !== 'undefined' ? (window as any).ethereum : null);
    if (!provider) {
      throw new Error('No wallet provider found. Ensure MetaMask/Web3Auth is available or pass ethereumProvider.');
    }

    walletClient = createWalletClient({
      chain: resolvedChain as any,
      transport: custom(provider),
      account: eoaAddress as Address,
    });
  }


  let publicClient: PublicClient;
  if (options?.publicClient) {
    publicClient = options.publicClient;
  } else if (options?.rpcUrl) {
    publicClient = createPublicClient({
      chain: resolvedChain as any,
      transport: http(options.rpcUrl),
    }) as any;
  } else {
    const provider = options?.ethereumProvider || (typeof window !== 'undefined' ? (window as any).ethereum : null);
    if (!provider) {
      throw new Error(
        'No RPC URL or wallet provider available. Provide rpcUrl, ethereumProvider, or publicClient in options.'
      );
    }

    publicClient = createPublicClient({
      chain: resolvedChain as any,
      transport: custom(provider),
    }) as any;
  }

  try {
    (walletClient as any).account = eoaAddress as Address;
  } catch (error) {
    console.warn('Unable to assign account on walletClient:', error);
  }
    

  const currentChainId = await walletClient.getChainId();
  if (currentChainId !== resolvedChain.id) {
    console.info(`🔄 Wallet is on chain ${currentChainId}, switching to ${resolvedChain.id} (${resolvedChain.name})`);
    try {
      await walletClient.switchChain({ id: resolvedChain.id });
      console.info(`✅ Successfully switched to chain ${resolvedChain.id}`);
    } catch (switchError) {
      console.error('❌ Failed to switch chain:', switchError);
      throw new Error(
        `Wallet is connected to chain ${currentChainId} but expected chain ${resolvedChain.id}. Please switch to ${resolvedChain.name} manually.`
      );
    }
  }
*/
/*
  const trimmedName = agentName?.trim();

  
  if (trimmedName && !options?.accountAddress) {
    console.info("*********** aaClient getAAAccountClientByAgentName: trimmedName", trimmedName);
    console.info("*********** aaClient getAAAccountClientByAgentName: options?.walletClient", options?.walletClient);
    if (options?.walletClient) {
      try {
        console.info("*********** aaClient getAAAccountClientByAgentName: trimmedName", trimmedName);
        const resolution = await getAgentAccountByAgentName(trimmedName);
        console.info("*********** aaClient getAAAccountClientByAgentName: resolution", resolution);
        if (resolution.account) {
          const baseClientConfig: Record<string, unknown> = {
            address: resolution.account,
            client: publicClient,
            implementation: Implementation.Hybrid,
            signer: {
              walletClient,
            },
          };

          const agentAccountClient = await toMetaMaskSmartAccount(baseClientConfig as any);

          console.info(`ENS resolution found account via ${resolution.method}:`, resolution.account);
          return agentAccountClient;
        }
      } catch (error) {
        console.warn('Server-side ENS resolution failed, falling back to client or deterministic path:', error);
      }
    }


    try {
      console.log("*********** aaClient getAAAccountClientByAgentName: try and call resolve-account API");
      const response = await fetch('/api/agents/resolve-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: trimmedName }),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log("*********** aaClient getAAAccountClientByAgentName: data", data);
        if (data.account && data.account !== '0x0000000000000000000000000000000000000000') {
          console.log("*********** aaClient getAAAccountClientByAgentName: data.account", data.account);
          try {
            const apiClientConfig: Record<string, unknown> = {
              address: data.account as `0x${string}`,
              implementation: Implementation.Hybrid,
              signer: {
                walletClient,
              },
            };

            const agentAccountClient = await toMetaMaskSmartAccount(apiClientConfig as any);
            return agentAccountClient;
          }
          catch (error) {
            console.log("******* found account is not an abstract account *****")
          }
        }

        console.info('No ENS resolution found via API, using deterministic computation');
      } else {
        console.warn('ENS resolution API call failed, using deterministic computation');
      }
    } catch (error) {
      console.warn('Error calling ENS resolution API, using deterministic computation:', error);
    }
  }
  */

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

  // Check deployment status with provided publicClient, then fall back to HTTP RPC if available
  let isDeployed = false;
  try {
    const code = await publicClient.getBytecode({ address: counterfactualAccountClient.address });
    isDeployed = !!code && code !== "0x";
  } catch {}
  if (!isDeployed) {
    try {
      const rpcUrl = getChainRpcUrl(chain.id);
      console.info('*********** aaClient getDeployedAccountClientByAgentName: checking on RPC', rpcUrl);
      if (rpcUrl) {
        const httpClient = createPublicClient({ chain: chain as any, transport: http(rpcUrl) });
        const codeHttp = await httpClient.getBytecode({ address: counterfactualAccountClient.address });
        isDeployed = !!codeHttp && codeHttp !== "0x";
      }
    } catch {}
  }

  console.info('*********** aaClient getDeployedAccountClientByAgentName: isDeployed', isDeployed);
  if (!isDeployed && bundlerUrl) {
      console.info('*********** aaClient getDeployedAccountClientByAgentName: deploying via bundler');
      const pimlico = createPimlicoClient({ transport: http(bundlerUrl) });
      const bundlerClient = createBundlerClient({
        transport: http(bundlerUrl),
        paymaster: true as any,
        chain: chain as any,
        paymasterContext: { mode: 'SPONSORED' },
      } as any);
      const { fast: fee } = await pimlico.getUserOperationGasPrice();
      console.info('*********** aaClient getDeployedAccountClientByAgentName: gas price', fee);
      const userOperationHash = await bundlerClient.sendUserOperation({
        account: counterfactualAccountClient as any,
        calls: [ { to: zeroAddress } ],
        ...fee,
      });
      console.info('*********** aaClient getDeployedAccountClientByAgentName: userOperationHash', userOperationHash);
      await bundlerClient.waitForUserOperationReceipt({ hash: userOperationHash });

      // After deployment, mark as deployed so we rebuild below
      isDeployed = true;
  }

  const addr = counterfactualAccountClient.address;
  if (isDeployed) {
    console.info('*********** aaClient getDeployedAccountClientByAgentName: rebuilding deployed account client without deploy params');
    const deployedAccountClient = await toMetaMaskSmartAccount({
      client: publicClient,
      implementation: Implementation.Hybrid,
      signer: {
        walletClient: walletClient as any,
      },
      address: addr,
    });

    console.info('*********** aaClient getDeployedAccountClientByAgentName: agentAccountClient', deployedAccountClient.address);
    return deployedAccountClient;
  }

  console.info('*********** aaClient getDeployedAccountClientByAgentName: agentAccountClient', counterfactualAccountClient.address);
  return counterfactualAccountClient;
}


