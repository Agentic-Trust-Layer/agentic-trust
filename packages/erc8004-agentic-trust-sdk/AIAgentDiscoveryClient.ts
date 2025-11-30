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
  a2aEndpoint?: string | null; // URL to agent-card.json
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
  [key: string]: unknown; // Allow for additional fields that may exist
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

    const normalized: AgentData = {
      ...(record as AgentData),
    };

    const agentAccount = toOptionalString(record.agentAccount);
    if (agentAccount !== undefined) {
      normalized.agentAccount = agentAccount;
    }

    const agentOwner = toOptionalString(record.agentOwner);
    if (agentOwner !== undefined) {
      normalized.agentOwner = agentOwner;
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
          agentName
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
      const pageAgents = (data.agents || []).map((agent) =>
        this.normalizeAgent(agent),
      );
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
                agentName
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
              .map((item) => this.normalizeAgent(item as AgentData));

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
      agentName
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
              agentName
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
        return {
          agents: list.filter(Boolean) as AgentData[],
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
    orderBy?: 'agentId' | 'agentName' | 'createdAtTime' | 'createdAtBlock' | 'agentOwner';
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
            agentName
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
    const agents = (result.agents ?? []).map((agent) => this.normalizeAgent(agent));

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
   * Get a single agent by ID
   * @param chainId - Chain ID (required by schema)
   * @param agentId - Agent ID to fetch
   * @returns Agent data or null if not found
   */
  async getAgent(chainId: number, agentId: number | string): Promise<AgentData | null> {
    const query = `
      query GetAgent($chainId: Int!, $agentId: String!) {
        agent(chainId: $chainId, agentId: $agentId) {
          chainId
          agentId
          agentAccount
          agentOwner
          agentName
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
          agentName
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
          agentName
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
}

