/**
 * Agentic Trust SDK - Validation Client
 * Extends the base ERC-8004 ValidationClient with AccountProvider support.
 * Uses AccountProvider (Ports & Adapters pattern) for chain I/O.
 */
import { ValidationClient as BaseValidationClient, type ValidationStatus, AccountProvider, type TxRequest } from '@agentic-trust/8004-sdk';
export interface ValidationRequestParams {
    validatorAddress: string;
    agentId: bigint;
    requestUri: string;
    requestHash: string;
}
export interface ValidationResponseParams {
    requestHash: string;
    response: number;
    responseUri?: string;
    responseHash?: string;
    tag?: string;
}
export declare class AIAgentValidationClient extends BaseValidationClient {
    private chain;
    private accountProvider;
    private validationRegistryAddress;
    constructor(accountProvider: AccountProvider, validationRegistryAddress: `0x${string}`);
    static create(accountProvider: AccountProvider, validationRegistryAddress: `0x${string}`): Promise<AIAgentValidationClient>;
    getIdentityRegistry(): Promise<string>;
    getAgentValidations(agentId: bigint): Promise<string[]>;
    getValidatorRequests(validatorAddress: string): Promise<string[]>;
    getValidationStatus(requestHash: string): Promise<ValidationStatus>;
    getSummary(agentId: bigint, validatorAddresses?: string[], tag?: string): Promise<{
        count: bigint;
        avgResponse: number;
    }>;
    validationRequest(params: ValidationRequestParams): Promise<{
        txHash: string;
        requestHash: string;
    }>;
    validationResponse(params: ValidationResponseParams): Promise<{
        txHash: string;
    }>;
    /**
     * Prepare the validationRequest transaction data without sending it.
     * Requires the validator account address to be provided (computed server-side).
     */
    prepareValidationRequestTx(params: {
        agentId: string | number | bigint;  // agentId requesting validation
        validatorAddress: `0x${string}`;    // validatorAddress that performs the validation
        requestUri?: string;                // URI of the request (e.g. https://agentic-trust.org/validation/1)
        requestHash?: string;               // hash of the request (e.g. keccak256 of the requestUri)
    }): Promise<{
        txRequest: TxRequest;
        requestHash: string;
    }>;
    /**
     * Prepare the validationResponse transaction data without sending it.
     * This encodes the transaction that can be sent via a bundler using account abstraction.
     */
    prepareValidationResponseTx(params: ValidationResponseParams): Promise<TxRequest>;
}
//# sourceMappingURL=AIAgentValidationClient.d.ts.map