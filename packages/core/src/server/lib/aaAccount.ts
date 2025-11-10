import { keccak256, stringToHex, createPublicClient, http, type PublicClient } from 'viem';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';
import { getAdminApp } from '../userApps/adminApp';
import { getChainById, getChainRpcUrl, DEFAULT_CHAIN_ID } from './chainConfig';

export async function getServerCounterfactualAAAddressByAgentName(
  agentName: string,
  chainId?: number
): Promise<`0x${string}`> {
  if (!agentName || agentName.trim().length === 0) {
    throw new Error('agentName is required');
  }
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  const adminApp = await getAdminApp(undefined, targetChainId);
  if (!adminApp) {
    throw new Error('AdminApp not initialized');
  }

  const chain = getChainById(targetChainId);
  const rpcUrl = getChainRpcUrl(targetChainId);

  // Use existing publicClient if available, else create an HTTP client
  const publicClient: PublicClient =
    (adminApp.publicClient as any) ||
    (createPublicClient({ chain: chain as any, transport: http(rpcUrl) }) as any);

  const salt = keccak256(stringToHex(agentName)) as `0x${string}`;

  const clientConfig: Record<string, unknown> = {
    client: publicClient,
    implementation: Implementation.Hybrid,
    signer: {
      walletClient: adminApp.walletClient as any,
    },
    deployParams: [adminApp.address as `0x${string}`, [], [], []],
    deploySalt: salt,
  };

  const accountClient = await toMetaMaskSmartAccount(clientConfig as any);
  return accountClient.address as `0x${string}`;
}


