/**
 * Agent class
 *
 * Represents a discovered agent with protocol support (A2A, MCP, etc.)
 * Abstracts protocol details so clients can interact with agents without
 * knowing the underlying protocol implementation.
 */
import type { AgenticTrustClient } from '../singletons/agenticTrustClient';
import type { AgentCard, AgentSkill, AgentCapabilities } from './agentCard';
import type { AgentData as DiscoveryAgentData, GiveFeedbackParams } from '@erc8004/agentic-trust-sdk';
export type { AgentCard, AgentSkill, AgentCapabilities } from './agentCard';
export interface MessageRequest {
    message?: string;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    skillId?: string;
}
export interface MessageResponse {
    success: boolean;
    messageId?: string;
    response?: Record<string, unknown>;
    error?: string;
}
/**
 * Agent data from discovery (GraphQL)
 */
export type AgentData = DiscoveryAgentData;
/**
 * Agent class - represents a discovered agent with protocol support
 */
export declare class Agent {
    readonly data: AgentData;
    private readonly client;
    private a2aProvider;
    private agentCard;
    private endpoint;
    private initialized;
    constructor(data: AgentData, client: AgenticTrustClient);
    /**
     * Get agent ID
     */
    get agentId(): number | undefined;
    /**
     * Get agent name
     */
    get agentName(): string | undefined;
    /**
     * Get A2A endpoint URL
     */
    get a2aEndpoint(): string | undefined;
    private initialize;
    isInitialized(): boolean;
    fetchCard(): Promise<AgentCard | null>;
    getCard(): AgentCard | null;
    getSkills(): Promise<AgentSkill[]>;
    getCapabilities(): Promise<AgentCapabilities | null>;
    supportsProtocol(): Promise<boolean>;
    getEndpoint(): Promise<{
        providerId: string;
        endpoint: string;
        method?: string;
    } | null>;
    /**
     * Send a message to the agent
     */
    sendMessage(request: MessageRequest): Promise<MessageResponse>;
    /**
     * Verify the agent by sending an authentication challenge
     * Creates a signed challenge and sends it to the agent's endpoint
     * This will force a fresh authentication challenge even if already authenticated
     * @returns true if verification passed, false otherwise
     */
    verify(): Promise<boolean>;
    /**
     * Feedback API
     */
    feedback: {
        requestAuth: (params: {
            clientAddress: `0x${string}`;
            agentId?: bigint | string;
            skillId?: string;
            expirySeconds?: number;
        }) => Promise<{
            feedbackAuth: `0x${string}`;
            agentId: string;
            clientAddress: `0x${string}`;
            skill: string;
        }>;
        /**
         * Submit client feedback to the reputation contract
         * @param params - Feedback parameters including score, feedback, feedbackAuth, etc.
         * @returns Transaction result with txHash
         * @throws Error if reputation client is not initialized
         */
        giveFeedback: (params: Omit<GiveFeedbackParams, "agent" | "agentId"> & {
            agentId?: string;
            clientAddress?: `0x${string}`;
        }) => Promise<{
            txHash: string;
        }>;
    };
}
//# sourceMappingURL=agent.d.ts.map