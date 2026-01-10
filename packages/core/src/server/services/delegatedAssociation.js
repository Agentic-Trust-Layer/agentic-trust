import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, parseAbi } from 'viem';
import { ethers } from 'ethers';
import { Implementation, toMetaMaskSmartAccount, ExecutionMode, } from '@metamask/smart-accounts-kit';
// @ts-ignore contracts path
import { DelegationManager } from '@metamask/smart-accounts-kit/contracts';
import { buildDelegationSetup } from '../lib/sessionPackage';
import { DEFAULT_CHAIN_ID, getChainBundlerUrl, getChainById } from '../lib/chainConfig';
import { sendSponsoredUserOperation, waitForUserOperationReceipt } from '../../client/accountClient';
const ASSOCIATIONS_STORE_ABI = parseAbi([
    'function storeAssociation((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record) sar)',
]);
export async function buildDelegatedAssociationContext(sessionPackage, chainId = DEFAULT_CHAIN_ID) {
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
    if (!delegationSetup.sessionAA) {
        throw new Error('SessionPackage.sessionAA is required to submit delegated storeAssociation.');
    }
    const sessionAccountClient = await toMetaMaskSmartAccount({
        address: delegationSetup.sessionAA,
        client: publicClient,
        implementation: Implementation.Hybrid,
        signer: { walletClient },
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
        bundlerUrl,
        chain,
    };
}
function getAssociationsProxyAddress() {
    const addr = process.env.ASSOCIATIONS_STORE_PROXY ||
        process.env.ASSOCIATIONS_PROXY_ADDRESS ||
        '0xaF7428906D31918dDA2986D1405E2Ded06561E59';
    if (!addr.startsWith('0x') || addr.length !== 42) {
        throw new Error(`Invalid associations proxy address: ${addr}`);
    }
    try {
        return ethers.getAddress(addr);
    }
    catch {
        return ethers.getAddress(addr.toLowerCase());
    }
}
export async function storeErc8092AssociationWithSessionDelegation(params) {
    const chainId = params.chainId ?? params.sessionPackage.chainId ?? DEFAULT_CHAIN_ID;
    const { sessionAccountClient, delegationSetup, bundlerUrl, chain } = await buildDelegatedAssociationContext(params.sessionPackage, chainId);
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
            callData: data,
        },
    ];
    const signedDelegation = delegationSetup.signedDelegation;
    const delegationMessage = {
        delegate: ethers.getAddress((signedDelegation.message?.delegate ?? signedDelegation.delegate)),
        delegator: ethers.getAddress((signedDelegation.message?.delegator ?? signedDelegation.delegator)),
        authority: (signedDelegation.message?.authority ?? signedDelegation.authority),
        caveats: (signedDelegation.message?.caveats ?? signedDelegation.caveats),
        salt: (signedDelegation.message?.salt ?? signedDelegation.salt),
        signature: (signedDelegation.signature ?? signedDelegation.message?.signature),
    };
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
    return { txHash };
}
//# sourceMappingURL=delegatedAssociation.js.map