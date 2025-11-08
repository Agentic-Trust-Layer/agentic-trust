/**
 * Bundler Utilities for Account Abstraction
 *
 * Provides utilities for sending UserOperations via bundlers
 * for Account Abstraction (AA) accounts
 */
import { type Chain } from 'viem';
/**
 * Send a sponsored UserOperation via bundler
 *
 * @param params - UserOperation parameters
 * @returns UserOperation hash
 */
export declare function sendSponsoredUserOperation(params: {
    bundlerUrl: string;
    chain: Chain;
    accountClient: any;
    calls: {
        to: `0x${string}`;
        data?: `0x${string}`;
        value?: bigint;
    }[];
}): Promise<`0x${string}`>;
/**
 * Wait for UserOperation receipt
 *
 * @param params - Receipt parameters
 * @returns UserOperation receipt
 */
export declare function waitForUserOperationReceipt(params: {
    bundlerUrl: string;
    chain: Chain;
    hash: `0x${string}`;
}): Promise<any>;
/**
 * Deploy smart account if needed
 *
 * @param params - Deployment parameters
 * @returns true if account was deployed, false if already deployed
 */
export declare function deploySmartAccountIfNeeded(params: {
    bundlerUrl: string;
    chain: Chain;
    account: {
        isDeployed: () => Promise<boolean>;
    };
}): Promise<boolean>;
/**
 * Check if an address is a smart contract (has code)
 *
 * @param publicClient - Viem public client
 * @param address - Address to check
 * @returns true if address has code (is a contract), false if EOA
 */
export declare function isSmartContract(publicClient: any, address: `0x${string}`): Promise<boolean>;
//# sourceMappingURL=bundlerUtils.d.ts.map