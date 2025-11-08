/**
 * Bundler Utilities for Account Abstraction
 *
 * Provides utilities for sending UserOperations via bundlers
 * for Account Abstraction (AA) accounts
 */
import { createBundlerClient } from 'viem/account-abstraction';
import { http, zeroAddress } from 'viem';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
function getPimlicoClient(bundlerUrl) {
    return createPimlicoClient({ transport: http(bundlerUrl) });
}
/**
 * Send a sponsored UserOperation via bundler
 *
 * @param params - UserOperation parameters
 * @returns UserOperation hash
 */
export async function sendSponsoredUserOperation(params) {
    const { bundlerUrl, chain, accountClient, calls } = params;
    const pimlicoClient = await getPimlicoClient(bundlerUrl);
    const bundlerClient = createBundlerClient({
        transport: http(bundlerUrl),
        paymaster: true,
        chain: chain,
        paymasterContext: { mode: 'SPONSORED' }
    });
    const { fast: fee } = await pimlicoClient.getUserOperationGasPrice();
    const userOpHash = await bundlerClient.sendUserOperation({
        account: accountClient,
        calls,
        ...fee
    });
    return userOpHash;
}
/**
 * Wait for UserOperation receipt
 *
 * @param params - Receipt parameters
 * @returns UserOperation receipt
 */
export async function waitForUserOperationReceipt(params) {
    const { bundlerUrl, chain, hash } = params;
    const bundlerClient = createBundlerClient({
        transport: http(bundlerUrl),
        paymaster: true,
        chain: chain,
        paymasterContext: { mode: 'SPONSORED' }
    });
    return await bundlerClient.waitForUserOperationReceipt({ hash });
}
/**
 * Deploy smart account if needed
 *
 * @param params - Deployment parameters
 * @returns true if account was deployed, false if already deployed
 */
export async function deploySmartAccountIfNeeded(params) {
    const { bundlerUrl, chain, account } = params;
    const isDeployed = await account.isDeployed();
    if (isDeployed)
        return false;
    const pimlico = await getPimlicoClient(bundlerUrl);
    const bundlerClient = createBundlerClient({
        transport: http(bundlerUrl),
        paymaster: true,
        chain: chain,
        paymasterContext: { mode: 'SPONSORED' }
    });
    const { fast } = await pimlico.getUserOperationGasPrice();
    const userOperationHash = await bundlerClient.sendUserOperation({
        account,
        calls: [{ to: zeroAddress }],
        ...fast
    });
    await bundlerClient.waitForUserOperationReceipt({ hash: userOperationHash });
    return true;
}
/**
 * Check if an address is a smart contract (has code)
 *
 * @param publicClient - Viem public client
 * @param address - Address to check
 * @returns true if address has code (is a contract), false if EOA
 */
export async function isSmartContract(publicClient, address) {
    try {
        const code = await publicClient.getBytecode({ address });
        return code !== undefined && code !== '0x';
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=bundlerUtils.js.map