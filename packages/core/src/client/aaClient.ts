import { keccak256, stringToHex, createPublicClient, http, createWalletClient, custom, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import type { PublicClient, WalletClient } from 'viem';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';
import { getAgentAccountByAgentName } from '../server/lib/agentAccount';



export async function getAAAccountClientByAgentName(
  agentName: string,
  eoaAddress: `0x${string}`,
  options?: {
    rpcUrl?: string;
    chain?: typeof sepolia;
    publicClient?: PublicClient;
    walletClient?: WalletClient;
    ethereumProvider?: any;
  }
): Promise<any> {

  console.info("*********** aaClient getAAAccountClientByAgentName: agentName", agentName);
  const rpcUrl = options?.rpcUrl || process.env.AGENTIC_TRUST_RPC_URL || '';
  const resolvedChain = options?.chain || sepolia;

  let publicClient: PublicClient;
  if (options?.publicClient) {
    publicClient = options.publicClient;
  } else {
    publicClient = createPublicClient({
      chain: resolvedChain as any,
      transport: http(rpcUrl),
    }) as any;
  }


  let walletClient: WalletClient;
  if (options?.walletClient) {
    walletClient = options.walletClient;
  } else {

    const provider = options?.ethereumProvider || (window as any).ethereum;
    if (!provider) {
      throw new Error('No wallet provider found. Ensure MetaMask/Web3Auth is available or pass ethereumProvider.');
    }

    walletClient = createWalletClient({
      chain: resolvedChain as any,
      transport: custom(provider),
      account: eoaAddress as Address,
    });
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

  const trimmedName = agentName?.trim();

  if (trimmedName) {
    if (options?.walletClient) {
      try {
        console.info("*********** aaClient getAAAccountClientByAgentName: trimmedName", trimmedName);
        const resolution = await getAgentAccountByAgentName(trimmedName);
        console.info("*********** aaClient getAAAccountClientByAgentName: resolution", resolution);
        if (resolution.account) {
          const agentAccountClient = await toMetaMaskSmartAccount({
            address: resolution.account,
            client: publicClient,
            implementation: Implementation.Hybrid,
            signer: {
              walletClient,
            },
          } as any);

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
            const agentAccountClient = await toMetaMaskSmartAccount({
              address: data.account as `0x${string}`,
              implementation: Implementation.Hybrid,
              deployParams: [eoaAddress as `0x${string}`, [], [], []],
              signer: {
                walletClient,
              },
            } as any);
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

  const salt: `0x${string}` = keccak256(stringToHex(agentName)) as `0x${string}`;
  const agentAccountClient = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [eoaAddress as `0x${string}`, [], [], []],
    signer: {
      walletClient,
    },
    deploySalt: salt,
  } as any);

  return agentAccountClient;
}


