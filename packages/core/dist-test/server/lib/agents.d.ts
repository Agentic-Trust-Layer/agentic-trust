/**
 * Agents API for AgenticTrust Client
 */
import type { AgenticTrustClient } from '../singletons/agenticTrustClient';
import { type AgentData } from '@erc8004/agentic-trust-sdk';
import { Agent } from './agent';
export type { AgentData };
export interface ListAgentsResponse {
    agents: Agent[];
    total: number;
}
export declare class AgentsAPI {
    private client;
    constructor(client: AgenticTrustClient);
    /**
     * List all agents
     * Query uses the actual schema fields from the API
     * Returns agents sorted by agentId in descending order
     * Fetches all agents using pagination if needed
     */
    listAgents(): Promise<ListAgentsResponse>;
    /**
     * Get a single agent by ID
     * @param agentId - The agent ID as a string
     * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
     */
    getAgent(agentId: string, chainId?: number): Promise<Agent | null>;
    /**
     * Get raw agent data from GraphQL (for internal use)
     * Returns the raw AgentData from the GraphQL indexer
     */
    getAgentFromGraphQL(chainId: number, agentId: string): Promise<AgentData | null>;
    /**
     * Refresh/Index an agent in the GraphQL indexer
     * Triggers the indexer to re-index the specified agent
     * @param agentId - Agent ID to refresh (required)
     * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
     */
    refreshAgent(agentId: string, chainId?: number): Promise<any>;
    /**
     * Create a new agent
     * Requires AdminApp to be initialized (server-side)
     * @param params - Agent creation parameters
     * @returns Created agent ID and transaction hash, or prepared transaction for client-side signing
     */
    createAgentForEOA(params: {
        agentName: string;
        agentAccount: `0x${string}`;
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
    }): Promise<{
        agentId: bigint;
        txHash: string;
    } | {
        requiresClientSigning: true;
        transaction: {
            to: `0x${string}`;
            data: `0x${string}`;
            value: string;
            gas?: string;
            gasPrice?: string;
            maxFeePerGas?: string;
            maxPriorityFeePerGas?: string;
            nonce?: number;
            chainId: number;
        };
        tokenURI: string;
        metadata: Array<{
            key: string;
            value: string;
        }>;
    }>;
    createAgentForAA(params: {
        agentName: string;
        agentAccount: `0x${string}`;
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
    }): Promise<{
        success: true;
        bundlerUrl: string;
        tokenURI: string;
        chainId: number;
        calls: Array<{
            to: `0x${string}`;
            data: `0x${string}`;
        }>;
    }>;
    extractAgentIdFromReceipt(receipt: any, chainId?: number): Promise<string | null>;
    /**
     * Search agents by name
     * @param query - Search query string to match against agent names
     * Fetches all matching agents using pagination if needed
     */
    searchAgents(query: string): Promise<ListAgentsResponse>;
    /**
     * Admin API for agent management
     * These methods require AdminApp to be initialized
     * Note: createAgent is now available directly on agents (not agents.admin)
     */
    admin: {
        /**
         * Prepare a create agent transaction for client-side signing
         * Returns transaction data that can be signed and submitted by the client
         */
        prepareCreateAgentTransaction: (params: {
            agentName: string;
            agentAccount: `0x${string}`;
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
        }) => Promise<{
            requiresClientSigning: true;
            transaction: {
                to: `0x${string}`;
                data: `0x${string}`;
                value: string;
                gas?: string;
                gasPrice?: string;
                maxFeePerGas?: string;
                maxPriorityFeePerGas?: string;
                nonce?: number;
                chainId: number;
            };
            tokenURI: string;
            metadata: Array<{
                key: string;
                value: string;
            }>;
        }>;
        /**
         * Update an agent's token URI
         * @param agentId - The agent ID to update
         * @param tokenURI - New token URI
         * @returns Transaction hash
         */
        updateAgent: (params: {
            agentId: bigint | string;
            tokenURI?: string;
            metadata?: Array<{
                key: string;
                value: string;
            }>;
        }) => Promise<{
            txHash: string;
        }>;
        /**
         * Delete an agent by transferring it to the zero address (burn)
         * Note: This requires the contract to support transfers to address(0)
         * @param agentId - The agent ID to delete
         * @returns Transaction hash
         */
        deleteAgent: (params: {
            agentId: bigint | string;
        }) => Promise<{
            txHash: string;
        }>;
        /**
         * Transfer an agent to a new owner
         * @param agentId - The agent ID to transfer
         * @param to - The new owner address
         * @returns Transaction hash
         */
        transferAgent: (params: {
            agentId: bigint | string;
            to: `0x${string}`;
        }) => Promise<{
            txHash: string;
        }>;
    };
}
//# sourceMappingURL=agents.d.ts.map