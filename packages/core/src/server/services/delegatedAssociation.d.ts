import { createPublicClient, createWalletClient, type Chain } from 'viem';
import type { SessionPackage } from '../../shared/sessionPackage';
import { type DelegationSetup } from '../lib/sessionPackage';
export type DelegatedAssociationContext = {
    sessionAccountClient: any;
    walletClient: ReturnType<typeof createWalletClient>;
    publicClient: ReturnType<typeof createPublicClient>;
    delegationSetup: DelegationSetup;
    bundlerUrl: string;
    chain: Chain;
};
export declare function buildDelegatedAssociationContext(sessionPackage: SessionPackage, chainId?: number): Promise<DelegatedAssociationContext>;
export declare function storeErc8092AssociationWithSessionDelegation(params: {
    sessionPackage: SessionPackage;
    chainId?: number;
    sar: any;
}): Promise<{
    txHash: string;
}>;
//# sourceMappingURL=delegatedAssociation.d.ts.map