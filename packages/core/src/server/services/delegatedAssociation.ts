import { createPublicClient, createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, parseAbi } from 'viem';
import { ethers } from 'ethers';
import {
  Implementation,
  toMetaMaskSmartAccount,
  ExecutionMode,
} from '@metamask/smart-accounts-kit';
// @ts-ignore contracts path
import { DelegationManager } from '@metamask/smart-accounts-kit/contracts';

import type { SessionPackage } from '../../shared/sessionPackage';
import { buildDelegationSetup, type DelegationSetup } from '../lib/sessionPackage';
import { DEFAULT_CHAIN_ID, getChainBundlerUrl, getChainById } from '../lib/chainConfig';
import { sendSponsoredUserOperation, waitForUserOperationReceipt } from '../../client/accountClient';

const ASSOCIATIONS_STORE_ABI = parseAbi([
  'function storeAssociation((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record) sar)',
]);

export type DelegatedAssociationContext = {
  sessionAccountClient: any;
  walletClient: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
  delegationSetup: DelegationSetup;
  bundlerUrl: string;
  chain: Chain;
};

export async function buildDelegatedAssociationContext(
  sessionPackage: SessionPackage,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<DelegatedAssociationContext> {
  const delegationSetup = buildDelegationSetup(sessionPackage);
  const bundlerUrl = getChainBundlerUrl(chainId);
  if (!bundlerUrl) {
    throw new Error(`Bundler URL not configured for chain ${chainId}.`);
  }
  const chain = getChainById(chainId) as Chain;

  const publicClient = createPublicClient({
    chain: delegationSetup.chain,
    transport: http(delegationSetup.rpcUrl),
  });

  const agentOwnerEOA = privateKeyToAccount(delegationSetup.sessionKey.privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account: agentOwnerEOA,
    chain: delegationSetup.chain,
    transport: http(delegationSetup.rpcUrl),
  });

  if (!delegationSetup.sessionAA) {
    throw new Error('SessionPackage.sessionAA is required to submit delegated storeAssociation.');
  }

  const sessionAccountClient = await toMetaMaskSmartAccount({
    address: delegationSetup.sessionAA as `0x${string}`,
    client: publicClient,
    implementation: Implementation.Hybrid,
    signer: { walletClient },
    delegation: {
      delegation: delegationSetup.signedDelegation,
      delegator: delegationSetup.aa,
    },
  } as any);

  return {
    sessionAccountClient,
    walletClient,
    publicClient,
    delegationSetup,
    bundlerUrl,
    chain,
  };
}

function getAssociationsProxyAddress(): `0x${string}` {
  const addr =
    process.env.ASSOCIATIONS_STORE_PROXY ||
    process.env.ASSOCIATIONS_PROXY_ADDRESS ||
    '0xaF7428906D31918dDA2986D1405E2Ded06561E59';
  if (!addr.startsWith('0x') || addr.length !== 42) {
    throw new Error(`Invalid associations proxy address: ${addr}`);
  }
  try {
    return ethers.getAddress(addr) as `0x${string}`;
  } catch {
    return ethers.getAddress(addr.toLowerCase()) as `0x${string}`;
  }
}

export async function storeErc8092AssociationWithSessionDelegation(params: {
  sessionPackage: SessionPackage;
  chainId?: number;
  sar: any;
}): Promise<{ txHash: string }> {
  const chainId = params.chainId ?? params.sessionPackage.chainId ?? DEFAULT_CHAIN_ID;
  const { sessionAccountClient, delegationSetup, bundlerUrl, chain } =
    await buildDelegatedAssociationContext(params.sessionPackage, chainId);

  const proxy = getAssociationsProxyAddress();

  const data = encodeFunctionData({
    abi: ASSOCIATIONS_STORE_ABI,
    functionName: 'storeAssociation',
    args: [params.sar],
  });

  const includedExecutions = [
    {
      target: proxy,
      value: 0n,
      callData: data as `0x${string}`,
    },
  ];

  const signedDelegation = delegationSetup.signedDelegation as any;
  const delegationMessage = {
    delegate: ethers.getAddress(
      (signedDelegation.message?.delegate ?? signedDelegation.delegate) as string,
    ) as `0x${string}`,
    delegator: ethers.getAddress(
      (signedDelegation.message?.delegator ?? signedDelegation.delegator) as string,
    ) as `0x${string}`,
    authority: (signedDelegation.message?.authority ?? signedDelegation.authority) as `0x${string}`,
    caveats: (signedDelegation.message?.caveats ?? signedDelegation.caveats) as any[],
    salt: (signedDelegation.message?.salt ?? signedDelegation.salt) as `0x${string}`,
    signature: (signedDelegation.signature ?? signedDelegation.message?.signature) as `0x${string}`,
  };

  const redemptionData = DelegationManager.encode.redeemDelegations({
    delegations: [[delegationMessage]],
    modes: [ExecutionMode.SingleDefault],
    executions: [includedExecutions],
  });

  const redemptionCall = {
    to: delegationSetup.sessionAA as `0x${string}`,
    data: redemptionData as `0x${string}`,
    value: 0n,
  };

  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain,
    accountClient: sessionAccountClient,
    calls: [redemptionCall],
  });

  const receipt = await waitForUserOperationReceipt({
    bundlerUrl,
    chain,
    hash: userOpHash,
  });

  const txHash = receipt?.transactionHash || (receipt as any)?.receipt?.transactionHash || userOpHash;
  return { txHash };
}


