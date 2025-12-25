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
  a2aEndpoint?: string | null; // URL to agent.json
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
  [key: string]: unknown; // Allow for additional fields that may exist
}

export interface SemanticAgentMetadataEntry {
  key: string;
  valueText?: string | null;
}

export interface SemanticAgentMatch {
  score?: number | null;
  matchReasons?: string[] | null;
  agent: AgentData & { metadata?: SemanticAgentMetadataEntry[] | null };
}

export interface SemanticAgentSearchResult {
  total: number;
  matches: SemanticAgentMatch[];
}

type GraphQLTypeRef = {
  kind: string;
  name?: string | null;
  ofType?: GraphQLTypeRef | null;
};

type GraphQLArg = {
  name: string;
  type: GraphQLTypeRef;
};

type GraphQLField = {
  name: string;
  args: GraphQLArg[];
  type: GraphQLTypeRef;
};

type TypeField = {
  name: string;
  type: GraphQLTypeRef;
};

type IntrospectionQueryResult = {
  __schema?: {
    queryType?: {
      fields?: GraphQLField[];
    };
  };
};

type TypeIntrospectionResult = {
  __type?: {
    fields?: TypeField[];
  };
};

type ArgConfig = {
  name: string;
  typeName: string | null;
  isNonNull: boolean;
};

type ConnectionStrategy = {
  kind: 'connection';
  fieldName: string;
  listFieldName: string;
  totalFieldName?: string;
  queryArg?: ArgConfig;
  filterArg?: ArgConfig;
  limitArg?: ArgConfig;
  offsetArg?: ArgConfig;
  orderByArg?: ArgConfig;
  orderDirectionArg?: ArgConfig;
};

type ListStrategy = {
  kind: 'list';
  fieldName: string;
  queryArg?: ArgConfig;
  limitArg?: ArgConfig;
  offsetArg?: ArgConfig;
  orderByArg?: ArgConfig;
  orderDirectionArg?: ArgConfig;
};

type SearchStrategy = ConnectionStrategy | ListStrategy;

const INTROSPECTION_QUERY = `
  query SearchCapabilities {
    __schema {
      queryType {
        fields {
          name
          args {
            name
            type {
              ...TypeRef
            }
          }
          type {
            ...TypeRef
          }
        }
      }
    }
  }
  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
`;

const TYPE_FIELDS_QUERY = `
  query TypeFields($name: String!) {
    __type(name: $name) {
      fields {
        name
        type {
          ...TypeRef
        }
      }
    }
  }
  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
`;

function unwrapType(type: GraphQLTypeRef | null | undefined): GraphQLTypeRef | null {
  let current: GraphQLTypeRef | null | undefined = type;
  while (current && (current.kind === 'NON_NULL' || current.kind === 'LIST')) {
    current = current.ofType ?? null;
  }
  return current ?? null;
}

function unwrapToTypeName(type: GraphQLTypeRef | null | undefined): string | null {
  const named = unwrapType(type);
  return named?.name ?? null;
}

function isNonNull(type: GraphQLTypeRef | null | undefined): boolean {
  return type?.kind === 'NON_NULL';
}

function isListOf(type: GraphQLTypeRef, expectedName: string): boolean {
  if (!type) return false;
  if (type.kind === 'NON_NULL') return isListOf(type.ofType as GraphQLTypeRef, expectedName);
  if (type.kind === 'LIST') {
    const inner = type.ofType || null;
    if (!inner) return false;
    if (inner.kind === 'NON_NULL') {
      return isListOf(inner.ofType as GraphQLTypeRef, expectedName);
    }
    return inner.kind === 'OBJECT' && inner.name === expectedName;
  }
  return false;
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
export class AIAgentDiscoveryClient {
  private client: GraphQLClient;
  private config: AIAgentDiscoveryClientConfig;
  private searchStrategy?: SearchStrategy | null;
  private searchStrategyPromise?: Promise<SearchStrategy | null>;
  private typeFieldsCache = new Map<string, TypeField[] | null>();
  private tokenMetadataCollectionSupported?: boolean;
  private agentMetadataValueField?: 'valueText' | 'value' | null;

  constructor(config: AIAgentDiscoveryClientConfig) {
    this.config = config;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.headers || {}),
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
      // Also support API key in header
      headers['X-API-Key'] = config.apiKey;
    }

    this.client = new GraphQLClient(config.endpoint, {
      headers,
    });
  }

  private normalizeAgent(agent: AgentData | Record<string, unknown> | null | undefined): AgentData {
    const record = (agent ?? {}) as Record<string, unknown>;

    const toOptionalString = (value: unknown): string | undefined => {
      if (value === undefined || value === null) {
        return undefined;
      }
      return String(value);
    };

    const toOptionalStringOrNull = (value: unknown): string | null | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      return String(value);
    };

    const toOptionalNumber = (value: unknown): number | undefined => {
      if (value === undefined || value === null) {
        return undefined;
      }
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numeric) ? numeric : undefined;
    };

    const toOptionalNumberOrNull = (value: unknown): number | null | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };

    // Parse rawJson to extract all metadata fields
    let parsedMetadata: Record<string, unknown> = {};
    if (record.rawJson && typeof record.rawJson === 'string') {
      try {
        const parsed = JSON.parse(record.rawJson);
        if (parsed && typeof parsed === 'object') {
          // Extract all fields from the registration JSON
          parsedMetadata = parsed as Record<string, unknown>;
        }
      } catch (error) {
        // Silently ignore JSON parse errors
      }
    }

    const normalized: AgentData = {
      ...(record as AgentData),
      // Merge all metadata from parsed rawJson
      ...parsedMetadata,
    };

    const agentAccount = toOptionalString(record.agentAccount);
    if (agentAccount !== undefined) {
      normalized.agentAccount = agentAccount;
    }

    const agentOwner = toOptionalString(record.agentOwner);
    if (agentOwner !== undefined) {
      normalized.agentOwner = agentOwner;
    }

    const eoaOwner = toOptionalStringOrNull(record.eoaOwner);
    if (eoaOwner !== undefined) {
      normalized.eoaOwner = eoaOwner;
    }

    const agentCategory = toOptionalStringOrNull(record.agentCategory);
    if (agentCategory !== undefined) {
      normalized.agentCategory = agentCategory;
    }

    const didIdentity = toOptionalStringOrNull(record.didIdentity);
    if (didIdentity !== undefined) {
      normalized.didIdentity = didIdentity;
    }

    const didAccount = toOptionalStringOrNull(record.didAccount);
    if (didAccount !== undefined) {
      normalized.didAccount = didAccount;
    }

    const didName = toOptionalStringOrNull(record.didName);
    if (didName !== undefined) {
      normalized.didName = didName;
    }

    const tokenUri = toOptionalString(record.tokenUri);
    if (tokenUri !== undefined) {
      normalized.tokenUri = tokenUri;
    }

    const validationPendingCount = toOptionalNumberOrNull(record.validationPendingCount);
    if (validationPendingCount !== undefined) {
      normalized.validationPendingCount = validationPendingCount;
    }

    const validationCompletedCount = toOptionalNumberOrNull(record.validationCompletedCount);
    if (validationCompletedCount !== undefined) {
      normalized.validationCompletedCount = validationCompletedCount;
    }

    const validationRequestedCount = toOptionalNumberOrNull(record.validationRequestedCount);
    if (validationRequestedCount !== undefined) {
      normalized.validationRequestedCount = validationRequestedCount;
    }

    const initiatedAssociationCount = toOptionalNumberOrNull(record.initiatedAssociationCount);
    if (initiatedAssociationCount !== undefined) {
      normalized.initiatedAssociationCount = initiatedAssociationCount;
    }

    const approvedAssociationCount = toOptionalNumberOrNull(record.approvedAssociationCount);
    if (approvedAssociationCount !== undefined) {
      normalized.approvedAssociationCount = approvedAssociationCount;
    }

    const atiOverallScore = toOptionalNumberOrNull(record.atiOverallScore);
    if (atiOverallScore !== undefined) {
      normalized.atiOverallScore = atiOverallScore;
    }

    const atiOverallConfidence = toOptionalNumberOrNull(record.atiOverallConfidence);
    if (atiOverallConfidence !== undefined) {
      normalized.atiOverallConfidence = atiOverallConfidence;
    }

    const atiVersion = toOptionalStringOrNull(record.atiVersion);
    if (atiVersion !== undefined) {
      normalized.atiVersion = atiVersion;
    }

    const atiComputedAt = toOptionalNumberOrNull(record.atiComputedAt);
    if (atiComputedAt !== undefined) {
      normalized.atiComputedAt = atiComputedAt;
    }

    const atiBundleJson = toOptionalStringOrNull(record.atiBundleJson);
    if (atiBundleJson !== undefined) {
      normalized.atiBundleJson = atiBundleJson;
    }

    const trustLedgerScore = toOptionalNumberOrNull(record.trustLedgerScore);
    if (trustLedgerScore !== undefined) {
      normalized.trustLedgerScore = trustLedgerScore;
    }

    const trustLedgerBadgeCount = toOptionalNumberOrNull(record.trustLedgerBadgeCount);
    if (trustLedgerBadgeCount !== undefined) {
      normalized.trustLedgerBadgeCount = trustLedgerBadgeCount;
    }

    const trustLedgerOverallRank = toOptionalNumberOrNull(record.trustLedgerOverallRank);
    if (trustLedgerOverallRank !== undefined) {
      normalized.trustLedgerOverallRank = trustLedgerOverallRank;
    }

    const trustLedgerCapabilityRank = toOptionalNumberOrNull(record.trustLedgerCapabilityRank);
    if (trustLedgerCapabilityRank !== undefined) {
      normalized.trustLedgerCapabilityRank = trustLedgerCapabilityRank;
    }

    const description = toOptionalStringOrNull(record.description);
    if (description !== undefined) {
      normalized.description = description;
    }

    const image = toOptionalStringOrNull(record.image);
    if (image !== undefined) {
      normalized.image = image;
    }

    const a2aEndpoint = toOptionalStringOrNull(record.a2aEndpoint);
    if (a2aEndpoint !== undefined) {
      normalized.a2aEndpoint = a2aEndpoint;
    }

    const ensEndpoint = toOptionalStringOrNull(record.ensEndpoint);
    if (ensEndpoint !== undefined) {
      normalized.ensEndpoint = ensEndpoint;
    }

    const agentAccountEndpoint = toOptionalStringOrNull(record.agentAccountEndpoint);
    if (agentAccountEndpoint !== undefined) {
      normalized.agentAccountEndpoint = agentAccountEndpoint;
    }

    const supportedTrust = toOptionalString(record.supportedTrust);
    if (supportedTrust !== undefined) {
      normalized.supportedTrust = supportedTrust;
    }

    const did = toOptionalStringOrNull(record.did);
    if (did !== undefined) {
      normalized.did = did;
    }

    // Handle agentName: prefer non-empty values from multiple sources
    // Priority: 1) direct agentName field, 2) name from parsedMetadata, 3) agentName from parsedMetadata
    let agentName: string | undefined = undefined;
    
    // Check direct agentName field (must be non-empty after trim)
    const rawAgentName = record.agentName;
    const directAgentName = typeof rawAgentName === 'string' && rawAgentName.trim().length > 0
      ? rawAgentName.trim()
      : undefined;

    if (directAgentName) {
      agentName = directAgentName;
    } else {
      // Check parsedMetadata for name or agentName
      const metadataName = typeof parsedMetadata.name === 'string' && parsedMetadata.name.trim().length > 0
        ? parsedMetadata.name.trim()
        : undefined;
      const metadataAgentName = typeof parsedMetadata.agentName === 'string' && parsedMetadata.agentName.trim().length > 0
        ? parsedMetadata.agentName.trim()
        : undefined;
      
      agentName = metadataAgentName || metadataName;
      if (agentName) {
        console.log('[AIAgentDiscoveryClient.normalizeAgent] Using metadata name:', {
          fromMetadataAgentName: !!metadataAgentName,
          fromMetadataName: !!metadataName,
          agentName,
        });
      } else {
        console.log('[AIAgentDiscoveryClient.normalizeAgent] No valid agentName found in direct field or metadata');
      }
    }
    
    // Set agentName: use found value, or undefined if original was empty and no replacement found
    // This ensures empty strings are converted to undefined
    if (agentName && agentName.length > 0) {
      normalized.agentName = agentName;
    } else if (typeof rawAgentName === 'string' && rawAgentName.trim().length === 0) {
      // Original was empty string, and we didn't find a replacement - set to undefined
      normalized.agentName = undefined;
      console.log('[AIAgentDiscoveryClient.normalizeAgent] Original was empty string, set to undefined');
    } else {
      console.log('[AIAgentDiscoveryClient.normalizeAgent] Leaving agentName as-is:', normalized.agentName);
    }
    // If rawAgentName was undefined/null, leave it as-is (don't overwrite)

    return normalized;
  }

  /**
   * List agents with a deterministic default ordering (agentId DESC).
   *
   * @param limit - Maximum number of agents to return per page
   * @param offset - Number of agents to skip
   * @returns List of agents
   */
  async listAgents(limit?: number, offset?: number): Promise<AgentData[]> {
    let allAgents: AgentData[] = [];
    const effectiveLimit = limit ?? 100;
    const effectiveOffset = offset ?? 0;

    const query = `
      query ListAgents($limit: Int, $offset: Int) {
        agents(limit: $limit, offset: $offset) {
          chainId
          agentId
          agentAccount
          agentOwner
          eoaOwner
          agentName
          agentCategory
          didIdentity
          didAccount
          didName
          tokenUri
          createdAtBlock
          createdAtTime
          updatedAtTime
          type
          description
          image
          a2aEndpoint
          ensEndpoint
          agentAccountEndpoint
          did
          mcp
          x402support
          active
          supportedTrust
          rawJson
        }
      }
    `;

    try {
      const data = await this.client.request<ListAgentsResponse>(query, {
        limit: effectiveLimit,
        offset: effectiveOffset,
      });
      const pageAgents = (data.agents || []).map((agent) => {
        const normalized = this.normalizeAgent(agent);
        console.log('[AIAgentDiscoveryClient.listAgents] Normalized agent:', {
          agentId: normalized.agentId,
          rawAgentName: agent.agentName,
          normalizedAgentName: normalized.agentName,
          agentNameType: typeof normalized.agentName,
          hasRawJson: !!normalized.rawJson,
        });
        return normalized;
      });
      allAgents = allAgents.concat(pageAgents);
      

      // Apply client-side ordering to ensure deterministic results,
      // since the base agents query may not support orderBy/orderDirection
      // arguments. Default is agentId DESC for "newest first".
      // Default to newest agents first by agentId DESC
      allAgents.sort((a, b) => {
        const idA =
          typeof a.agentId === 'number' ? a.agentId : Number(a.agentId ?? 0) || 0;
        const idB =
          typeof b.agentId === 'number' ? b.agentId : Number(b.agentId ?? 0) || 0;
        return idB - idA;
      });
    } catch (error) {
      console.warn('[AIAgentDiscoveryClient.listAgents] Error fetching agents with pagination:', error);
    }

    return allAgents;
  }

  /**
   * Run a semantic search over agents using the discovery indexer's
   * `semanticAgentSearch` GraphQL field.
   *
   * NOTE: This API is best-effort. If the backend does not expose
   * `semanticAgentSearch`, this will return an empty result instead of
   * throwing, so callers can fall back gracefully.
   */
  async semanticAgentSearch(params: {
    text?: string;
    intentJson?: string;
    topK?: number;
  }): Promise<SemanticAgentSearchResult> {
    const rawText = typeof params?.text === 'string' ? params.text : '';
    const text = rawText.trim();
    const rawIntentJson = typeof params?.intentJson === 'string' ? params.intentJson : '';
    const intentJson = rawIntentJson.trim();
    const topK =
      typeof params?.topK === 'number' && Number.isFinite(params.topK) && params.topK > 0
        ? Math.floor(params.topK)
        : undefined;

    // Nothing to search.
    if (!text && !intentJson) {
      return { total: 0, matches: [] };
    }

    const selection = `
      total
      matches {
        score
        matchReasons
        agent {
          chainId
          agentId
          agentAccount
          agentOwner
          eoaOwner
          agentName
          agentCategory
          didIdentity
          didAccount
          didName
          tokenUri
          createdAtBlock
          createdAtTime
          updatedAtTime
          type
          description
          image
          a2aEndpoint
          ensEndpoint
          agentAccountEndpoint
          supportedTrust
          rawJson
          did
          mcp
          x402support
          active
          feedbackCount
          feedbackAverageScore
          validationPendingCount
          validationCompletedCount
          validationRequestedCount
          initiatedAssociationCount
          approvedAssociationCount
          atiOverallScore
          atiOverallConfidence
          atiVersion
          atiComputedAt
          atiBundleJson
          trustLedgerScore
          trustLedgerBadgeCount
          trustLedgerOverallRank
          trustLedgerCapabilityRank
          metadata {
            key
            valueText
          }
        }
      }
    `;

    const query = intentJson
      ? `
        query SearchByIntent($intentJson: String!, $topK: Int) {
          semanticAgentSearch(input: { intentJson: $intentJson, topK: $topK }) {
            ${selection}
          }
        }
      `
      : `
        query SearchByText($text: String!) {
          semanticAgentSearch(input: { text: $text }) {
            ${selection}
          }
        }
      `;

    try {
      const data = await this.client.request<{
        semanticAgentSearch?: {
          total?: number | null;
          matches?: Array<{
            score?: number | null;
            matchReasons?: string[] | null;
            agent?: Record<string, unknown> | null;
          }> | null;
        };
      }>(
        query,
        intentJson ? { intentJson, topK } : { text },
      );

      const root = data.semanticAgentSearch;
      if (!root) {
        return { total: 0, matches: [] };
      }

      const total =
        typeof root.total === 'number' && Number.isFinite(root.total) && root.total >= 0
          ? root.total
          : Array.isArray(root.matches)
            ? root.matches.length
            : 0;

      const matches: SemanticAgentMatch[] = [];
      const rawMatches = Array.isArray(root.matches) ? root.matches : [];

      for (const item of rawMatches) {
        if (!item || !item.agent) {
          continue;
        }

        const normalizedAgent = this.normalizeAgent(item.agent as AgentData);

        // Extract metadata entries (if present) into a strongly-typed array.
        const metadataRaw = (item.agent as any).metadata;
        let metadata: SemanticAgentMetadataEntry[] | null = null;
        if (Array.isArray(metadataRaw)) {
          const entries: SemanticAgentMetadataEntry[] = [];
          for (const entry of metadataRaw) {
            if (!entry || typeof entry.key !== 'string') continue;
            entries.push({
              key: entry.key,
              valueText:
                entry.valueText === null || entry.valueText === undefined
                  ? null
                  : String(entry.valueText),
            });
          }
          if (entries.length > 0) {
            metadata = entries;
          }
        }

        if (metadata) {
          (normalizedAgent as any).metadata = metadata;
        }

        matches.push({
          score:
            typeof item.score === 'number' && Number.isFinite(item.score)
              ? item.score
              : null,
          matchReasons: Array.isArray(item.matchReasons)
            ? item.matchReasons.map((reason) => String(reason))
            : null,
          agent: normalizedAgent as AgentData & {
            metadata?: SemanticAgentMetadataEntry[] | null;
          },
        });
      }

      return {
        total,
        matches,
      };
    } catch (error) {
      console.warn(
        '[AIAgentDiscoveryClient.semanticAgentSearch] Error performing semantic search:',
        error,
      );
      return { total: 0, matches: [] };
    }
  }

  async searchAgentsAdvanced(
    options: SearchAgentsAdvancedOptions,
  ): Promise<{ agents: AgentData[]; total?: number | null } | null> {

    console.log('>>>>>>>>>>>>>>>>>> searchAgentsAdvanced', options);
    const strategy = await this.detectSearchStrategy();

    const { query, params, limit, offset } = options;
    const trimmedQuery = typeof query === 'string' ? query.trim() : '';
    const hasQuery = trimmedQuery.length > 0;
    const hasParams = params && Object.keys(params).length > 0;

    if (!hasQuery && !hasParams) {
      return null;
    }

    // If no detected strategy (introspection disabled), attempt a direct list-form searchAgents call.
    // Only use this fallback if we have a query string, since the GraphQL query requires a non-null query parameter.
    // If we only have params but no query, return null to trigger local filtering fallback.
    console.log('>>>>>>>>>>>>>>>>>> 012 strategy', strategy);
    if (!strategy) {
      console.log('>>>>>>>>>>>>>>>>>> 012 hasQuery', hasQuery);
      if (hasQuery) {
        try {
          console.log('>>>>>>>>>>>>>>>>>> 012 trimmedQuery', trimmedQuery);
          console.log('>>>>>>>>>>>>>>>>>> 012 limit', limit);
          console.log('>>>>>>>>>>>>>>>>>> 012 offset', offset);
          console.log('>>>>>>>>>>>>>>>>>> 012 options.orderBy', options.orderBy);
          console.log('>>>>>>>>>>>>>>>>>> 012 options.orderDirection', options.orderDirection);
          
          const queryText = `
            query SearchAgentsFallback($query: String!, $limit: Int, $offset: Int, $orderBy: String, $orderDirection: String) {
              searchAgents(query: $query, limit: $limit, offset: $offset, orderBy: $orderBy, orderDirection: $orderDirection) {
                chainId
                agentId
                agentAccount
                agentOwner
                eoaOwner
                agentName
                agentCategory
                didIdentity
                didAccount
                didName
                tokenUri
                createdAtBlock
                createdAtTime
                updatedAtTime
                type
                description
                image
                a2aEndpoint
                ensEndpoint
                agentAccountEndpoint
                did
                mcp
                x402support
                active
                supportedTrust
                rawJson
              }
            }
          `;
          const variables: Record<string, unknown> = {
            query: trimmedQuery,
            limit: typeof limit === 'number' ? limit : undefined,
            offset: typeof offset === 'number' ? offset : undefined,
            orderBy: options.orderBy,
            orderDirection: options.orderDirection,
          };
          const data = await this.client.request<Record<string, any>>(queryText, variables);
          const list = data?.searchAgents;

          console.log('>>>>>>>>>>>>>>>>>> 012 list.length', list?.length);
          if (list && list.length > 0) {
            console.log('>>>>>>>>>>>>>>>>>> 012 First raw agent sample:', JSON.stringify(list[0], null, 2));
          }

          if (Array.isArray(list)) {
            const normalizedList = list
              .filter(Boolean)
              .map((item) => {
                const rawAgent = item as AgentData;
                const normalized = this.normalizeAgent(rawAgent);
                console.log('[AIAgentDiscoveryClient.searchAgentsAdvanced] Normalized agent (fallback):', {
                  agentId: normalized.agentId,
                  rawAgentName: rawAgent.agentName,
                  normalizedAgentName: normalized.agentName,
                  agentNameType: typeof normalized.agentName,
                  hasRawJson: !!normalized.rawJson,
                });
                return normalized;
              });

            console.log('[AIAgentDiscoveryClient.searchAgentsAdvanced] Returning normalized agents (fallback):', {
              count: normalizedList.length,
              agentNames: normalizedList.map(a => ({
                agentId: a.agentId,
                agentName: a.agentName,
                agentNameType: typeof a.agentName,
              })),
            });

            // Ensure fallback respects the requested ordering, even if the
            // underlying searchAgents resolver uses its own default order.
            const orderBy = typeof options.orderBy === 'string' ? options.orderBy.trim() : undefined;
            const orderDirectionRaw =
              typeof options.orderDirection === 'string'
                ? options.orderDirection.toUpperCase()
                : 'DESC';
            const orderDirection = orderDirectionRaw === 'DESC' ? 'DESC' : 'ASC';

            if (orderBy === 'agentName') {
              normalizedList.sort((a, b) => {
                const aName = (a.agentName ?? '').toLowerCase();
                const bName = (b.agentName ?? '').toLowerCase();
                return orderDirection === 'ASC'
                  ? aName.localeCompare(bName)
                  : bName.localeCompare(aName);
              });
            } else if (orderBy === 'agentId') {
              normalizedList.sort((a, b) => {
                const idA =
                  typeof a.agentId === 'number'
                    ? a.agentId
                    : Number(a.agentId ?? 0) || 0;
                const idB =
                  typeof b.agentId === 'number'
                    ? b.agentId
                    : Number(b.agentId ?? 0) || 0;
                return orderDirection === 'ASC' ? idA - idB : idB - idA;
              });
            } else if (orderBy === 'createdAtTime') {
              normalizedList.sort((a, b) => {
                const tA =
                  typeof a.createdAtTime === 'number'
                    ? a.createdAtTime
                    : Number(a.createdAtTime ?? 0) || 0;
                const tB =
                  typeof b.createdAtTime === 'number'
                    ? b.createdAtTime
                    : Number(b.createdAtTime ?? 0) || 0;
                return orderDirection === 'ASC' ? tA - tB : tB - tA;
              });
            } else if (orderBy === 'createdAtBlock') {
              normalizedList.sort((a, b) => {
                const bA =
                  typeof a.createdAtBlock === 'number'
                    ? a.createdAtBlock
                    : Number(a.createdAtBlock ?? 0) || 0;
                const bB =
                  typeof b.createdAtBlock === 'number'
                    ? b.createdAtBlock
                    : Number(b.createdAtBlock ?? 0) || 0;
                return orderDirection === 'ASC' ? bA - bB : bB - bA;
              });
            } else if (orderBy === 'agentOwner') {
              normalizedList.sort((a, b) => {
                const aOwner = (a.agentOwner ?? '').toLowerCase();
                const bOwner = (b.agentOwner ?? '').toLowerCase();
                return orderDirection === 'ASC'
                  ? aOwner.localeCompare(bOwner)
                  : bOwner.localeCompare(aOwner);
              });
            }
            console.log('>>>>>>>>>>>>>>>>>> 345 AdvancedSearch', normalizedList);
            return { agents: normalizedList, total: undefined };
          }
        } catch (error) {
          console.warn('[AIAgentDiscoveryClient] Fallback searchAgents call failed:', error);
        }
      }
      // If no strategy and no query (only params), return null to trigger local filtering fallback
      return null;
    }

    const variables: Record<string, unknown> = {};
    const variableDefinitions: string[] = [];
    const argumentAssignments: string[] = [];

    const agentSelection = `
      chainId
      agentId
      agentAccount
      agentOwner
      eoaOwner
      agentName
      agentCategory
      didIdentity
      didAccount
      didName
      tokenUri
      createdAtBlock
      createdAtTime
      updatedAtTime
      type
      description
      image
      a2aEndpoint
      ensEndpoint
      agentAccountEndpoint
      did
      mcp
      x402support
      active
      supportedTrust
      rawJson
      feedbackCount
      feedbackAverageScore
      validationPendingCount
      validationCompletedCount
      validationRequestedCount
    `;

    const addStringArg = (arg: ArgConfig | undefined, value: string | undefined) => {
      if (!arg) return !value;
      if (!value) {
        return arg.isNonNull ? false : true;
      }
      const typeName = arg.typeName ?? 'String';
      variableDefinitions.push(`$${arg.name}: ${typeName}${arg.isNonNull ? '!' : ''}`);
      argumentAssignments.push(`${arg.name}: $${arg.name}`);
      variables[arg.name] = value;
      return true;
    };

    const addInputArg = (arg: ArgConfig | undefined, value: Record<string, unknown> | undefined) => {
      if (!arg) return !value;
      if (!value || Object.keys(value).length === 0) {
        return arg.isNonNull ? false : true;
      }
      const typeName = arg.typeName ?? 'JSON';
      variableDefinitions.push(`$${arg.name}: ${typeName}${arg.isNonNull ? '!' : ''}`);
      argumentAssignments.push(`${arg.name}: $${arg.name}`);
      variables[arg.name] = value;
      return true;
    };

    const addIntArg = (arg: ArgConfig | undefined, value: number | undefined) => {
      if (!arg) return;
      if (value === undefined || value === null) {
        if (arg.isNonNull) {
          return;
        }
        return;
      }
      const typeName = arg.typeName ?? 'Int';
      variableDefinitions.push(`$${arg.name}: ${typeName}${arg.isNonNull ? '!' : ''}`);
      argumentAssignments.push(`${arg.name}: $${arg.name}`);
      variables[arg.name] = value;
    };

    if (strategy.kind === 'connection') {
      // Add query arg only if we have a query, or if queryArg is optional
      // If queryArg is required (non-null) but we don't have a query, only proceed if we have params
      const queryArgAdded = addStringArg(strategy.queryArg, hasQuery ? trimmedQuery : undefined);
      if (!queryArgAdded && strategy.queryArg?.isNonNull && !hasParams) {
        // Required query arg but no query and no params - can't proceed
        return null;
      }

      // Add filter arg if we have params
      const filterArgAdded = addInputArg(strategy.filterArg, hasParams ? (params as Record<string, unknown>) : undefined);
      if (!filterArgAdded && strategy.filterArg?.isNonNull && !hasQuery) {
        // Required filter arg but no params and no query - can't proceed
        return null;
      }

      // If neither query nor params were added, and both are optional, we need at least one
      if (!queryArgAdded && !filterArgAdded && (!strategy.queryArg || !strategy.filterArg)) {
        return null;
      }

      addIntArg(strategy.limitArg, typeof limit === 'number' ? limit : undefined);
      addIntArg(strategy.offsetArg, typeof offset === 'number' ? offset : undefined);
      addStringArg(strategy.orderByArg, options.orderBy);
      addStringArg(strategy.orderDirectionArg, options.orderDirection);

      if (argumentAssignments.length === 0) {
        return null;
      }

      console.log('>>>>>>>>>>>>>>>>>> AdvancedSearch', variableDefinitions, argumentAssignments);
      const queryText = `
        query AdvancedSearch(${variableDefinitions.join(', ')}) {
          ${strategy.fieldName}(${argumentAssignments.join(', ')}) {
            ${strategy.totalFieldName ? `${strategy.totalFieldName}` : ''}
            ${strategy.listFieldName} {
              chainId
              agentId
              agentAccount
              agentOwner
              eoaOwner
              agentName
              agentCategory
              didIdentity
              didAccount
              didName
              tokenUri
              createdAtBlock
              createdAtTime
              updatedAtTime
              type
              description
              image
              a2aEndpoint
              ensEndpoint
              agentAccountEndpoint
              did
              mcp
              x402support
              active
              supportedTrust
              rawJson
            }
          }
        }
      `;

      try {
        const data = await this.client.request<Record<string, any>>(queryText, variables);
        const node = data?.[strategy.fieldName];
        if (!node) return null;
        const list = node?.[strategy.listFieldName];
        if (!Array.isArray(list)) return null;
        const totalValue =
          typeof strategy.totalFieldName === 'string' ? node?.[strategy.totalFieldName] : undefined;
        console.log('>>>>>>>>>>>>>>>>>> 123 AdvancedSearch', list);
          return {
          agents: list.filter(Boolean) as AgentData[],
          total: typeof totalValue === 'number' ? totalValue : undefined,
        };
      } catch (error) {
        console.warn('[AIAgentDiscoveryClient] Advanced connection search failed:', error);
        this.searchStrategy = null;
        return null;
      }
    }

    if (strategy.kind === 'list') {
      console.log('>>>>>>>>>>>>>>>>>> AdvancedSearchList', variableDefinitions, argumentAssignments);
      if (!addStringArg(strategy.queryArg, hasQuery ? trimmedQuery : undefined)) {
        return null;
      }
      addIntArg(strategy.limitArg, typeof limit === 'number' ? limit : undefined);
      addIntArg(strategy.offsetArg, typeof offset === 'number' ? offset : undefined);
      addStringArg(strategy.orderByArg, options.orderBy);
      addStringArg(strategy.orderDirectionArg, options.orderDirection);

      if (argumentAssignments.length === 0) {
        return null;
      }

      const queryText = `
        query AdvancedSearchList(${variableDefinitions.join(', ')}) {
          ${strategy.fieldName}(${argumentAssignments.join(', ')}) {
            ${agentSelection}
          }
        }
      `;

      try {
        const data = await this.client.request<Record<string, any>>(queryText, variables);
        const list = data?.[strategy.fieldName];
        if (!Array.isArray(list)) return null;
        
        const agents = list
          .filter(Boolean)
          .map((item) => {
            const rawAgent = item as AgentData;
            const normalized = this.normalizeAgent(rawAgent);
            console.log('[AIAgentDiscoveryClient.searchAgentsAdvanced] Normalized agent (strategy):', {
              agentId: normalized.agentId,
              rawAgentName: rawAgent.agentName,
              normalizedAgentName: normalized.agentName,
              agentNameType: typeof normalized.agentName,
              hasRawJson: !!normalized.rawJson,
            });
            return normalized;
          });
        
        console.log('[AIAgentDiscoveryClient.searchAgentsAdvanced] Returning normalized agents (strategy):', {
          count: agents.length,
          agentNames: agents.map(a => ({
            agentId: a.agentId,
            agentName: a.agentName,
            agentNameType: typeof a.agentName,
          })),
        });
        
        return {
          agents,
          total: undefined,
        };
      } catch (error) {
        console.warn('[AIAgentDiscoveryClient] Advanced list search failed:', error);
        this.searchStrategy = null;
        return null;
      }
    }

    return null;
  }

  /**
   * Search agents using the strongly-typed AgentWhereInput / searchAgentsGraph API.
   * This is tailored to the indexer schema that exposes AgentWhereInput and
   * searchAgentsGraph(where:, first:, skip:, orderBy:, orderDirection:).
   */
  async searchAgentsGraph(options: {
    where?: Record<string, unknown>;
    first?: number;
    skip?: number;
    orderBy?: 'agentId' | 'agentName' | 'createdAtTime' | 'createdAtBlock' | 'agentOwner' | 'eoaOwner';
    orderDirection?: 'ASC' | 'DESC';
  }): Promise<{ agents: AgentData[]; total: number; hasMore: boolean }> {
    const query = `
      query SearchAgentsGraph(
        $where: AgentWhereInput
        $first: Int
        $skip: Int
        $orderBy: AgentOrderBy
        $orderDirection: OrderDirection
      ) {
        searchAgentsGraph(
          where: $where
          first: $first
          skip: $skip
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          agents {
            chainId
            agentId
            agentAccount
            agentOwner
            eoaOwner
            agentName
            agentCategory
            didIdentity
            didAccount
            didName
            tokenUri
            createdAtBlock
            createdAtTime
            updatedAtTime
            type
            description
            image
            a2aEndpoint
            ensEndpoint
            agentAccountEndpoint
            supportedTrust
            rawJson
            did
            mcp
            x402support
            active
            feedbackCount
            feedbackAverageScore
            validationPendingCount
            validationCompletedCount
            validationRequestedCount
            initiatedAssociationCount
            approvedAssociationCount
            atiOverallScore
            atiOverallConfidence
            atiVersion
            atiComputedAt
            atiBundleJson
            trustLedgerScore
            trustLedgerBadgeCount
            trustLedgerOverallRank
            trustLedgerCapabilityRank
          }
          total
          hasMore
        }
      }
    `;

    // Default ordering when not explicitly provided: newest agents first
    // by agentId DESC.
    const effectiveOrderBy = options.orderBy ?? 'agentId';
    const effectiveOrderDirection: 'ASC' | 'DESC' =
      (options.orderDirection ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const variables: Record<string, unknown> = {
      where: options.where,
      first: typeof options.first === 'number' ? options.first : undefined,
      skip: typeof options.skip === 'number' ? options.skip : undefined,
      orderBy: effectiveOrderBy,
      orderDirection: effectiveOrderDirection,
    };

    const data = await this.client.request<{
      searchAgentsGraph?: {
        agents?: AgentData[];
        total?: number;
        hasMore?: boolean;
      };
    }>(query, variables);

    const result = data.searchAgentsGraph ?? { agents: [], total: 0, hasMore: false };
    const agents = (result.agents ?? []).map((agent) => {
      const rawAgent = agent as AgentData;
      const normalized = this.normalizeAgent(rawAgent);
      return normalized;
    });

    return {
      agents,
      total: typeof result.total === 'number' ? result.total : agents.length,
      hasMore: Boolean(result.hasMore),
    };
  }

  private async detectSearchStrategy(): Promise<SearchStrategy | null> {
    if (this.searchStrategy !== undefined) {
      return this.searchStrategy;
    }

    if (this.searchStrategyPromise) {
      return this.searchStrategyPromise;
    }

    this.searchStrategyPromise = (async () => {
      try {
      const data = await this.client.request<IntrospectionQueryResult>(INTROSPECTION_QUERY);
        const fields = data.__schema?.queryType?.fields ?? [];
        const candidateNames = ['searchAgentsAdvanced', 'searchAgents'];

        for (const candidate of candidateNames) {
          const field = fields.find((f) => f.name === candidate);
          if (!field) continue;
          const strategy = await this.buildStrategyFromField(field);
          if (strategy) {
            this.searchStrategy = strategy;
            return strategy;
          }
        }
      } catch (error) {
        console.warn('[AIAgentDiscoveryClient] Failed to introspect search capabilities:', error);
      } finally {
        this.searchStrategyPromise = undefined;
      }

      this.searchStrategy = null;
      return null;
    })();

    return this.searchStrategyPromise;
  }

  private async buildStrategyFromField(field: GraphQLField): Promise<SearchStrategy | null> {
    const baseReturn = unwrapType(field.type);
    if (!baseReturn) return null;

    const limitArg =
      field.args.find((arg) => arg.name === 'limit') ??
      field.args.find((arg) => arg.name === 'first');
    const offsetArg =
      field.args.find((arg) => arg.name === 'offset') ??
      field.args.find((arg) => arg.name === 'skip');

    const queryArg =
      field.args.find((arg) => arg.name === 'query') ??
      field.args.find((arg) => arg.name === 'term') ??
      field.args.find((arg) => arg.name === 'search');

    const filterArg =
      field.args.find((arg) => arg.name === 'params') ??
      field.args.find((arg) => arg.name === 'filters');
  const orderByArg = field.args.find((arg) => arg.name === 'orderBy');
  const orderDirectionArg = field.args.find((arg) => arg.name === 'orderDirection');

    if (baseReturn.kind === 'OBJECT' && baseReturn.name) {
      const connectionFields = await this.getTypeFields(baseReturn.name);
      if (!connectionFields) {
        return null;
      }

      const listField = connectionFields.find((f) => isListOf(f.type, 'Agent'));
      if (!listField) {
        return null;
      }

      const totalField =
        connectionFields.find((f) => f.name === 'total') ??
        connectionFields.find((f) => f.name === 'totalCount') ??
        connectionFields.find((f) => f.name === 'count');

      return {
        kind: 'connection',
        fieldName: field.name,
        listFieldName: listField.name,
        totalFieldName: totalField?.name,
        queryArg: queryArg
          ? {
              name: queryArg.name,
              typeName: unwrapToTypeName(queryArg.type),
              isNonNull: isNonNull(queryArg.type),
            }
          : undefined,
        filterArg: filterArg
          ? {
              name: filterArg.name,
              typeName: unwrapToTypeName(filterArg.type),
              isNonNull: isNonNull(filterArg.type),
            }
          : undefined,
        limitArg: limitArg
          ? {
              name: limitArg.name,
              typeName: unwrapToTypeName(limitArg.type),
              isNonNull: isNonNull(limitArg.type),
            }
          : undefined,
        offsetArg: offsetArg
          ? {
              name: offsetArg.name,
              typeName: unwrapToTypeName(offsetArg.type),
              isNonNull: isNonNull(offsetArg.type),
            }
          : undefined,
        orderByArg: orderByArg
          ? {
              name: orderByArg.name,
              typeName: unwrapToTypeName(orderByArg.type),
              isNonNull: isNonNull(orderByArg.type),
            }
          : undefined,
        orderDirectionArg: orderDirectionArg
          ? {
              name: orderDirectionArg.name,
              typeName: unwrapToTypeName(orderDirectionArg.type),
              isNonNull: isNonNull(orderDirectionArg.type),
            }
          : undefined,
      };
    }

    if (isListOf(field.type, 'Agent')) {
      return {
        kind: 'list',
        fieldName: field.name,
        queryArg: queryArg
          ? {
              name: queryArg.name,
              typeName: unwrapToTypeName(queryArg.type),
              isNonNull: isNonNull(queryArg.type),
            }
          : undefined,
        limitArg: limitArg
          ? {
              name: limitArg.name,
              typeName: unwrapToTypeName(limitArg.type),
              isNonNull: isNonNull(limitArg.type),
            }
          : undefined,
        offsetArg: offsetArg
          ? {
              name: offsetArg.name,
              typeName: unwrapToTypeName(offsetArg.type),
              isNonNull: isNonNull(offsetArg.type),
            }
        : undefined,
      orderByArg: orderByArg
        ? {
            name: orderByArg.name,
            typeName: unwrapToTypeName(orderByArg.type),
            isNonNull: isNonNull(orderByArg.type),
          }
        : undefined,
      orderDirectionArg: orderDirectionArg
        ? {
            name: orderDirectionArg.name,
            typeName: unwrapToTypeName(orderDirectionArg.type),
            isNonNull: isNonNull(orderDirectionArg.type),
          }
        : undefined,
      };
    }

    return null;
  }

  private async getTypeFields(typeName: string): Promise<TypeField[] | null> {
    if (this.typeFieldsCache.has(typeName)) {
      return this.typeFieldsCache.get(typeName) ?? null;
    }

    try {
      const data = await this.client.request<TypeIntrospectionResult>(TYPE_FIELDS_QUERY, { name: typeName });
      const fields = data.__type?.fields ?? null;
      this.typeFieldsCache.set(typeName, fields ?? null);
      return fields ?? null;
    } catch (error) {
      console.warn(`[AIAgentDiscoveryClient] Failed to introspect type fields for ${typeName}:`, error);
      this.typeFieldsCache.set(typeName, null);
      return null;
    }
  }

  /**
   * Some indexers expose `metadata { key valueText }`, others expose `metadata { key value }`.
   * Introspect once and cache so we can query metadata reliably.
   */
  private async getAgentMetadataValueField(): Promise<'valueText' | 'value' | null> {
    if (this.agentMetadataValueField !== undefined) {
      return this.agentMetadataValueField;
    }

    try {
      const agentFields = await this.getTypeFields('Agent');
      const metadataField = agentFields?.find((f) => f?.name === 'metadata');
      const metadataType = unwrapType(metadataField?.type);
      const metadataTypeName = metadataType?.name ?? null;
      if (!metadataTypeName) {
        this.agentMetadataValueField = null;
        return null;
      }

      const metadataFields = await this.getTypeFields(metadataTypeName);
      const fieldNames = new Set(
        (metadataFields ?? [])
          .map((f) => f?.name)
          .filter((name): name is string => typeof name === 'string' && name.length > 0),
      );

      if (fieldNames.has('valueText')) {
        this.agentMetadataValueField = 'valueText';
        return 'valueText';
      }
      if (fieldNames.has('value')) {
        this.agentMetadataValueField = 'value';
        return 'value';
      }

      this.agentMetadataValueField = null;
      return null;
    } catch {
      // If schema blocks introspection, fall back to historical `valueText`.
      this.agentMetadataValueField = 'valueText';
      return 'valueText';
    }
  }

  /**
   * Get all token metadata from The Graph indexer for an agent
   * Uses tokenMetadata_collection query to get all metadata key-value pairs
   * Handles pagination if an agent has more than 1000 metadata entries
   * @param chainId - Chain ID
   * @param agentId - Agent ID
   * @returns Record of all metadata key-value pairs, or null if not available
   */
  async getTokenMetadata(chainId: number, agentId: number | string): Promise<Record<string, string> | null> {
    // If we already learned the GraphQL schema doesn't support this query field,
    // skip to avoid repeated GRAPHQL_VALIDATION_FAILED warnings.
    if (this.tokenMetadataCollectionSupported === false) {
      return null;
    }

    // Newer indexer schemas may not expose tokenMetadata_collection anymore.
    // Avoid spamming logs / failing requests by introspecting once and bailing out if unsupported.
    try {
      const queryFields = await this.getTypeFields('Query');
      const hasTokenMetadataCollection = Boolean(
        queryFields?.some((f) => f?.name === 'tokenMetadata_collection'),
      );
      if (!hasTokenMetadataCollection) {
        this.tokenMetadataCollectionSupported = false;
        // tokenMetadataById may exist, but it doesn't help us enumerate all metadata pairs.
        // We only use this method as a best-effort fallback, so return null when unsupported.
        return null;
      }
      this.tokenMetadataCollectionSupported = true;
    } catch (e) {
      // If introspection fails, keep existing behavior (attempt the query; it will be caught below).
    }

    const metadata: Record<string, string> = {};
    const pageSize = 1000; // The Graph's default page size
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const query = `
        query GetTokenMetadata($chainId: Int!, $agentId: String!, $first: Int!, $skip: Int!) {
          tokenMetadata_collection(
            chainId: $chainId
            agentId: $agentId
            first: $first
            skip: $skip
          ) {
            key
            value
            id
            indexedKey
          }
        }
      `;

      try {
        const data = await this.client.request<{
          tokenMetadata_collection?: Array<{
            key: string;
            value: string;
            id?: string;
            indexedKey?: string;
          }>;
        }>(query, {
          chainId,
          agentId: String(agentId),
          first: pageSize,
          skip: skip,
        });

        if (!data.tokenMetadata_collection || !Array.isArray(data.tokenMetadata_collection)) {
          hasMore = false;
          break;
        }

        // Add entries from this page
        for (const entry of data.tokenMetadata_collection) {
          if (entry.key && entry.value) {
            metadata[entry.key] = entry.value;
          }
        }

        // Check if we got a full page (might have more)
        hasMore = data.tokenMetadata_collection.length === pageSize;
        skip += pageSize;

        // Safety check: The Graph has a max skip of 5000
        // If we've reached that, we can't fetch more (unlikely for a single agent)
        if (skip >= 5000) {
          console.warn(`[AIAgentDiscoveryClient.getTokenMetadata] Reached The Graph skip limit (5000) for agent ${agentId}`);
          hasMore = false;
        }
      } catch (error) {
        // Some indexers have evolved schema and removed `tokenMetadata_collection`.
        // graphql-request surfaces this as GRAPHQL_VALIDATION_FAILED; treat it as "not supported"
        // and disable future attempts for this client instance.
        const responseErrors = (error as any)?.response?.errors;
        const schemaDoesNotSupportCollection =
          Array.isArray(responseErrors) &&
          responseErrors.some(
            (e: any) =>
              typeof e?.message === 'string' &&
              e.message.includes('tokenMetadata_collection') &&
              (e?.extensions?.code === 'GRAPHQL_VALIDATION_FAILED' ||
                e.message.includes('Cannot query field')),
          );

        if (schemaDoesNotSupportCollection) {
          this.tokenMetadataCollectionSupported = false;
          if (Object.keys(metadata).length > 0) {
            return metadata;
          }
          return null;
        }

        console.warn('[AIAgentDiscoveryClient.getTokenMetadata] Error fetching token metadata from GraphQL:', error);
        // If we got some metadata before the error, return what we have
        if (Object.keys(metadata).length > 0) {
          return metadata;
        }
        return null;
      }
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  /**
   * Get a single agent by ID with metadata
   * @param chainId - Chain ID (required by schema)
   * @param agentId - Agent ID to fetch
   * @returns Agent data with metadata or null if not found
   */
  async getAgent(chainId: number, agentId: number | string): Promise<AgentData | null> {
    const metadataValueField = await this.getAgentMetadataValueField();
    const metadataSelection =
      metadataValueField === 'valueText'
        ? `
            metadata {
              key
              valueText
            }`
        : metadataValueField === 'value'
          ? `
            metadata {
              key
              valueText: value
            }`
          : '';

    // Try searchAgentsGraph first to get metadata
    const graphQuery = `
      query GetAgentWithMetadata($where: AgentWhereInput, $first: Int) {
        searchAgentsGraph(
          where: $where
          first: $first
        ) {
          agents {
            chainId
            agentId
            agentAccount
            agentOwner
            eoaOwner
            agentName
            agentCategory
            didIdentity
            didAccount
            didName
            tokenUri
            createdAtBlock
            createdAtTime
            updatedAtTime
            type
            description
            image
            a2aEndpoint
            ensEndpoint
            agentAccountEndpoint
            did
            mcp
            x402support
            active
            supportedTrust
            rawJson
            feedbackCount
            feedbackAverageScore
            validationPendingCount
            validationCompletedCount
            validationRequestedCount
            initiatedAssociationCount
            approvedAssociationCount
            atiOverallScore
            atiOverallConfidence
            atiVersion
            atiComputedAt
            atiBundleJson
            trustLedgerScore
            trustLedgerBadgeCount
            trustLedgerOverallRank
            trustLedgerCapabilityRank
${metadataSelection}
          }
        }
      }
    `;

    try {
      const graphData = await this.client.request<{
        searchAgentsGraph?: {
          agents?: Array<{
            chainId?: number;
            agentId?: string | number;
            agentAccount?: string;
            agentOwner?: string;
            agentName?: string;
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
            metadata?: Array<{
              key: string;
              valueText: string;
            }>;
          }>;
        };
      }>(graphQuery, {
        where: {
          chainId,
          agentId: String(agentId),
        },
        first: 1,
      });

      if (graphData.searchAgentsGraph?.agents && graphData.searchAgentsGraph.agents.length > 0) {
        const agentData = graphData.searchAgentsGraph.agents[0];
        if (!agentData) {
          return null;
        }
        
        // Convert metadata array to record and add to agent data
        const normalized = this.normalizeAgent(agentData);
        if (agentData.metadata && Array.isArray(agentData.metadata)) {
          // Add metadata as a flat object on the agent data
          for (const meta of agentData.metadata) {
            if (meta.key && meta.valueText) {
              (normalized as any)[meta.key] = meta.valueText;
            }
          }
          // Also store as metadata property for easy access
          (normalized as any).metadata = agentData.metadata.reduce((acc, meta) => {
            if (meta.key && meta.valueText) {
              acc[meta.key] = meta.valueText;
            }
            return acc;
          }, {} as Record<string, string>);
        }
        
        return normalized;
      }
    } catch (error) {
      console.warn('[AIAgentDiscoveryClient.getAgent] GraphQL searchAgentsGraph failed, trying fallback:', error);
    }

    // Fallback to original agent query if searchAgentsGraph doesn't work
    const query = `
      query GetAgent($chainId: Int!, $agentId: String!) {
        agent(chainId: $chainId, agentId: $agentId) {
          chainId
          agentId
          agentAccount
          agentOwner
          eoaOwner
          agentName
          agentCategory
          didIdentity
          didAccount
          didName
          tokenUri
          createdAtBlock
          createdAtTime
          updatedAtTime
          type
          description
          image
          a2aEndpoint
          ensEndpoint
          agentAccountEndpoint
          did
          mcp
          x402support
          active
          supportedTrust
          rawJson
          atiOverallScore
          atiOverallConfidence
          atiVersion
          atiComputedAt
          atiBundleJson
          trustLedgerScore
          trustLedgerBadgeCount
          trustLedgerOverallRank
          trustLedgerCapabilityRank
        }
      }
    `;

    try {
      const data = await this.client.request<GetAgentResponse>(query, {
        chainId,
        agentId: String(agentId),
      });

      if (!data.agent) {
        return null;
      }

      return this.normalizeAgent(data.agent);
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.getAgent] Error fetching agent:', error);
      return null;
    }
  }

  async getAgentByName(agentName: string): Promise<AgentData | null> {
    const query = `
      query GetAgentByName($agentName: String!) {
        agentByName(agentName: $agentName) {
          chainId
          agentId
          agentAccount
          agentOwner
          eoaOwner
          agentName
          agentCategory
          didIdentity
      didAccount
      didName
      tokenUri
          createdAtBlock
          createdAtTime
          updatedAtTime
          type
          description
          image
          a2aEndpoint
          ensEndpoint
          agentAccountEndpoint
          did
          mcp
          x402support
          active
          supportedTrust
          rawJson
          atiOverallScore
          atiOverallConfidence
          atiVersion
          atiComputedAt
          atiBundleJson
          trustLedgerScore
          trustLedgerBadgeCount
          trustLedgerOverallRank
          trustLedgerCapabilityRank
        }
      }
    `;

    try {
      const data = await this.client.request<GetAgentByNameResponse>(query, {
        agentName,
      });
      console.log("*********** AIAgentDiscoveryClient.getAgentByName: data", data);

      if (!data.agentByName) {
        return null;
      }

      return this.normalizeAgent(data.agentByName);
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.getAgentByName] Error fetching agent:', error);
      return null;
    }
  }

  /**
   * Search agents by name
   * @param searchTerm - Search term to match against agent names
   * @param limit - Maximum number of results
   * @returns List of matching agents
   */
  async searchAgents(searchTerm: string, limit?: number): Promise<AgentData[]> {
    const query = `
      query SearchAgents($searchTerm: String!, $limit: Int) {
        agents(searchTerm: $searchTerm, limit: $limit) {
          chainId
          agentId
          agentAccount
          agentOwner
          eoaOwner
          agentName
          agentCategory
          didIdentity
          didAccount
          didName
          tokenUri
          createdAtBlock
          createdAtTime
          updatedAtTime
          type
          description
          image
          a2aEndpoint
          ensEndpoint
          agentAccountEndpoint
          did
          mcp
          x402support
          active
          supportedTrust
          rawJson
          atiOverallScore
          atiOverallConfidence
          atiVersion
          atiComputedAt
          atiBundleJson
          trustLedgerScore
          trustLedgerBadgeCount
          trustLedgerOverallRank
          trustLedgerCapabilityRank
        }
      }
    `;

    try {
      const data = await this.client.request<SearchAgentsResponse>(query, {
        searchTerm,
        limit: limit || 100,
      });

      const agents = data.agents || [];
      return agents.map((agent) => this.normalizeAgent(agent));
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.searchAgents] Error searching agents:', error);
      throw error;
    }
  }

  /**
   * Refresh/Index an agent in the indexer
   * Triggers the indexer to re-index the specified agent
   * @param agentId - Agent ID to refresh (required)
   * @param chainId - Optional chain ID (if not provided, indexer may use default)
   * @param apiKey - Optional API key override (uses config API key if not provided)
   * @returns Refresh result with success status and processed chains
   */
  async refreshAgent(
    agentId: string | number,
    chainId?: number,
    apiKey?: string
  ): Promise<RefreshAgentResponse['indexAgent']> {
    const mutation = `
      mutation IndexAgent($agentId: String!, $chainId: Int) {
        indexAgent(agentId: $agentId, chainId: $chainId) {
          success
          message
          processedChains
        }
      }
    `;

    const variables: { agentId: string; chainId?: number } = {
      agentId: String(agentId),
    };

    if (chainId !== undefined) {
      variables.chainId = chainId;
    }

    // If API key override is provided, create a temporary client with that key
    let clientToUse = this.client;
    if (apiKey) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(this.config.headers || {}),
        'Authorization': `Bearer ${apiKey}`,
      };
      clientToUse = new GraphQLClient(this.config.endpoint, {
        headers,
      });
    }

    try {
      const data = await clientToUse.request<RefreshAgentResponse>(mutation, variables);
      return data.indexAgent;
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.refreshAgent] Error refreshing agent:', error);
      throw new Error(
        `Failed to refresh agent: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Search validation requests for an agent using GraphQL
   */
  async searchValidationRequestsAdvanced(
    options: SearchValidationRequestsAdvancedOptions,
  ): Promise<{ validationRequests: ValidationRequestData[] } | null> {
    const { chainId, agentId, limit = 10, offset = 0, orderBy = 'blockNumber', orderDirection = 'DESC' } = options;

    const agentIdString = typeof agentId === 'number' ? agentId.toString() : agentId;

    const queryText = `
      query ValidationRequestsForAgent(
        $agentId: String!
        $limit: Int
        $offset: Int
        $orderBy: String
        $orderDirection: String
      ) {
        validationRequests(
          agentId: $agentId
          limit: $limit
          offset: $offset
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          id
          agentId
          validatorAddress
          requestUri
          requestJson
          requestHash
          txHash
          blockNumber
          timestamp
          createdAt
          updatedAt
        }
      }
    `;

    const variables: Record<string, unknown> = {
      agentId: agentIdString,
      limit: typeof limit === 'number' ? limit : undefined,
      offset: typeof offset === 'number' ? offset : undefined,
      orderBy: typeof orderBy === 'string' ? orderBy : undefined,
      orderDirection: typeof orderDirection === 'string' ? orderDirection : undefined,
    };

    try {
      const data = await this.client.request<{ validationRequests: ValidationRequestData[] }>(queryText, variables);
      const requests = data?.validationRequests;
      if (!Array.isArray(requests)) {
        return null;
      }
      return {
        validationRequests: requests.filter(Boolean) as ValidationRequestData[],
      };
    } catch (error) {
      console.warn('[AIAgentDiscoveryClient] searchValidationRequestsAdvanced failed:', error);
      return null;
    }
  }

  /**
   * Search feedback for an agent using GraphQL
   */
  async searchFeedbackAdvanced(
    options: SearchFeedbackAdvancedOptions,
  ): Promise<{ feedbacks: FeedbackData[] } | null> {
    const { chainId, agentId, limit = 10, offset = 0, orderBy = 'timestamp', orderDirection = 'DESC' } = options;

    const agentIdString = typeof agentId === 'number' ? agentId.toString() : agentId;

    const queryText = `
      query FeedbackForAgent(
        $chainId: Int!
        $agentId: String!
        $limit: Int
        $offset: Int
        $orderBy: String
        $orderDirection: String
      ) {
        feedbacks(
          chainId: $chainId
          agentId: $agentId
          limit: $limit
          offset: $offset
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          id
          agentId
          clientAddress
          score
          feedbackUri
          feedbackJson
          comment
          ratingPct
          txHash
          blockNumber
          timestamp
          isRevoked
          responseCount
        }
      }
    `;

    const variables: Record<string, unknown> = {
      chainId,
      agentId: agentIdString,
      limit: typeof limit === 'number' ? limit : undefined,
      offset: typeof offset === 'number' ? offset : undefined,
      orderBy: typeof orderBy === 'string' ? orderBy : undefined,
      orderDirection: typeof orderDirection === 'string' ? orderDirection : undefined,
    };

    try {
      const data = await this.client.request<{ feedbacks: FeedbackData[] }>(queryText, variables);
      const feedbacks = data?.feedbacks;
      if (!Array.isArray(feedbacks)) {
        return null;
      }
      return {
        feedbacks: feedbacks.filter(Boolean) as FeedbackData[],
      };
    } catch (error) {
      console.warn('[AIAgentDiscoveryClient] searchFeedbackAdvanced failed:', error);
      return null;
    }
  }

  /**
   * Execute a raw GraphQL query
   * @param query - GraphQL query string
   * @param variables - Query variables
   * @returns Query response
   */
  async request<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
    return this.client.request<T>(query, variables);
  }

  /**
   * Execute a raw GraphQL mutation
   * @param mutation - GraphQL mutation string
   * @param variables - Mutation variables
   * @returns Mutation response
   */
  async mutate<T = any>(mutation: string, variables?: Record<string, any>): Promise<T> {
    return this.client.request<T>(mutation, variables);
  }

  /**
   * Get the underlying GraphQLClient instance
   * @returns The GraphQLClient instance
   */
  getClient(): GraphQLClient {
    return this.client;
  }

  /**
   * Get agents owned by a specific EOA address
   * @param eoaAddress - The EOA (Externally Owned Account) address to search for
   * @param options - Optional search options (limit, offset, orderBy, orderDirection)
   * @returns List of agents owned by the EOA address
   */
  async getOwnedAgents(
    eoaAddress: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: 'agentId' | 'agentName' | 'createdAtTime' | 'createdAtBlock' | 'agentOwner' | 'eoaOwner';
      orderDirection?: 'ASC' | 'DESC';
    }
  ): Promise<AgentData[]> {
    if (!eoaAddress || typeof eoaAddress !== 'string' || !eoaAddress.startsWith('0x')) {
      throw new Error('Invalid EOA address. Must be a valid Ethereum address starting with 0x');
    }

    // Indexer/storage can vary: some deployments store checksum addresses as strings; others store lowercased hex.
    // Query defensively in a case-safe way.
    const addrLower = eoaAddress.toLowerCase();
    const addrCandidates: string[] = [];
    addrCandidates.push(eoaAddress);
    if (addrLower !== eoaAddress) addrCandidates.push(addrLower);
    try {
      // viem getAddress normalizes to checksum format
      const { getAddress } = await import('viem');
      const checksum = getAddress(addrLower);
      if (checksum !== eoaAddress && checksum !== addrLower) addrCandidates.push(checksum);
    } catch {
      // ignore; keep candidates we already have
    }

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? 'agentId';
    const orderDirection = options?.orderDirection ?? 'DESC';

    const query = `
      query GetOwnedAgents(
        $where: AgentWhereInput
        $first: Int
        $skip: Int
        $orderBy: AgentOrderBy
        $orderDirection: OrderDirection
      ) {
        searchAgentsGraph(
          where: $where
          first: $first
          skip: $skip
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          agents {
            chainId
            agentId
            agentAccount
            agentOwner
            agentName
            agentCategory
            didIdentity
            didAccount
            didName
            tokenUri
            createdAtBlock
            createdAtTime
            updatedAtTime
            type
            description
            image
            a2aEndpoint
            ensEndpoint
            agentAccountEndpoint
            supportedTrust
            rawJson
            did
            mcp
            x402support
            active
            feedbackCount
            feedbackAverageScore
            validationPendingCount
            validationCompletedCount
            validationRequestedCount
            initiatedAssociationCount
            approvedAssociationCount
            atiOverallScore
            atiOverallConfidence
            atiVersion
            atiComputedAt
            atiBundleJson
            trustLedgerScore
            trustLedgerBadgeCount
            trustLedgerOverallRank
            trustLedgerCapabilityRank
          }
          total
          hasMore
        }
      }
    `;

    try {
      // Prefer _in filter (works for string fields and some bytes fields). If schema doesn't support it,
      // fall back to exact-match attempts across candidates.
      const tryQuery = async (where: Record<string, unknown>) => {
        const variables: Record<string, unknown> = {
          where,
          first: limit,
          skip: offset,
          orderBy,
          orderDirection,
        };
        const data = await this.client.request<{
          searchAgentsGraph?: {
            agents?: AgentData[];
            total?: number;
            hasMore?: boolean;
          };
        }>(query, variables);
        const result = data.searchAgentsGraph ?? { agents: [], total: 0, hasMore: false };
        return (result.agents ?? []).map((agent) => this.normalizeAgent(agent));
      };

      // 1) Try eoaOwner_in: [candidates]
      try {
        const owned = await tryQuery({ eoaOwner_in: addrCandidates });
        if (owned.length > 0) return owned;
      } catch (e: any) {
        const responseErrors = e?.response?.errors;
        const inNotSupported =
          Array.isArray(responseErrors) &&
          responseErrors.some(
            (err) =>
              typeof err?.message === 'string' &&
              (err.message.includes('eoaOwner_in') ||
                err.message.includes('Field "eoaOwner_in"') ||
                err.message.includes('Unknown argument') ||
                err.message.includes('Cannot query field')),
          );
        if (!inNotSupported) {
          throw e;
        }
      }

      // 2) Exact match attempts
      for (const candidate of addrCandidates) {
        const owned = await tryQuery({ eoaOwner: candidate });
        if (owned.length > 0) return owned;
      }

      return [];
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.getOwnedAgents] Error fetching owned agents:', error);
      throw error;
    }
  }
}

