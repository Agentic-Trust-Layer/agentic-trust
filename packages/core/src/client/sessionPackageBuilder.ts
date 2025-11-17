import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  zeroAddress,
  encodeFunctionData,
  type Address,
  type Chain,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';
import {
  toMetaMaskSmartAccount,
  Implementation,
  createDelegation,
} from '@metamask/delegation-toolkit';
import IdentityRegistryAbi from '@agentic-trust/8004-ext-sdk/abis/IdentityRegistry.json';

import { SessionPackage } from '../shared/sessionPackage';
import {
  getChainRpcUrl,
  getChainBundlerUrl,
  getChainIdHex,
  getChainConfig,
  getChainById,
} from '../server/lib/chainConfig';
import { sendSponsoredUserOperation, waitForUserOperationReceipt } from './accountClient';

type GenerateSessionPackageParams = {
  agentId: number;
  chainId: number;
  agentAccount: `0x${string}`;
  provider: any;
  ownerAddress: `0x${string}`;
  reputationRegistry?: `0x${string}`;
  identityRegistry?: `0x${string}`;
  selector?: `0x${string}`;
};

const DEFAULT_SELECTOR = '0x8524d988';
const DEFAULT_ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

function normalizeHex(value?: string | null): `0x${string}` | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('0x') ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

function getIdentityRegistryAddress(chainId: number): `0x${string}` | undefined {
  const cfg = getChainConfig(chainId);
  if (!cfg) return undefined;
  const key = `NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_${cfg.suffix}`;
  return normalizeHex(process.env[key] ?? process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY ?? undefined);
}

function getReputationRegistryAddress(): `0x${string}` | undefined {
  return normalizeHex(process.env.NEXT_PUBLIC_REPUTATION_REGISTRY ?? undefined);
}

async function switchChain(provider: any, chainId: number, rpcUrl: string) {
  const chainIdHex = getChainIdHex(chainId);
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (error: any) {
    if (error?.code === 4902) {
      const chainConfig = getChainConfig(chainId);
      const chainName = chainConfig?.displayName ?? `Chain ${chainId}`;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName,
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: [rpcUrl],
          },
        ],
      });
    } else {
      throw error;
    }
  }
}

export async function generateSessionPackage(
  params: GenerateSessionPackageParams,
): Promise<SessionPackage> {
  const {
    agentId,
    chainId,
    agentAccount,
    provider,
    ownerAddress,
    reputationRegistry: reputationRegistryOverride,
    identityRegistry: identityRegistryOverride,
    selector = DEFAULT_SELECTOR as `0x${string}`,
  } = params;

  if (!provider) {
    throw new Error('An EIP-1193 provider is required to generate a session package.');
  }
  if (!ownerAddress) {
    throw new Error('Wallet address is required to generate a session package.');
  }
  if (!agentAccount) {
    throw new Error('Agent account is required to generate a session package.');
  }

  const rpcUrl = getChainRpcUrl(chainId);
  if (!rpcUrl) {
    throw new Error(`Missing RPC URL for chain ${chainId}`);
  }
  const bundlerUrl = getChainBundlerUrl(chainId);
  if (!bundlerUrl) {
    throw new Error(`Missing bundler URL for chain ${chainId}`);
  }

  const chain = getChainById(chainId) as Chain;
  const identityRegistry =
    identityRegistryOverride ??
    getIdentityRegistryAddress(chainId) ??
    zeroAddress;
  const reputationRegistry =
    reputationRegistryOverride ??
    getReputationRegistryAddress() ??
    zeroAddress;

  await switchChain(provider, chainId, rpcUrl);
  await new Promise(resolve => setTimeout(resolve, 1000));

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain,
    transport: custom(provider),
    account: ownerAddress as Address,
  });

  console.info('*********** sessionPackageBuilder: walletClient', walletClient?.account?.address);
  console.info('*********** sessionPackageBuilder: agentAccount', agentAccount);
  const smartAccount = await toMetaMaskSmartAccount({
    address: agentAccount,
    client: publicClient as any,  
    implementation: Implementation.Hybrid,
    signer: {
      walletClient: walletClient as any,
    },
  } as any);

  const entryPoint = DEFAULT_ENTRY_POINT;

  const aaCode = await publicClient.getBytecode({ address: agentAccount });
  const aaDeployed = !!aaCode && aaCode !== '0x';

  if (!aaDeployed) {
    const hash = await sendSponsoredUserOperation({
      bundlerUrl,
      chain,
      accountClient: smartAccount as any,
      calls: [{ to: zeroAddress }],
    });
    await waitForUserOperationReceipt({ bundlerUrl, chain, hash });
  }

  const sessionPrivateKey = generatePrivateKey();
  const sessionKeyAccount = privateKeyToAccount(sessionPrivateKey);
  const validUntil = Math.floor(Date.now() / 1000) + 60 * 30;
  const validAfter = validUntil - 60 * 30 - 60;

  console.info('*********** sessionPackageBuilder signatory: sessionKeyAccount', sessionKeyAccount.address);  
  const burnerAccountClient = await toMetaMaskSmartAccount({
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [sessionKeyAccount.address as `0x${string}`, [], [], []],
    signer: { account: sessionKeyAccount },
    deploySalt: toHex(10),
  } as any);

  const sessionAA = (await burnerAccountClient.getAddress()) as `0x${string}`;

  const sessionCode = await publicClient.getBytecode({ address: sessionAA });
  const sessionDeployed = !!sessionCode && sessionCode !== '0x';

  if (!sessionDeployed) {
    const hash = await sendSponsoredUserOperation({
      bundlerUrl,
      chain,
      accountClient: burnerAccountClient as any,
      calls: [{ to: zeroAddress }],
    });
    await waitForUserOperationReceipt({ bundlerUrl, chain, hash });
  }

  const environment = (smartAccount as any).environment;
  if (!environment) {
    throw new Error('Delegation environment is unavailable on the smart account.');
  }

  const delegation = createDelegation({
    environment,
    scope: {
      type: 'functionCall',
      targets: [reputationRegistry],
      selectors: [selector],
    },
    from: agentAccount,
    to: sessionAA,
    caveats: [],
  });

  let signature: `0x${string}`;
  if (typeof (smartAccount as any).signDelegation === 'function') {
    signature = (await (smartAccount as any).signDelegation({
      delegation,
    })) as `0x${string}`;
  } else if (typeof (walletClient as any).signDelegation === 'function') {
    signature = (await (walletClient as any).signDelegation({
      delegation,
    })) as `0x${string}`;
  } else {
    throw new Error('Current wallet does not support delegation signing.');
  }

  if (identityRegistry && identityRegistry !== zeroAddress) {
    const approveCalldata = encodeFunctionData({
      abi: IdentityRegistryAbi as any,
      functionName: 'approve',
      args: [sessionAA, BigInt(agentId)],
    });
    const hash = await sendSponsoredUserOperation({
      bundlerUrl,
      chain,
      accountClient: smartAccount as any,
      calls: [{ to: identityRegistry, data: approveCalldata }],
    });
    await waitForUserOperationReceipt({ bundlerUrl, chain, hash });
  }

  const sessionPackage: SessionPackage = {
    agentId,
    chainId,
    aa: agentAccount,
    sessionAA,
    selector,
    sessionKey: {
      privateKey: sessionPrivateKey,
      address: sessionKeyAccount.address as `0x${string}`,
      validAfter,
      validUntil,
    },
    entryPoint,
    bundlerUrl,
    signedDelegation: {
      message: delegation,
      signature,
    },
  };

  return sessionPackage;
}


