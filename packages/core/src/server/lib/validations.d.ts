import type { ValidationStatus } from '@agentic-trust/8004-sdk';
export interface ValidationStatusWithHash extends ValidationStatus {
    requestHash: string;
}
export interface AgentValidationsSummary {
    agentId: string;
    chainId: number;
    did8004: string;
    pending: ValidationStatusWithHash[];
    completed: ValidationStatusWithHash[];
}
export declare function getAgentValidationsSummary(chainId: number, agentId: string | number): Promise<AgentValidationsSummary>;
/**
 * Create a validator account abstraction using the name 'name-validation' as the seed from a private key.
 * The validator address is determined server-side based on AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY.
 */
export declare function createValidatorAccountAbstraction(validatorName: string, validatorPrivateKey: string, chainId?: number): Promise<{
    accountClient: any;
    address: `0x${string}`;
}>;
/**
 * Get validation requests for a validator address
 */
export declare function getValidatorAddressValidations(chainId: number, validatorAddress: string): Promise<ValidationStatusWithHash[]>;
//# sourceMappingURL=validations.d.ts.map