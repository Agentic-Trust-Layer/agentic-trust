/**
 * Agent Feedback API
 *
 * Handles feedback authentication for agents
 */
import type { PublicClient, Account } from 'viem';
import type { AIAgentReputationClient } from '@erc8004/agentic-trust-sdk';
export interface RequestAuthParams {
    publicClient: PublicClient;
    agentId: bigint;
    clientAddress: `0x${string}`;
    signer: Account;
    walletClient?: any;
    expirySeconds?: number;
}
/**
 * Create feedback auth signature
 */
export declare function createFeedbackAuth(params: RequestAuthParams, reputationClient: AIAgentReputationClient): Promise<`0x${string}`>;
//# sourceMappingURL=agentFeedback.d.ts.map