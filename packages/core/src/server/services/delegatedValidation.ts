import { createPublicClient, createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  Implementation,
  toMetaMaskSmartAccount,
  ExecutionMode,
} from '@metamask/smart-accounts-kit';
// @ts-ignore contracts path
import { DelegationManager } from '@metamask/smart-accounts-kit/contracts';

import type { SessionPackage } from '../../shared/sessionPackage';
import {
  buildDelegationSetup,
  type DelegationSetup,
} from '../lib/sessionPackage';
import {
  DEFAULT_CHAIN_ID,
  getChainBundlerUrl,
  getChainById,
} from '../lib/chainConfig';
import { getAgenticTrustClient } from '../lib/agenticTrust';
import { getValidationRegistryClient } from '../singletons/validationClient';
import type { ValidationStatus } from '@agentic-trust/8004-sdk';
import {
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
} from '../../client/accountClient';

export interface ValidationResult {
  requestHash: string;
  agentId: string;
  chainId: number;
  success: boolean;
  error?: string;
  txHash?: string;
}

export interface DelegatedValidationContext {
  sessionAccountClient: any;
  walletClient: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
  delegationSetup: DelegationSetup;
  validatorAddress: `0x${string}`;
  bundlerUrl: string;
  chain: Chain;
}

export async function buildDelegatedValidationContext(
  sessionPackage: SessionPackage,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<DelegatedValidationContext> {
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

  const sessionAccountClient = await toMetaMaskSmartAccount({
    address: delegationSetup.sessionAA as `0x${string}`,
    client: publicClient,
    implementation: Implementation.Hybrid,
    signer: {
      walletClient,
    },
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
    validatorAddress: delegationSetup.aa,
    bundlerUrl,
    chain,
  };
}

export async function processValidationRequestsWithSessionPackage(params: {
  sessionPackage: SessionPackage;
  chainId?: number;
  agentIdFilter?: string;
  requestHashFilter?: string;
  responseScore?: number;
  responseTag?: string;
}): Promise<ValidationResult[]> {
  const {
    sessionPackage,
    chainId = DEFAULT_CHAIN_ID,
    agentIdFilter,
    requestHashFilter,
    responseScore = 100,
    responseTag = 'agent-validation',
  } = params;

  const results: ValidationResult[] = [];

  const context = await buildDelegatedValidationContext(sessionPackage, chainId);
  const { sessionAccountClient, delegationSetup, validatorAddress, bundlerUrl, chain } = context;

  const validationRegistryClient = await getValidationRegistryClient(chainId);

  let requestHashes: string[] = [];
  requestHashes = await validationRegistryClient.getValidatorRequests(delegationSetup.aa);

  if (requestHashFilter) {
    requestHashes = requestHashes.filter(
      (hash) => hash.toLowerCase() === requestHashFilter.toLowerCase(),
    );
  }

  const client = await getAgenticTrustClient();

  for (const requestHash of requestHashes) {
    let currentAgentId = 'unknown';
    try {
      const status: ValidationStatus = await validationRegistryClient.getValidationStatus(requestHash);
      if (status.response !== 0) {
        continue;
      }

      if (status.validatorAddress.toLowerCase() !== validatorAddress.toLowerCase()) {
        continue;
      }

      const agentId = status.agentId.toString();
      currentAgentId = agentId;
      if (agentIdFilter && agentId !== agentIdFilter) {
        continue;
      }

      const agent = await client.agents.getAgent(agentId, chainId);
      if (!agent?.agentName || !agent.agentAccount) {
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error: `Agent ${agentId} is missing name or account`,
        });
        continue;
      }

      const txRequest = await (validationRegistryClient as any).prepareValidationResponseTx({
        requestHash,
        response: responseScore,
        tag: responseTag,
      });

      const signedDelegation = delegationSetup.signedDelegation as unknown as {
        delegate: `0x${string}`;
        delegator: `0x${string}`;
        authority: `0x${string}`;
        caveats: any[];
        salt: `0x${string}`;
        signature: `0x${string}`;
      };

      const delegationMessage = {
        delegate: signedDelegation.delegate,
        delegator: signedDelegation.delegator,
        authority: signedDelegation.authority,
        caveats: signedDelegation.caveats,
        salt: signedDelegation.salt,
        signature: signedDelegation.signature,
      };

      const includedExecutions = [
        {
          target: txRequest.to as `0x${string}`,
          value: BigInt(txRequest.value || '0'),
          callData: txRequest.data as `0x${string}`,
        },
      ];

      const redemptionData = DelegationManager.encode.redeemDelegations({
        delegations: [[delegationMessage]],
        modes: [ExecutionMode.SingleDefault],
        executions: [includedExecutions],
      });

      const redemptionCall = {
        to: delegationSetup.sessionAA as `0x${string}`,
        data: redemptionData,
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
      const txHash = receipt?.transactionHash || receipt?.receipt?.transactionHash || userOpHash;

      results.push({
        requestHash,
        agentId,
        chainId,
        success: true,
        txHash,
      });
    } catch (error) {
      results.push({
        requestHash,
        agentId: currentAgentId,
        chainId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

