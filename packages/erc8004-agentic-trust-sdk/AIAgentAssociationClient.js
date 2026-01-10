/**
 * Agentic Trust SDK - Association Client
 * Extends AssociationsStoreClient with AccountProvider support.
 * Uses AccountProvider (Ports & Adapters pattern) for chain I/O.
 */
import { sepolia } from 'viem/chains';
import { parseAbi } from 'viem';
import { AssociationsStoreClient } from '@associatedaccounts/erc8092-sdk';
// Import ABI - need to handle the export structure
// The abi.ts file exports ASSOCIATIONS_STORE_ABI as const array
const ASSOCIATIONS_STORE_ABI = parseAbi([
    "function storeAssociation((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record) sar)",
    "function revokeAssociation(bytes32 associationId, uint40 revokedAt)",
    "function getAssociationsForAccount(bytes account) view returns ((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record)[] sars)",
]);
export class AIAgentAssociationClient {
    chain;
    accountProvider;
    associationsProxyAddress;
    baseClient;
    constructor(accountProvider, associationsProxyAddress) {
        this.accountProvider = accountProvider;
        this.associationsProxyAddress = associationsProxyAddress;
        this.chain = sepolia; // Default, can be overridden based on chainId
        // Create base client for read operations using ethers provider
        // Note: For write operations, we'll use AccountProvider via prepareStoreAssociationTx
        // We'll initialize baseClient lazily when needed since we can't use await in constructor
        this.baseClient = null; // Will be initialized in getAssociationsForEvmAccount
    }
    async getBaseClient() {
        if (this.baseClient)
            return this.baseClient;
        const chainConfig = this.accountProvider.chain();
        const rpcUrl = chainConfig.rpcUrl;
        // Use dynamic import for ethers
        const ethers = await import('ethers');
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        this.baseClient = new AssociationsStoreClient(this.associationsProxyAddress, provider);
        return this.baseClient;
    }
    // Factory helper to mirror other client create-style APIs
    static async create(accountProvider, associationsProxyAddress) {
        return new AIAgentAssociationClient(accountProvider, associationsProxyAddress);
    }
    /**
     * Get associations for an account (read-only, uses base client)
     */
    async getAssociationsForEvmAccount(params) {
        const client = await this.getBaseClient();
        return client.getAssociationsForEvmAccount(params);
    }
    /**
     * Get the full SignedAssociationRecords (SARs) for an account (read-only).
     * This exposes initiator/approver key types, signatures, interfaceId, and data.
     */
    async getSignedAssociationsForEvmAccount(params) {
        const client = await this.getBaseClient();
        // Method is provided by @associatedaccounts/erc8092-sdk AssociationsStoreClient
        return client.getSignedAssociationsForEvmAccount(params);
    }
    /**
     * Prepare the storeAssociation transaction data without sending it.
     * This encodes the transaction that can be sent via a bundler using account abstraction.
     */
    async prepareStoreAssociationTx(params) {
        if (!params.sar) {
            throw new Error('sar (SignedAssociationRecord) is required');
        }
        // Encode the storeAssociation call
        const data = await this.accountProvider?.encodeFunctionData({
            abi: ASSOCIATIONS_STORE_ABI,
            functionName: 'storeAssociation',
            args: [params.sar],
        });
        return {
            txRequest: {
                to: this.associationsProxyAddress,
                data: data || '0x',
                value: 0n,
            },
        };
    }
    /**
     * Store association (write operation - requires wallet)
     * This is a convenience method, but for AA we should use prepareStoreAssociationTx + client-side execution
     */
    async storeAssociation(sar) {
        const { txRequest } = await this.prepareStoreAssociationTx({ sar });
        const result = await this.accountProvider?.send({
            to: txRequest.to,
            data: txRequest.data,
            value: txRequest.value,
        });
        return {
            hash: result?.hash || '',
            txHash: result?.hash || '',
        };
    }
}
//# sourceMappingURL=AIAgentAssociationClient.js.map