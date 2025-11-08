/**
 * ENS Client Singleton
 *
 * Manages a singleton instance of AIAgentENSClient
 * Initialized from environment variables using AccountProvider
 */
import { AIAgentENSClient } from '@erc8004/agentic-trust-sdk';
/**
 * Get or create the AIAgentENSClient singleton
 * Initializes from environment variables using AccountProvider from AdminApp, ClientApp, or ProviderApp
 */
export declare function getENSClient(): Promise<AIAgentENSClient>;
/**
 * Check if ENS client is initialized
 */
export declare function isENSClientInitialized(): boolean;
/**
 * Reset the ENS client instance (useful for testing)
 */
export declare function resetENSClient(): void;
/**
 * Check if an ENS name is available
 *
 * @param agentName - The agent name (e.g., "my-agent")
 * @param orgName - The organization name (e.g., "8004-agent" or "8004-agent.eth")
 * @returns true if the ENS name is available, false if it's taken, null if check failed
 */
export declare function isENSAvailable(agentName: string, orgName: string): Promise<boolean | null>;
export declare function sendSponsoredUserOperation(params: {
    bundlerUrl: string;
    chain: any;
    accountClient: any;
    calls: {
        to: `0x${string}`;
        data?: `0x${string}`;
        value?: bigint;
    }[];
}): Promise<`0x${string}`>;
/**
 * Create an ENS subdomain name for an agent
 *
 * @param agentName - The agent name (e.g., "my-agent")
 * @param orgName - The organization name (e.g., "8004-agent" or "8004-agent.eth")
 * @param agentAddress - The agent's account address (0x...)
 * @param agentUrl - Optional agent URL to set in ENS text record
 * @param accountProvider - Optional AccountProvider to use (if not provided, will try to get from AdminApp/ClientApp/ProviderApp)
 * @returns Array of transaction hashes for the ENS creation transactions
 * @throws Error if ENS creation fails
 */
export interface AddAgentToOrgParams {
    agentName: string;
    orgName: string;
    agentAddress: `0x${string}`;
    agentUrl?: string;
}
export interface AddAgentToOrgResult {
    userOpHash: `0x${string}`;
    receipt: any;
}
export interface PrepareAgentNameInfoParams {
    agentName: string;
    orgName: string;
    agentAddress: `0x${string}`;
    agentUrl?: string;
    agentDescription?: string;
}
export interface PrepareAgentNameInfoResult {
    calls: {
        to: `0x${string}`;
        data: `0x${string}`;
        value?: bigint;
    }[];
}
export declare function addAgentNameToOrgUsingEnsKey(params: AddAgentToOrgParams): Promise<AddAgentToOrgResult>;
export declare function prepareAgentNameInfoCalls(params: PrepareAgentNameInfoParams): Promise<PrepareAgentNameInfoResult>;
//# sourceMappingURL=ensClient.d.ts.map