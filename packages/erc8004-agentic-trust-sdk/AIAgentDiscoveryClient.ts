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
  
  agentDID?: string;
  agentENS?: string;
  agentAccountDID?: string;
  
  agentAddress?: string;
  agentOwner?: string;
  metadataURI?: string;
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

  /**
   * List all agents
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
          agentAddress
          agentOwner
          agentName
          metadataURI
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
      const pageAgents = data.agents || [];
      allAgents = allAgents.concat(pageAgents);
    } catch (error) {
      console.warn('[AIAgentDiscoveryClient.listAgents] Error fetching agents with pagination:', error);
    }

    return allAgents;
  }

  async searchAgentsAdvanced(
    options: SearchAgentsAdvancedOptions,
  ): Promise<{ agents: AgentData[]; total?: number | null } | null> {
    const strategy = await this.detectSearchStrategy();

    const { query, params, limit, offset } = options;
    const trimmedQuery = typeof query === 'string' ? query.trim() : '';
    const hasQuery = trimmedQuery.length > 0;
    const hasParams = params && Object.keys(params).length > 0;

    if (!hasQuery && !hasParams) {
      return null;
    }

    // If no detected strategy (introspection disabled), attempt a direct list-form searchAgents call.
    if (!strategy) {
      try {
        const queryText = `
          query SearchAgentsFallback($query: String!, $limit: Int, $offset: Int, $orderBy: String, $orderDirection: String) {
            searchAgents(query: $query, limit: $limit, offset: $offset, orderBy: $orderBy, orderDirection: $orderDirection) {
              chainId
              agentId
              agentAddress
              agentOwner
              agentName
              metadataURI
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
        if (Array.isArray(list)) {
          return { agents: list.filter(Boolean) as AgentData[], total: undefined };
        }
      } catch (error) {
        console.warn('[AIAgentDiscoveryClient] Fallback searchAgents call failed:', error);
      }
      return null;
    }

    const variables: Record<string, unknown> = {};
    const variableDefinitions: string[] = [];
    const argumentAssignments: string[] = [];

    const agentSelection = `
      chainId
      agentId
      agentAddress
      agentOwner
      agentName
      metadataURI
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
      if (!addStringArg(strategy.queryArg, hasQuery ? trimmedQuery : undefined)) {
        return null;
      }
      if (!addInputArg(strategy.filterArg, hasParams ? (params as Record<string, unknown>) : undefined)) {
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
        query AdvancedSearch(${variableDefinitions.join(', ')}) {
          ${strategy.fieldName}(${argumentAssignments.join(', ')}) {
            ${strategy.totalFieldName ? `${strategy.totalFieldName}` : ''}
            ${strategy.listFieldName} {
              chainId
              agentId
              agentAddress
              agentOwner
              agentName
              metadataURI
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
          agentAddress
          agentOwner
          agentName
          metadataURI
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
        }
      }
    `;

    try {
      const data = await this.client.request<GetAgentResponse>(query, {
        chainId,
        agentId: String(agentId),
      });

      return data.agent || null;
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
          agentAddress
          agentOwner
          agentName
          metadataURI
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
        }
      }
    `;

    try {
      const data = await this.client.request<GetAgentByNameResponse>(query, {
        agentName,
      });
      console.log("*********** AIAgentDiscoveryClient.getAgentByName: data", data);

      return data.agentByName || null;
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
          agentAddress
          agentOwner
          agentName
          metadataURI
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
        }
      }
    `;

    try {
      const data = await this.client.request<SearchAgentsResponse>(query, {
        searchTerm,
        limit: limit || 100,
      });

      return data.agents || [];
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.searchAgents] Error searching agents:', error);
      // Fallback to client-side filtering if search isn't supported
      const allAgents = await this.listAgents();
      const searchLower = searchTerm.toLowerCase();
      return allAgents.filter(agent => 
        agent.agentName?.toLowerCase().includes(searchLower)
      );
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

