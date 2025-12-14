/**
 * AI Agent Discovery Client
 *
 * Fronts for discovery-index GraphQL requests to the indexer
 * Provides a clean interface for querying agent data
 */
import { GraphQLClient } from 'graphql-request';
/**
 * Agent data interface (raw data from GraphQL)
 */
export interface AgentData {
    agentId?: number | string;
    agentName?: string;
    chainId?: number;
    agentAccount?: string;
    agentOwner?: string;
    eoaOwner?: string | null;
    agentCategory?: string | null;
    didIdentity?: string | null;
    didAccount?: string | null;
    didName?: string | null;
    tokenUri?: string;
    createdAtBlock?: number;
    createdAtTime?: string | number;
    updatedAtTime?: string | number;
    type?: string | null;
    description?: string | null;
    image?: string | null;
    a2aEndpoint?: string | null;
    ensEndpoint?: string | null;
    agentAccountEndpoint?: string | null;
    did?: string | null;
    mcp?: boolean | null;
    x402support?: boolean | null;
    active?: boolean | null;
    supportedTrust?: string | null;
    rawJson?: string | null;
    feedbackCount?: number | null;
    feedbackAverageScore?: number | null;
    validationPendingCount?: number | null;
    validationCompletedCount?: number | null;
    validationRequestedCount?: number | null;
    [key: string]: unknown;
}
export interface SemanticAgentMetadataEntry {
    key: string;
    valueText?: string | null;
}
export interface SemanticAgentMatch {
    score?: number | null;
    matchReasons?: string[] | null;
    agent: AgentData & {
        metadata?: SemanticAgentMetadataEntry[] | null;
    };
}
export interface SemanticAgentSearchResult {
    total: number;
    matches: SemanticAgentMatch[];
}
/**
 * Discovery query response types
 */
export interface ListAgentsResponse {
    agents: AgentData[];
}
export interface GetAgentResponse {
    agent: AgentData;
}
export interface GetAgentByNameResponse {
    agentByName: AgentData | null;
}
export interface SearchAgentsResponse {
    agents: AgentData[];
}
export interface SearchAgentsAdvancedOptions {
    query?: string;
    params?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: 'ASC' | 'DESC';
}
export interface ValidationResponseData {
    id?: string;
    agentId?: string | number;
    validatorAddress?: string;
    requestHash?: string;
    response?: number;
    responseUri?: string;
    responseJson?: string;
    responseHash?: string;
    tag?: string;
    txHash?: string;
    blockNumber?: number;
    timestamp?: string | number;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
}
export interface ValidationRequestData {
    id?: string;
    agentId?: string | number;
    validatorAddress?: string;
    requestUri?: string;
    requestJson?: string;
    requestHash?: string;
    txHash?: string;
    blockNumber?: number;
    timestamp?: string | number;
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
}
export interface SearchValidationRequestsAdvancedOptions {
    chainId: number;
    agentId: string | number;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: 'ASC' | 'DESC';
}
export interface FeedbackData {
    id?: string;
    agentId?: string | number;
    clientAddress?: string;
    score?: number;
    feedbackUri?: string;
    feedbackJson?: string;
    comment?: string;
    ratingPct?: number;
    txHash?: string;
    blockNumber?: number;
    timestamp?: string | number;
    isRevoked?: boolean;
    responseCount?: number;
    [key: string]: unknown;
}
export interface SearchFeedbackAdvancedOptions {
    chainId: number;
    agentId: string | number;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: 'ASC' | 'DESC';
}
export interface RefreshAgentResponse {
    indexAgent: {
        success: boolean;
        message: string;
        processedChains: number[];
    };
}
/**
 * Configuration for AIAgentDiscoveryClient
 */
export interface AIAgentDiscoveryClientConfig {
    /**
     * GraphQL endpoint URL
     */
    endpoint: string;
    /**
     * Optional API key for authentication
     */
    apiKey?: string;
    /**
     * Request timeout in milliseconds
     */
    timeout?: number;
    /**
     * Additional headers to include in requests
     */
    headers?: Record<string, string>;
}
/**
 * AI Agent Discovery Client
 *
 * Provides methods for querying agent data from the indexer
 */
export declare class AIAgentDiscoveryClient {
    private client;
    private config;
    private searchStrategy?;
    private searchStrategyPromise?;
    private typeFieldsCache;
    constructor(config: AIAgentDiscoveryClientConfig);
    private normalizeAgent;
    /**
     * List agents with a deterministic default ordering (agentId DESC).
     *
     * @param limit - Maximum number of agents to return per page
     * @param offset - Number of agents to skip
     * @returns List of agents
     */
    listAgents(limit?: number, offset?: number): Promise<AgentData[]>;
    /**
     * Run a semantic search over agents using the discovery indexer's
     * `semanticAgentSearch` GraphQL field.
     *
     * NOTE: This API is best-effort. If the backend does not expose
     * `semanticAgentSearch`, this will return an empty result instead of
     * throwing, so callers can fall back gracefully.
     */
    semanticAgentSearch(params: {
        text: string;
    }): Promise<SemanticAgentSearchResult>;
    searchAgentsAdvanced(options: SearchAgentsAdvancedOptions): Promise<{
        agents: AgentData[];
        total?: number | null;
    } | null>;
    /**
     * Search agents using the strongly-typed AgentWhereInput / searchAgentsGraph API.
     * This is tailored to the indexer schema that exposes AgentWhereInput and
     * searchAgentsGraph(where:, first:, skip:, orderBy:, orderDirection:).
     */
    searchAgentsGraph(options: {
        where?: Record<string, unknown>;
        first?: number;
        skip?: number;
        orderBy?: 'agentId' | 'agentName' | 'createdAtTime' | 'createdAtBlock' | 'agentOwner' | 'eoaOwner';
        orderDirection?: 'ASC' | 'DESC';
    }): Promise<{
        agents: AgentData[];
        total: number;
        hasMore: boolean;
    }>;
    private detectSearchStrategy;
    private buildStrategyFromField;
    private getTypeFields;
    /**
     * Get all token metadata from The Graph indexer for an agent
     * Uses tokenMetadata_collection query to get all metadata key-value pairs
     * Handles pagination if an agent has more than 1000 metadata entries
     * @param chainId - Chain ID
     * @param agentId - Agent ID
     * @returns Record of all metadata key-value pairs, or null if not available
     */
    getTokenMetadata(chainId: number, agentId: number | string): Promise<Record<string, string> | null>;
    /**
     * Get a single agent by ID with metadata
     * @param chainId - Chain ID (required by schema)
     * @param agentId - Agent ID to fetch
     * @returns Agent data with metadata or null if not found
     */
    getAgent(chainId: number, agentId: number | string): Promise<AgentData | null>;
    getAgentByName(agentName: string): Promise<AgentData | null>;
    /**
     * Search agents by name
     * @param searchTerm - Search term to match against agent names
     * @param limit - Maximum number of results
     * @returns List of matching agents
     */
    searchAgents(searchTerm: string, limit?: number): Promise<AgentData[]>;
    /**
     * Refresh/Index an agent in the indexer
     * Triggers the indexer to re-index the specified agent
     * @param agentId - Agent ID to refresh (required)
     * @param chainId - Optional chain ID (if not provided, indexer may use default)
     * @param apiKey - Optional API key override (uses config API key if not provided)
     * @returns Refresh result with success status and processed chains
     */
    refreshAgent(agentId: string | number, chainId?: number, apiKey?: string): Promise<RefreshAgentResponse['indexAgent']>;
    /**
     * Search validation requests for an agent using GraphQL
     */
    searchValidationRequestsAdvanced(options: SearchValidationRequestsAdvancedOptions): Promise<{
        validationRequests: ValidationRequestData[];
    } | null>;
    /**
     * Search feedback for an agent using GraphQL
     */
    searchFeedbackAdvanced(options: SearchFeedbackAdvancedOptions): Promise<{
        feedbacks: FeedbackData[];
    } | null>;
    /**
     * Execute a raw GraphQL query
     * @param query - GraphQL query string
     * @param variables - Query variables
     * @returns Query response
     */
    request<T = any>(query: string, variables?: Record<string, any>): Promise<T>;
    /**
     * Execute a raw GraphQL mutation
     * @param mutation - GraphQL mutation string
     * @param variables - Mutation variables
     * @returns Mutation response
     */
    mutate<T = any>(mutation: string, variables?: Record<string, any>): Promise<T>;
    /**
     * Get the underlying GraphQLClient instance
     * @returns The GraphQLClient instance
     */
    getClient(): GraphQLClient;
    /**
     * Get agents owned by a specific EOA address
     * @param eoaAddress - The EOA (Externally Owned Account) address to search for
     * @param options - Optional search options (limit, offset, orderBy, orderDirection)
     * @returns List of agents owned by the EOA address
     */
    getOwnedAgents(eoaAddress: string, options?: {
        limit?: number;
        offset?: number;
        orderBy?: 'agentId' | 'agentName' | 'createdAtTime' | 'createdAtBlock' | 'agentOwner' | 'eoaOwner';
        orderDirection?: 'ASC' | 'DESC';
    }): Promise<AgentData[]>;
}
//# sourceMappingURL=AIAgentDiscoveryClient.d.ts.map