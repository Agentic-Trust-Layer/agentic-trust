/**
 * Client-side wallet signing utilities
 *
 * Handles MetaMask/EIP-1193 wallet integration for signing and sending transactions
 * All Ethereum logic is handled server-side, client only needs to sign and send
 */
import { type Address, type Chain } from 'viem';
/**
 * Transaction prepared by server for client-side signing
 */
export interface PreparedTransaction {
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;
    gas?: `0x${string}`;
    gasPrice?: `0x${string}`;
    maxFeePerGas?: `0x${string}`;
    maxPriorityFeePerGas?: `0x${string}`;
    nonce?: number;
    chainId: number;
}
/**
 * Result of signing and sending a transaction
 */
export interface TransactionResult {
    hash: `0x${string}`;
    receipt: any;
    agentId?: string;
}
/**
 * Options for signing a transaction
 */
export interface SignTransactionOptions {
    transaction: PreparedTransaction;
    account: Address;
    chain: Chain;
    ethereumProvider?: any;
    rpcUrl?: string;
    onStatusUpdate?: (message: string) => void;
    extractAgentId?: boolean;
}
/**
 * Sign and send a transaction using MetaMask/EIP-1193 wallet
 *
 * @param options - Signing options including transaction, account, chain, and provider
 * @returns Transaction hash, receipt, and optionally extracted agentId
 */
export declare function signAndSendTransaction(options: SignTransactionOptions): Promise<TransactionResult>;
/**
 * Extract agentId from a transaction receipt (for agent creation)
 * Looks for ERC-721 Transfer event from zero address
 *
 * @param receipt - Transaction receipt
 * @returns Extracted agentId as string, or undefined if not found
 */
export declare function extractAgentIdFromReceipt(receipt: any): string | undefined;
/**
 * Refresh agent in GraphQL indexer
 *
 * @param agentId - Agent ID to refresh
 * @param refreshEndpoint - Optional custom refresh endpoint (defaults to `/api/agents/${agentId}/refresh`)
 * @returns Promise that resolves when refresh is complete
 */
export declare function refreshAgentInIndexer(agentId: string, refreshEndpoint?: string): Promise<void>;
/**
 * Check if wallet provider is available
 *
 * @param ethereumProvider - Optional provider (defaults to window.ethereum)
 * @returns true if provider is available
 */
export declare function isWalletProviderAvailable(ethereumProvider?: any): boolean;
/**
 * Get the connected wallet address from provider
 *
 * @param ethereumProvider - Optional provider (defaults to window.ethereum)
 * @returns Connected wallet address, or null if not connected
 */
export declare function getWalletAddress(ethereumProvider?: any): Promise<Address | null>;
/**
 * Options for creating an agent with wallet signing
 * Only agentData is required - everything else is automatically detected
 */
export interface CreateAgentWithWalletOptions {
    agentData: {
        agentName: string;
        agentAccount: `0x${string}`;
        description?: string;
        image?: string;
        agentUrl?: string;
    };
    account?: Address;
    ethereumProvider?: any;
    rpcUrl?: string;
    onStatusUpdate?: (message: string) => void;
    useAA?: boolean;
    ensOptions?: {
        enabled?: boolean;
        orgName?: string;
    };
}
/**
 * Result of creating an agent
 */
export interface CreateAgentResult {
    agentId?: string;
    txHash: string;
    requiresClientSigning: boolean;
}
/**
 * Create an agent with automatic wallet signing if needed
 *
 * This method handles the entire flow:
 * 1. Calls the API to create agent (endpoint: /api/agents/create-for-eoa)
 * 2. If client-side signing is required, signs and sends transaction
 * 3. Waits for receipt and extracts agentId
 * 4. Refreshes GraphQL indexer
 *
 * Only agentData is required - account, chain, and provider are auto-detected
 *
 * @param options - Creation options (only agentData required)
 * @returns Agent creation result
 */
export declare function createAgentWithWalletForEOA(options: CreateAgentWithWalletOptions): Promise<CreateAgentResult>;
export declare function createAgentWithWalletForAA(options: CreateAgentWithWalletOptions): Promise<CreateAgentResult>;
//# sourceMappingURL=walletSigning.d.ts.map