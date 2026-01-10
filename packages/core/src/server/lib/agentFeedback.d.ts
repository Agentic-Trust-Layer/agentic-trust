/**
 * Agent Feedback API
 *
 * Handles feedback authentication for agents
 */
import type { PublicClient, Account } from 'viem';
export interface RequestAuthParams {
    publicClient: PublicClient;
    agentId: bigint;
    clientAddress: `0x${string}`;
    signer: Account;
    walletClient?: any;
    expirySeconds?: number;
}
export type FeedbackAuthDelegationAssociation = {
    associationId: `0x${string}`;
    initiatorAddress: `0x${string}`;
    approverAddress: `0x${string}`;
    assocType: 1;
    validAt: number;
    validUntil: number;
    data: `0x${string}`;
    approverSignature: `0x${string}`;
    sar: {
        revokedAt: number;
        initiatorKeyType: `0x${string}`;
        approverKeyType: `0x${string}`;
        initiatorSignature: `0x${string}`;
        approverSignature: `0x${string}`;
        record: {
            initiator: `0x${string}`;
            approver: `0x${string}`;
            validAt: number;
            validUntil: number;
            interfaceId: `0x${string}`;
            data: `0x${string}`;
        };
    };
    delegation: Record<string, unknown>;
};
export type CreateFeedbackAuthWithDelegationResult = {
    feedbackAuth: `0x${string}`;
    delegationAssociation?: FeedbackAuthDelegationAssociation;
};
/**
 * Create feedback auth signature
 */
export declare function createFeedbackAuth(params: RequestAuthParams): Promise<`0x${string}`>;
/**
 * Create feedback auth signature and also produce a pre-signed ERC-8092 delegation association
 * record (approver signature only). The client can add the initiator signature and store it
 * on-chain to memorialize the delegation that grants rights to "give feedback".
 */
export declare function createFeedbackAuthWithDelegation(params: RequestAuthParams): Promise<CreateFeedbackAuthWithDelegationResult>;
//# sourceMappingURL=agentFeedback.d.ts.map