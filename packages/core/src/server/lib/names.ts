import {
  getENSClient,
} from '../singletons/ensClient';
import {
  getChainEnvVar,
  requireChainEnvVar,
  getEnsOrgAddress,
  getEnsPrivateKey,
  sepolia,
  getChainById,
} from './chainConfig';
import { createPublicClient, createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
} from '../../client/accountClient';
import { requireDelegationToolkit } from '../../shared/optionalDelegationToolkit';

export type AddToL1OrgPKParams = {
  orgName: string;
  agentName: string;
  agentAddress: `0x${string}`;
  agentUrl?: string;
  chainId?: number;
};

export type ExecuteEnsTxResult = {
  userOpHash: `0x${string}`;
  receipt?: any;
};

export async function addToL1OrgPK(params: AddToL1OrgPKParams): Promise<ExecuteEnsTxResult> {
  const targetChainId = params.chainId || 11155111;
  const ensClient = await getENSClient(targetChainId);

  const { calls } = await ensClient.prepareAddAgentNameToOrgCalls({
    orgName: params.orgName,
    agentName: params.agentName,
    agentAddress: params.agentAddress,
    agentUrl: params.agentUrl || '',
  });

  return await executeEnsCallsWithOrgPK({ calls, chainId: targetChainId });
}

export type SetL1NameInfoPKParams = {
  agentAddress: `0x${string}`;
  orgName: string;
  agentName: string;
  agentUrl?: string;
  agentDescription?: string;
  chainId?: number;
};

export async function setL1NameInfoPK(params: SetL1NameInfoPKParams): Promise<ExecuteEnsTxResult> {
  const targetChainId = params.chainId || 11155111;
  const ensClient = await getENSClient(targetChainId);

  const { calls } = await ensClient.prepareSetAgentNameInfoCalls({
    agentAddress: params.agentAddress,
    orgName: params.orgName,
    agentName: params.agentName,
    agentUrl: params.agentUrl,
    agentDescription: params.agentDescription,
  });

  return await executeEnsCallsWithOrgPK({ calls, chainId: targetChainId });
}

async function executeEnsCallsWithOrgPK(params: { calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[]; chainId: number }): Promise<ExecuteEnsTxResult> {
  const { calls, chainId } = params;
  const bundlerUrl = requireChainEnvVar('AGENTIC_TRUST_BUNDLER_URL', chainId);
  const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', chainId);
  const privKey = getEnsPrivateKey(chainId) as `0x${string}`;
  const orgAddress = getEnsOrgAddress(chainId);

  const chain = getChainById(chainId) as Chain;
  const publicClient = createPublicClient({ chain: chain as any, transport: http(rpcUrl) });
  const walletAccount = privateKeyToAccount(privKey);
  const walletClient = createWalletClient({
    account: walletAccount,
    chain: chain as any,
    transport: http(rpcUrl),
  });

  const { toMetaMaskSmartAccount, Implementation } = await requireDelegationToolkit({
    feature: 'ENS name management',
  });

  const orgAccountClient = await toMetaMaskSmartAccount({
    address: orgAddress as `0x${string}`,
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    signatory: { walletClient: walletClient as any },
  } as any);

  const formattedCalls = calls.map(call => ({
    to: call.to,
    data: call.data,
    value: typeof call.value === 'bigint' ? call.value : BigInt(call.value ?? 0),
  }));

  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain,
    accountClient: orgAccountClient,
    calls: formattedCalls,
  });
  const receipt = await waitForUserOperationReceipt({ bundlerUrl, chain, hash: userOpHash });

  return { userOpHash, receipt };
}


