/**
 * Agentic Trust SDK - Association Client
 * Extends AssociationsStoreClient with AccountProvider support.
 * Uses AccountProvider (Ports & Adapters pattern) for chain I/O.
 */
import type { AccountProvider } from '@agentic-trust/8004-sdk';
import type { SignedAssociationRecord } from '@associatedaccounts/erc8092-sdk';
import type { TxRequest } from '@agentic-trust/8004-sdk';
export declare class AIAgentAssociationClient {
    private chain;
    private accountProvider;
    private associationsProxyAddress;
    private baseClient;
    constructor(accountProvider: AccountProvider, associationsProxyAddress: `0x${string}`);
    private getBaseClient;
    static create(accountProvider: AccountProvider, associationsProxyAddress: `0x${string}`): Promise<AIAgentAssociationClient>;
    /**
     * Get associations for an account (read-only, uses base client)
     */
    getAssociationsForEvmAccount(params: {
        chainId: number;
        accountAddress: string;
    }): Promise<{
        account: string;
        chainId: number;
        associations: any[];
    }>;
    /**
     * Get the full SignedAssociationRecords (SARs) for an account (read-only).
     * This exposes initiator/approver key types, signatures, interfaceId, and data.
     */
    getSignedAssociationsForEvmAccount(params: {
        chainId: number;
        accountAddress: string;
    }): Promise<{
        account: string;
        chainId: number;
        sars: any[];
    }>;
    /**
     * Prepare the storeAssociation transaction data without sending it.
     * This encodes the transaction that can be sent via a bundler using account abstraction.
     */
    prepareStoreAssociationTx(params: {
        sar: SignedAssociationRecord;
    }): Promise<{
        txRequest: TxRequest;
    }>;
    /**
     * Store association (write operation - requires wallet)
     * This is a convenience method, but for AA we should use prepareStoreAssociationTx + client-side execution
     */
    storeAssociation(sar: SignedAssociationRecord): Promise<{
        hash: string;
        txHash: string;
    }>;
}
//# sourceMappingURL=AIAgentAssociationClient.d.ts.map