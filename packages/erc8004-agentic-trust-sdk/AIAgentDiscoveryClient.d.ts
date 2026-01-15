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
    agentIdentityOwnerAccount?: string;
    eoaAgentIdentityOwnerAccount?: string | null;
    eoaAgentAccount?: string | null;
    agentCategory?: string | null;
    didIdentity?: string | null;
    didAccount?: string | null;
    didName?: string | null;
    agentUri?: string | null;
    createdAtBlock?: number;
    createdAtTime?: string | number;
    updatedAtTime?: string | number;
    type?: string | null;
    description?: string | null;
    image?: string | null;
    a2aEndpoint?: string | null;
    did?: string | null;
    mcp?: boolean | null;
    x402support?: boolean | null;
    active?: boolean | null;
    supportedTrust?: string | null;
    rawJson?: string | null;
    agentCardJson?: string | null;
    agentCardReadAt?: number | null;
    feedbackCount?: number | null;
    feedbackAverageScore?: number | null;
    validationPendingCount?: number | null;
    validationCompletedCount?: number | null;
    validationRequestedCount?: number | null;
    initiatedAssociationCount?: number | null;
    approvedAssociationCount?: number | null;
    atiOverallScore?: number | null;
    atiOverallConfidence?: number | null;
    atiVersion?: string | null;
    atiComputedAt?: number | null;
    atiBundleJson?: string | null;
    trustLedgerScore?: number | null;
    trustLedgerBadgeCount?: number | null;
    trustLedgerOverallRank?: number | null;
    trustLedgerCapabilityRank?: number | null;
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
 * OASF taxonomy types (served by discovery GraphQL when enabled)
 */
export interface OasfSkill {
    key: string;
    nameKey?: string | null;
    uid?: number | null;
    caption?: string | null;
    extendsKey?: string | null;
    category?: string | null;
}
export interface OasfDomain {
    key: string;
    nameKey?: string | null;
    uid?: number | null;
    caption?: string | null;
    extendsKey?: string | null;
    category?: string | null;
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
    searchAgents: AgentData[];
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
    private tokenMetadataCollectionSupported?;
    private agentMetadataValueField?;
    private queryFieldsCache?;
    private queryFieldsPromise?;
    constructor(config: AIAgentDiscoveryClientConfig);
    private getQueryFields;
    private supportsQueryField;
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
        text?: string;
        intentJson?: string;
        topK?: number;
    }): Promise<SemanticAgentSearchResult>;
    /**
     * Fetch OASF skills taxonomy from the discovery GraphQL endpoint (best-effort).
     * Returns [] if the backend does not expose `oasfSkills`.
     */
    oasfSkills(params?: {
        key?: string;
        nameKey?: string;
        category?: string;
        extendsKey?: string;
        limit?: number;
        offset?: number;
        orderBy?: string;
        orderDirection?: string;
    }): Promise<OasfSkill[]>;
    /**
     * Fetch OASF domains taxonomy from the discovery GraphQL endpoint (best-effort).
     * Returns [] if the backend does not expose `oasfDomains`.
     */
    oasfDomains(params?: {
        key?: string;
        nameKey?: string;
        category?: string;
        extendsKey?: string;
        limit?: number;
        offset?: number;
        orderBy?: string;
        orderDirection?: string;
    }): Promise<OasfDomain[]>;
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
        orderBy?: 'agentId' | 'agentName' | 'createdAtTime' | 'createdAtBlock' | 'agentIdentityOwnerAccount' | 'eoaAgentIdentityOwnerAccount' | 'eoaAgentAccount' | 'agentCategory' | 'trustLedgerScore' | 'trustLedgerBadgeCount' | 'trustLedgerOverallRank' | 'trustLedgerCapabilityRank';
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
     * Some indexers expose `metadata { key valueText }`, others expose `metadata { key value }`.
     * Introspect once and cache so we can query metadata reliably.
     */
    private getAgentMetadataValueField;
    /**
     * Get all token metadata from The Graph indexer for an agent
     * Uses agentMetadata_collection query to get all metadata key-value pairs
     * Handles pagination if an agent has more than 1000 metadata entries
     * @param chainId - Chain ID
     * @param agentId - Agent ID
     * @returns Record of all metadata key-value pairs, or null if not available
     */
    /**
     * @deprecated Use getAllAgentMetadata instead. This method name is misleading.
     */
    getTokenMetadata(chainId: number, agentId: number | string): Promise<Record<string, string> | null>;
    /**
     * Get all agent metadata entries from the discovery GraphQL backend.
     * Uses agentMetadata_collection (The Graph subgraph) or agentMetadata (custom schema) query.
     * Tries subgraph format first, falls back to custom schema.
     * Handles pagination if an agent has more than 1000 metadata entries.
     */
    getAllAgentMetadata(chainId: number, agentId: number | string): Promise<Record<string, string> | null>;
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
        orderBy?: 'agentId' | 'agentName' | 'createdAtTime' | 'createdAtBlock' | 'agentIdentityOwnerAccount' | 'eoaAgentIdentityOwnerAccount' | 'eoaAgentAccount' | 'agentCategory' | 'trustLedgerScore' | 'trustLedgerBadgeCount' | 'trustLedgerOverallRank' | 'trustLedgerCapabilityRank';
        orderDirection?: 'ASC' | 'DESC';
    }): Promise<AgentData[]>;
}
//# sourceMappingURL=AIAgentDiscoveryClient.d.ts.map