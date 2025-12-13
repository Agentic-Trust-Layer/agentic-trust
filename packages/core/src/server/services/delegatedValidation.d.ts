import { createPublicClient, createWalletClient, type Chain } from 'viem';
import type { SessionPackage } from '../../shared/sessionPackage';
import { type DelegationSetup } from '../lib/sessionPackage';
export interface ValidationResult {
    requestHash: string;
    agentId: string;
    chainId: number;
    success: boolean;
    error?: string;
    txHash?: string;
}
export interface DelegatedValidationContext {
    sessionAccountClient: any;
    walletClient: ReturnType<typeof createWalletClient>;
    publicClient: ReturnType<typeof createPublicClient>;
    delegationSetup: DelegationSetup;
    validatorAddress: `0x${string}`;
    bundlerUrl: string;
    chain: Chain;
}
export declare function buildDelegatedValidationContext(sessionPackage: SessionPackage, chainId?: number): Promise<DelegatedValidationContext>;
export declare function processValidationRequestsWithSessionPackage(params: {
    sessionPackage: SessionPackage;
    chainId?: number;
    agentIdFilter?: string;
    requestHashFilter?: string;
    responseScore?: number;
    responseTag?: string;
}): Promise<ValidationResult[]>;
//# sourceMappingURL=delegatedValidation.d.ts.map