import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Implementation, toMetaMaskSmartAccount, ExecutionMode, } from '@metamask/smart-accounts-kit';
// @ts-ignore contracts path
import { DelegationManager } from '@metamask/smart-accounts-kit/contracts';
import { buildDelegationSetup, } from '../lib/sessionPackage';
import { DEFAULT_CHAIN_ID, getChainBundlerUrl, getChainById, } from '../lib/chainConfig';
import { getAgenticTrustClient } from '../lib/agenticTrust';
import { getValidationRegistryClient } from '../singletons/validationClient';
import { sendSponsoredUserOperation, waitForUserOperationReceipt, } from '../../client/accountClient';
export async function buildDelegatedValidationContext(sessionPackage, chainId = DEFAULT_CHAIN_ID) {
    const delegationSetup = buildDelegationSetup(sessionPackage);
    const bundlerUrl = getChainBundlerUrl(chainId);
    if (!bundlerUrl) {
        throw new Error(`Bundler URL not configured for chain ${chainId}.`);
    }
    const chain = getChainById(chainId);
    const publicClient = createPublicClient({
        chain: delegationSetup.chain,
        transport: http(delegationSetup.rpcUrl),
    });
    const agentOwnerEOA = privateKeyToAccount(delegationSetup.sessionKey.privateKey);
    const walletClient = createWalletClient({
        account: agentOwnerEOA,
        chain: delegationSetup.chain,
        transport: http(delegationSetup.rpcUrl),
    });
    const sessionAccountClient = await toMetaMaskSmartAccount({
        address: delegationSetup.sessionAA,
        client: publicClient,
        implementation: Implementation.Hybrid,
        signer: {
            walletClient,
        },
        delegation: {
            delegation: delegationSetup.signedDelegation,
            delegator: delegationSetup.aa,
        },
    });
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
export async function processValidationRequestsWithSessionPackage(params) {
    const { sessionPackage, chainId = DEFAULT_CHAIN_ID, agentIdFilter, requestHashFilter, responseScore = 100, responseTag = 'agent-validation', } = params;
    const results = [];
    const context = await buildDelegatedValidationContext(sessionPackage, chainId);
    const { sessionAccountClient, delegationSetup, validatorAddress, bundlerUrl, chain } = context;
    const validationRegistryClient = await getValidationRegistryClient(chainId);
    let requestHashes = [];
    requestHashes = await validationRegistryClient.getValidatorRequests(delegationSetup.aa);
    if (requestHashFilter) {
        requestHashes = requestHashes.filter((hash) => hash.toLowerCase() === requestHashFilter.toLowerCase());
    }
    const client = await getAgenticTrustClient();
    for (const requestHash of requestHashes) {
        let currentAgentId = 'unknown';
        try {
            const status = await validationRegistryClient.getValidationStatus(requestHash);
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
            const txRequest = await validationRegistryClient.prepareValidationResponseTx({
                requestHash,
                response: responseScore,
                tag: responseTag,
            });
            const signedDelegation = delegationSetup.signedDelegation;
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
                    target: txRequest.to,
                    value: BigInt(txRequest.value || '0'),
                    callData: txRequest.data,
                },
            ];
            const redemptionData = DelegationManager.encode.redeemDelegations({
                delegations: [[delegationMessage]],
                modes: [ExecutionMode.SingleDefault],
                executions: [includedExecutions],
            });
            const redemptionCall = {
                to: delegationSetup.sessionAA,
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
        }
        catch (error) {
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
//# sourceMappingURL=delegatedValidation.js.map