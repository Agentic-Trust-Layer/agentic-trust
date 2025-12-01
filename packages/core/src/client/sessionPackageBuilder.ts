import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  zeroAddress,
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Address,
  type Chain,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';
import {
  toMetaMaskSmartAccount,
  Implementation,
  createDelegation,
  getSmartAccountsEnvironment,
  ExecutionMode,
} from '@metamask/smart-accounts-kit';
// @ts-ignore - contracts subpath may not be in main type definitions
import { DelegationManager } from '@metamask/smart-accounts-kit/contracts';
import IdentityRegistryAbi from '@agentic-trust/8004-ext-sdk/abis/IdentityRegistry.json';
import ValidationRegistryAbi from '@agentic-trust/8004-ext-sdk/abis/ValidationRegistry.json';

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
  validationRegistry?: `0x${string}`;
  bundlerUrl?: string;
  rpcUrl?: string;
  selector?: `0x${string}`;
};

const VALIDATION_RESPONSE_SIGNATURE =
  'validationResponse(bytes32,uint8,string,bytes32,bytes32)';
const DEFAULT_SELECTOR = keccak256(stringToHex(VALIDATION_RESPONSE_SIGNATURE)).slice(
  0,
  10,
) as `0x${string}`;
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

function getReputationRegistryAddress(chainId: number): `0x${string}` | undefined {
  const cfg = getChainConfig(chainId);
  if (!cfg) return undefined;
  const key = `NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_${cfg.suffix}`;
  return normalizeHex(process.env[key] ?? process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY ?? undefined);
}

function getValidationRegistryAddress(chainId: number): `0x${string}` | undefined {
  const cfg = getChainConfig(chainId);
  if (!cfg) return undefined;
  const key = `NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_${cfg.suffix}`;
  console.info('*********** sessionPackageBuilder: validationRegistry', key);
  console.info('*********** sessionPackageBuilder: validationRegistry', process.env[key]);
  return normalizeHex(process.env[key] ?? process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY ?? undefined);
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
    rpcUrl: rpcUrlOverride,
    bundlerUrl: bundlerUrlOverride,
    identityRegistry: identityRegistryOverride,
    reputationRegistry: reputationRegistryOverride,
    validationRegistry: validationRegistryOverride,
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

  const rpcUrl = rpcUrlOverride ?? getChainRpcUrl(chainId);
  if (!rpcUrl) {
    throw new Error(`Missing RPC URL for chain ${chainId}`);
  }
  const bundlerUrl = bundlerUrlOverride ?? getChainBundlerUrl(chainId);
  if (!bundlerUrl) {
    throw new Error(`Missing bundler URL for chain ${chainId}`);
  }

  const chain = getChainById(chainId) as Chain;

  const identityRegistry =
    identityRegistryOverride ?? getIdentityRegistryAddress(chainId);
  if (!identityRegistry) {
    throw new Error(
      `Missing IdentityRegistry address for chain ${chainId}. ` +
      `Set NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY or ` +
      `NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_<CHAIN_SUFFIX> in your env.`
    );
  }

  const reputationRegistry =
    reputationRegistryOverride ?? getReputationRegistryAddress(chainId);
  if (!reputationRegistry) {
    throw new Error(
      `Missing ReputationRegistry address for chain ${chainId}. ` +
      `Set NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY or ` +
      `NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_<CHAIN_SUFFIX> in your env.`
    );
  }

  const validationRegistry =
    validationRegistryOverride ?? getValidationRegistryAddress(chainId);
  if (!validationRegistry) {
    throw new Error(
      `Missing ValidationRegistry address for chain ${chainId}. ` +
      `Set NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY or ` +
      `NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_<CHAIN_SUFFIX> in your env.`
    );
  }

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

  console.info('*********** sessionPackageBuilder signer: sessionKeyAccount aaa:  ', sessionKeyAccount.address);  
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

  // Get the correct HybridDeleGator address from the smart accounts kit
  // This MUST match the EIP-712 domain used by the contract that verifies the delegation
  const deleGatorEnv = getSmartAccountsEnvironment(chainId);
  const entryPointAddress =
    (deleGatorEnv.EntryPoint as `0x${string}` | undefined) || (entryPoint as `0x${string}`);
  
  // The HybridDeleGator address is in the implementations object
  // The property name is HybridDeleGatorImpl (as confirmed by the environment structure)
  let hybridDelegatorAddress = (deleGatorEnv.implementations as any)?.HybridDeleGatorImpl as `0x${string}` | undefined;
  console.info('*********** sessionPackageBuilder: hybridDelegatorAddress', hybridDelegatorAddress);

  // If not found in implementations, try to get from smart account
  // For Hybrid implementation, the implementation address might be the HybridDeleGator
  if (!hybridDelegatorAddress) {
    const accountImpl = (smartAccount as any).implementationAddress || 
                       (smartAccount as any).implementation?.address ||
                       (smartAccount as any).getImplementationAddress?.();
    
    if (accountImpl) {
      console.warn(`[sessionPackageBuilder] HybridDeleGator not found in deleGatorEnv, using smart account implementation: ${accountImpl}`);
      hybridDelegatorAddress = accountImpl as `0x${string}`;
    }
  }
  
  if (!hybridDelegatorAddress) {
    throw new Error(
      `HybridDeleGator address not found for chainId ${chainId}. ` +
      `DeleGatorEnvironment: ${JSON.stringify({ 
        EntryPoint: deleGatorEnv.EntryPoint,
        implementations: deleGatorEnv.implementations 
      })}. ` +
      `Check @metamask/smart-accounts-kit configuration.`
    );
  }


/*
  const environment = (smartAccount as any).environment;
  if (!environment) {
    throw new Error('Delegation environment is unavailable on the smart account.');
  }
  console.info('*********** sessionPackageBuilder: environment', environment);
*/

  console.info('*********** sessionPackageBuilder: createDelegation');

  // Create delegation scope that allows validationResponse (and a read-only test method) on ValidationRegistry
  // Only include ValidationRegistry in the scope to keep caveats strict
  const targets: Array<`0x${string}`> = [];
  if (validationRegistry) {
    targets.push(validationRegistry);
  } else {
    throw new Error('validationRegistry address is required to build delegation scope');
  }

  // Include getIdentityRegistry selector so the delegation test can call it successfully
  const getIdentityRegistrySelector = encodeFunctionData({
    abi: ValidationRegistryAbi as any,
    functionName: 'getIdentityRegistry',
    args: [],
  }).slice(0, 10) as `0x${string}`;

  const selectors = Array.from(new Set([selector, getIdentityRegistrySelector])) as `0x${string}`[];

  const delegation = createDelegation({
    environment: deleGatorEnv,
    scope: {
      type: 'functionCall',
      targets,
      selectors,
    },
    from: agentAccount,
    to: sessionAA,
    caveats: [],
  });




  let signature: `0x${string}`;

  console.info('*********** sessionPackageBuilder yyyyy: signDelegation smartAccount');
  signature = (await (smartAccount as any).signDelegation({
    delegation,
  })) as `0x${string}`;
  const deligationWithSignature = {
    ...delegation,
    signature,
  }

  // Test the delegation by making a simple call to ValidationRegistry.getIdentityRegistry() from session account
  // This demonstrates the full delegation redemption flow and should succeed because the selector is allowed
  console.info('*********** sessionPackageBuilder: Testing delegation with ValidationRegistry.getIdentityRegistry() call (expected to succeed)...');
  try {
    // Create session account client with delegation
    const sessionAccountClient = await toMetaMaskSmartAccount({
      address: sessionAA,
      client: publicClient as any,
      implementation: Implementation.Hybrid,
      signer: { account: sessionKeyAccount },
      delegation: {
        delegation: deligationWithSignature,
        delegator: agentAccount,
      },
    } as any);

    // Prepare a simple call to ValidationRegistry.getIdentityRegistry()
    const testCallData = encodeFunctionData({
      abi: ValidationRegistryAbi as any,
      functionName: 'getIdentityRegistry',
      args: [],
    });

    // Extract delegation message for redemption - use the signed delegation
    const delegationMessage = {
      delegate: deligationWithSignature.delegate,
      delegator: deligationWithSignature.delegator,
      authority: deligationWithSignature.authority,
      caveats: deligationWithSignature.caveats,
      salt: deligationWithSignature.salt,
      signature: deligationWithSignature.signature, // Use the actual signature from signDelegation
    };

    // Encode delegation redemption
    const SINGLE_DEFAULT_MODE = ExecutionMode.SingleDefault;
    if (!DelegationManager || !DelegationManager.encode || !DelegationManager.encode.redeemDelegations) {
      throw new Error('DelegationManager.encode.redeemDelegations not found. Check @metamask/smart-accounts-kit version.');
    }

    const includedExecutions = [
      {
        target: validationRegistry as `0x${string}`,
        value: BigInt(0),
        callData: testCallData,
      },
    ];

    const redemptionData = DelegationManager.encode.redeemDelegations({
      delegations: [[delegationMessage]],
      modes: [SINGLE_DEFAULT_MODE],
      executions: [includedExecutions],
    });

    // Send the test call through delegation
    const testCall = {
      to: sessionAA as `0x${string}`,
      data: redemptionData,
      value: 0n,
    };

    console.info('*********** sessionPackageBuilder: Sending delegated call to ValidationRegistry.getIdentityRegistry()...');
    console.info('*********** sessionPackageBuilder: This demonstrates delegation redemption flow end-to-end');
    
    const testHash = await sendSponsoredUserOperation({
      bundlerUrl,
      chain,
      accountClient: sessionAccountClient as any,
      calls: [testCall],
    });
    
    const testReceipt = await waitForUserOperationReceipt({ bundlerUrl, chain, hash: testHash });
    console.info('*********** sessionPackageBuilder: ✓ Delegation test successful! Receipt:', testReceipt?.transactionHash || testHash);
    
    // Verify the call returned an address (should match identityRegistry)
    const identityRegistryFromCall = await publicClient.readContract({
      address: validationRegistry as `0x${string}`,
      abi: ValidationRegistryAbi as any,
      functionName: 'getIdentityRegistry',
      args: [],
    });
    console.info('*********** sessionPackageBuilder: ✓ Delegation verified - IdentityRegistry address:', identityRegistryFromCall);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('Invalid Smart Account nonce') ||
      message.includes('AA25 invalid account deployment')
    ) {
      console.warn(
        '*********** sessionPackageBuilder: Delegation test skipped due to pending deployment/nonce conflict:',
        message,
      );
    } else {
      console.error('*********** sessionPackageBuilder: Delegation test call failed:', error);
      throw new Error(`Delegation test failed: ${message}`);
    }
  }

  // set the operator of nft to this newly created sessionAA
  console.info("identityRegistry: ", identityRegistry);
  console.info("zeroAddress: ", zeroAddress);
  if (identityRegistry && identityRegistry !== zeroAddress) {
    console.info('*********** sessionPackageBuilder: set the operator of nft to this newly created sessionAA');
    const approveCalldata = encodeFunctionData({
      abi: IdentityRegistryAbi as any,
      functionName: 'approve',
      args: [sessionAA, BigInt(agentId)],
    });
    console.info('*********** sessionPackageBuilder: approveCalldata', approveCalldata);
    const hash = await sendSponsoredUserOperation({
      bundlerUrl,
      chain,
      accountClient: smartAccount as any,
      calls: [{ to: identityRegistry, data: approveCalldata }],
    });
    await waitForUserOperationReceipt({ bundlerUrl, chain, hash });

    const ownerOfAgent = await publicClient.readContract({
      address: identityRegistry as `0x${string}`,
      abi: IdentityRegistryAbi as any,
      functionName: 'ownerOf' as any,
      args: [agentId],
    }) as `0x${string}`;

    console.info('*********** sessionPackageBuilder: ownerOfAgent', ownerOfAgent);
  }

  console.info('*********** sessionPackageBuilder: sessionPackage');
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
    signedDelegation: deligationWithSignature,
  };

  return sessionPackage;
}


