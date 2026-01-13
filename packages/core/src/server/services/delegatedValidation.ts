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
  requireChainEnvVar,
} from '../lib/chainConfig';
import { getAgenticTrustClient } from '../lib/agenticTrust';
import { getValidationRegistryClient } from '../singletons/validationClient';
import type { ValidationStatus } from '@agentic-trust/8004-sdk';
import {
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
} from '../../client/accountClient';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

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
  responseUri?: string;
  responseTag?: string;
  validatorValidated?: boolean; // true if validator has explicitly validated, undefined if no validator or not checked
}): Promise<ValidationResult[]> {
  const {
    sessionPackage,
    chainId = DEFAULT_CHAIN_ID,
    agentIdFilter,
    requestHashFilter,
    responseScore = 100,
    responseUri,
    responseTag = 'agent-validation',
    validatorValidated,
  } = params;

  const results: ValidationResult[] = [];

  const context = await buildDelegatedValidationContext(sessionPackage, chainId);
  const { sessionAccountClient, delegationSetup, validatorAddress, bundlerUrl, chain } = context;

  const validationRegistryClient = await getValidationRegistryClient(chainId);

  // Preflight: ensure ValidationRegistry is wired to the same IdentityRegistry we expect for this chain.
  // If these disagree, authorization + status reads will not match what the UI shows.
  try {
    const configuredValidationRegistry = requireChainEnvVar('AGENTIC_TRUST_VALIDATION_REGISTRY', chainId);
    const configuredIdentityRegistry = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId);
    const onChainIdentityRegistry = (await (validationRegistryClient as any).getIdentityRegistry()) as string;

    const ok =
      typeof onChainIdentityRegistry === 'string' &&
      onChainIdentityRegistry.toLowerCase() === configuredIdentityRegistry.toLowerCase();

    console.log('[delegatedValidation] ValidationRegistry wiring preflight:', {
      chainId,
      configuredValidationRegistry,
      configuredIdentityRegistry,
      onChainIdentityRegistry,
      ok,
    });

    if (!ok) {
      throw new Error(
        `ValidationRegistry wiring mismatch for chain ${chainId}. ` +
          `Configured AGENTIC_TRUST_VALIDATION_REGISTRY (${configuredValidationRegistry}) points to IdentityRegistry ${onChainIdentityRegistry}, ` +
          `but AGENTIC_TRUST_IDENTITY_REGISTRY is ${configuredIdentityRegistry}.`,
      );
    }
  } catch (e) {
    // No fallbacks: if we can't trust wiring, do not proceed.
    throw e;
  }

  let requestHashes: string[] = [];
  
  // If requestHashFilter is provided, use it directly instead of querying all validator requests
  // This is more efficient and avoids missing requests that might not be in the list
  if (requestHashFilter) {
    console.log('[delegatedValidation] Using provided requestHashFilter:', requestHashFilter);
    requestHashes = [requestHashFilter];
  } else {
    console.log('[delegatedValidation] Querying all validator requests for:', delegationSetup.aa);
    requestHashes = await validationRegistryClient.getValidatorRequests(delegationSetup.aa);
    console.log('[delegatedValidation] Found validator requests:', requestHashes.length, requestHashes);
  }

  const client = await getAgenticTrustClient();

  console.log('[delegatedValidation] =========================================');
  console.log('[delegatedValidation] Processing validation requests');
  console.log('[delegatedValidation] =========================================');
  console.log('[delegatedValidation] Input parameters:', {
    requestHashesCount: requestHashes.length,
    requestHashes,
    validatorAddress: `${validatorAddress} (from SessionPackage - this is the validator)`,
    agentIdFilter: agentIdFilter ? `${agentIdFilter} (agent being validated, not used for filtering)` : 'none',
    requestHashFilter,
    responseScore,
    responseTag,
    chainId,
  });

  for (const requestHash of requestHashes) {
    let currentAgentId = 'unknown';
    try {
      console.log('[delegatedValidation] ---');
      console.log('[delegatedValidation] Checking requestHash:', requestHash);
      const status: ValidationStatus = await validationRegistryClient.getValidationStatus(requestHash);
      console.log('[delegatedValidation] Validation status from chain:', {
        requestHash,
        response: status.response,
        validatorAddress: `${status.validatorAddress} (validator expected by this request)`,
        agentId: `${status.agentId?.toString()} (agent being validated)`,
      });
      console.log('[delegatedValidation] Validator address check:', {
        requestHashExpectedValidatorAddress: status.validatorAddress.toLowerCase(),
        sessionPackageValidatorAddress: validatorAddress.toLowerCase(),
        match: status.validatorAddress.toLowerCase() === validatorAddress.toLowerCase(),
      });

      if (status.response !== 0) {
        console.log('[delegatedValidation] ❌ Skipping: validation already responded (response =', status.response, '!= 0)');
        continue;
      }

      if (status.validatorAddress.toLowerCase() !== validatorAddress.toLowerCase()) {
        console.log('[delegatedValidation] ❌ Skipping: VALIDATOR ADDRESS MISMATCH');
        console.log('[delegatedValidation]   The validation request expects validator:', status.validatorAddress);
        console.log('[delegatedValidation]   But SessionPackage validator address is:', validatorAddress);
        console.log('[delegatedValidation]   This validation request cannot be processed by this validator.');
        continue;
      }

      console.log('[delegatedValidation] ✅ Validator address matches');

      // Check if validator is defined (not zero address)
      const hasValidator = status.validatorAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase();
      
      if (hasValidator) {
        console.log('[delegatedValidation] Validator is defined for this request, checking if validator has returned "validated"');
        
        // Check if validator has explicitly validated
        // The validatorValidated parameter comes from the validator class (e.g., ens-validator)
        // It must be true for the on-chain response to be created
        if (validatorValidated !== true) {
          console.log('[delegatedValidation] ❌ Skipping: Validator has not returned "validated: true"');
          console.log('[delegatedValidation]   Validator must explicitly return "validated: true" before on-chain response can be created');
          console.log('[delegatedValidation]   Current validatorValidated value:', validatorValidated);
          results.push({
            requestHash,
            agentId: status.agentId?.toString() || 'unknown',
            chainId,
            success: false,
            error: 'Validator must return "validated: true" before validation response can be created on-chain',
          });
          continue;
        }

        console.log('[delegatedValidation] ✅ Validator has returned "validated: true" - proceeding with validation response');
      } else {
        console.log('[delegatedValidation] No validator defined for this request - proceeding with validation response');
      }

      const agentId = status.agentId.toString();
      currentAgentId = agentId;
      console.log('[delegatedValidation] Agent being validated:', agentId);
      console.log('[delegatedValidation] Note: agentIdFilter parameter (', agentIdFilter, ') is not used for filtering');
      console.log('[delegatedValidation] The validator is identified by validatorAddress from SessionPackage, not by agentIdFilter');
      const agent = await client.agents.getAgent(agentId, chainId);
      if (!agent?.agentName || !agent.agentAccount) {
        console.log('[delegatedValidation] Agent missing name or account:', { agentId, agentName: agent?.agentName, agentAccount: agent?.agentAccount });
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error: `Agent ${agentId} is missing name or account`,
        });
        continue;
      }

      console.log('[delegatedValidation] ✅ All checks passed - preparing validation response transaction');
      console.log('[delegatedValidation] Transaction parameters:', {
        requestHash,
        responseScore,
        responseUri: responseUri || '(none)',
        responseTag,
      });
      const txRequest = await (validationRegistryClient as any).prepareValidationResponseTx({
        requestHash,
        response: responseScore,
        responseUri: responseUri || undefined,
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

      console.log('[delegatedValidation] Validation response transaction successful:', {
        requestHash,
        agentId,
        txHash,
      });

      results.push({
        requestHash,
        agentId,
        chainId,
        success: true,
        txHash,
      });
    } catch (error) {
      console.error('[delegatedValidation] Error processing validation request:', {
        requestHash,
        agentId: currentAgentId,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      results.push({
        requestHash,
        agentId: currentAgentId,
        chainId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  console.log('[delegatedValidation] =========================================');
  console.log('[delegatedValidation] Final results summary');
  console.log('[delegatedValidation] =========================================');
  console.log('[delegatedValidation] Results count:', results.length);
  if (results.length === 0) {
    console.log('[delegatedValidation] ⚠️  No results - validation request was not processed');
    console.log('[delegatedValidation] This could be due to:');
    console.log('[delegatedValidation]   - Validator address mismatch (request expects different validator)');
    console.log('[delegatedValidation]   - Validation already responded');
    console.log('[delegatedValidation]   - Error during processing');
  } else {
    results.forEach((r, idx) => {
      console.log(`[delegatedValidation] Result ${idx + 1}:`, {
        requestHash: r.requestHash,
        agentId: r.agentId,
        success: r.success ? '✅ SUCCESS' : '❌ FAILED',
        error: r.error || '(none)',
        txHash: r.txHash || '(none)',
      });
    });
  }
  console.log('[delegatedValidation] =========================================');

  return results;
}

