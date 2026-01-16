export type AgentOperationKind = 'create' | 'update';
export type AgentOperationMode = 'smartAccount' | 'eoa';
export interface AgentOperationCall {
    to: string;
    data: string;
    value: string;
}
export interface AgentPreparedTransactionPayload {
    to: string;
    data: string;
    value: string;
    gas?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    nonce?: number;
    chainId: number;
}
export interface AgentOperationPlan {
    success: true;
    operation: AgentOperationKind;
    mode: AgentOperationMode;
    chainId: number;
    cid?: string;
    identityRegistry?: string;
    tokenUri?: string;
    bundlerUrl?: string;
    calls: AgentOperationCall[];
    transaction?: AgentPreparedTransactionPayload | null;
    agentId?: string;
    txHash?: string;
    metadata?: Record<string, unknown>;
}
export interface DirectCreateAgentPayload {
    mode: AgentOperationMode;
    agentName: string;
    agentAccount: string;
    agentCategory?: string;
    description?: string;
    image?: string;
    agentUrl?: string;
    supportedTrust?: string[];
    endpoints?: Array<{
        name: string;
        endpoint: string;
        version?: string;
        capabilities?: Record<string, any>;
    }>;
    chainId?: number;
    ensOptions?: Record<string, unknown>;
}
export interface CreateAgentPayload {
    mode: AgentOperationMode;
    agentName: string;
    agentAccount: string;
    agentCategory?: string;
    account?: string;
    description?: string;
    image?: string;
    agentUrl?: string;
    supportedTrust?: string[];
    endpoints?: Array<{
        name: string;
        endpoint: string;
        version?: string;
        capabilities?: Record<string, any>;
    }>;
    chainId?: number;
}
export interface UpdateAgentRegistrationPayload {
    did8004: string;
    registration: unknown;
    mode?: AgentOperationMode;
}
export interface RequestFeedbackAuthPayload {
    clientAddress: string;
    agentId: string;
    chainId?: number;
    indexLimit?: number;
    expirySeconds?: number;
    /**
     * Optional client-constructed ERC-8092 SAR payload. If provided, it will be forwarded to
     * the provider's A2A handler for `governance_and_trust/trust/trust_feedback_authorization`, which can store it
     * on-chain using the provider's MetaMask delegation/session package.
     */
    delegationSar?: unknown;
}
export interface RequestFeedbackAuthResult {
    feedbackAuthId: string;
    agentId: string;
    chainId: number;
    delegationAssociation?: unknown;
}
export interface PrepareFeedbackPayload {
    did8004: string;
    score: number;
    feedback: string;
    feedbackAuth: string;
    clientAddress?: string;
    tag1?: string;
    tag2?: string;
    feedbackUri?: string;
    feedbackHash?: string;
    skill?: string;
    context?: string;
    capability?: string;
    mode?: AgentOperationMode;
}
export interface PrepareValidationRequestPayload {
    did8004: string;
    requestUri?: string;
    requestHash?: string;
    mode?: AgentOperationMode;
    validatorAddress?: string;
}
export interface PrepareAssociationRequestPayload {
    did8004: string;
    /**
     * Optional: override the initiator account address used in the association record.
     * If provided, server will use this instead of the agent's stored agentAccount.
     */
    initiatorAddress?: `0x${string}`;
    approverAddress: string;
    assocType?: number;
    description?: string;
    /**
     * Optional: override the validAt used in the association record.
     * Recommended to use chain time (or a small negative buffer) to avoid clock skew reverts.
     */
    validAt?: number;
    /**
     * Optional: pass pre-encoded `record.data` bytes (ABI-encoded assocType+description).
     * If provided, server will use this directly.
     */
    data?: `0x${string}`;
    /**
     * Optional: initiator signature over eip712Hash(record), typically a personal_sign signature
     * produced by the initiator's owner wallet. Required by some ERC-8092 store implementations.
     */
    initiatorSignature?: `0x${string}`;
    /**
     * Optional: approver signature over eip712Hash(record).
     * If omitted, storeAssociation may revert on-chain depending on the AssociationsStore implementation.
     */
    approverSignature?: `0x${string}`;
    mode?: AgentOperationMode;
}
export interface DirectFeedbackPayload {
    did8004?: string;
    agentId?: string | number;
    chainId?: number;
    score: number | string;
    feedback?: string;
    feedbackAuth: string;
    clientAddress?: string;
    tag1?: string;
    tag2?: string;
    feedbackUri?: string;
    feedbackHash?: string;
    skill?: string;
    context?: string;
    capability?: string;
}
//# sourceMappingURL=types.d.ts.map