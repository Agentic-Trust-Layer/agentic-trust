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
  uaid?: string | null;
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
  a2aEndpoint?: string | null; // URL to agent.json
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

/**
 * KB v2 GraphQL types (graphql-kb).
 */
export type KbProtocolDescriptor = {
  iri: string;
  protocol: string;
  serviceUrl: string;
  protocolVersion?: string | null;
  json?: string | null;
  skills: string[];
  domains: string[];
};

export type KbIdentityDescriptor = {
  iri: string;
  kind: string;
  json?: string | null;
  onchainMetadataJson?: string | null;
  registeredBy?: string | null;
  registryNamespace?: string | null;
  skills: string[];
  domains: string[];
  protocolDescriptors: KbProtocolDescriptor[];
};

export type KbIdentity = {
  iri: string;
  kind: string;
  did: string;
  descriptor?: KbIdentityDescriptor | null;
};

export type KbAccount = {
  iri: string;
  chainId?: number | null;
  address?: string | null;
  accountType?: string | null;
  didEthr?: string | null;
};

export type KbAgent = {
  iri: string;
  uaid?: string | null;
  agentName?: string | null;
  agentTypes: string[];
  did8004?: string | null;
  agentId8004?: number | null;
  isSmartAgent: boolean;
  identity8004?: KbIdentity | null;
  identityEns?: KbIdentity | null;
  // Accounts attached to the ERC-8004 identity (identity-scoped)
  identityOwnerAccount?: KbAccount | null;
  identityOperatorAccount?: KbAccount | null;
  identityWalletAccount?: KbAccount | null;

  // Accounts attached to the agent (agent-scoped)
  agentOwnerAccount?: KbAccount | null;
  agentOperatorAccount?: KbAccount | null;
  agentWalletAccount?: KbAccount | null;
  agentOwnerEOAAccount?: KbAccount | null;

  // SmartAgent -> ERC-8004 agent-controlled account (AgentAccount)
  agentAccount?: KbAccount | null;
};

type KbAgentSearchResult = {
  agents: KbAgent[];
  total: number;
  hasMore: boolean;
};

type KbSemanticAgentSearchResult = {
  matches: Array<{
    agent?: KbAgent | null;
    score: number;
    matchReasons?: string[] | null;
  }>;
  total: number;
  intentType?: string | null;
};

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

/** Intent type from discovery GraphQL */
export interface DiscoveryIntentType {
  key: string;
  label?: string | null;
  description?: string | null;
}

/** Task type from discovery GraphQL */
export interface DiscoveryTaskType {
  key: string;
  label?: string | null;
  description?: string | null;
}

/** Intent-to-task mapping from discovery GraphQL */
export interface DiscoveryIntentTaskMapping {
  intent: DiscoveryIntentType;
  task: DiscoveryTaskType;
  requiredSkills: string[];
  optionalSkills: string[];
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
export class AIAgentDiscoveryClient {
  private client: GraphQLClient;
  private config: AIAgentDiscoveryClientConfig;
  private searchStrategy?: SearchStrategy | null;
  private searchStrategyPromise?: Promise<SearchStrategy | null>;
  private typeFieldsCache = new Map<string, TypeField[] | null>();
  private tokenMetadataCollectionSupported?: boolean;
  private agentMetadataValueField?: 'valueText' | 'value' | null;
  private queryFieldsCache?: GraphQLField[] | null;
  private queryFieldsPromise?: Promise<GraphQLField[] | null>;
  private kbV2SupportCache?: boolean;
  private kbV2SupportPromise?: Promise<boolean>;

  constructor(config: AIAgentDiscoveryClientConfig) {
    const endpoint = (() => {
      const raw = (config.endpoint || '').toString().trim().replace(/\/+$/, '');
      if (!raw) return raw;
      // Force KB endpoint:
      // - if caller passed ".../graphql", replace with ".../graphql-kb"
      // - if caller passed base URL, append "/graphql-kb"
      if (/\/graphql$/i.test(raw)) return raw.replace(/\/graphql$/i, '/graphql-kb');
      if (/\/graphql-kb$/i.test(raw)) return raw;
      return `${raw}/graphql-kb`;
    })();

    this.config = { ...config, endpoint };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.headers || {}),
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
      // Also support API key in header
      headers['X-API-Key'] = config.apiKey;
      // Some deployments use an explicit access-code header
      headers['X-Access-Code'] = config.apiKey;
    }

    this.client = new GraphQLClient(endpoint, {
      headers,
    });
  }

  private extractOperationName(query: string): string | null {
    const m = /\b(query|mutation)\s+([A-Za-z0-9_]+)/.exec(query);
    return m?.[2] ? String(m[2]) : null;
  }

  private decorateGraphqlError(error: unknown, query: string): Error {
    const op = this.extractOperationName(query) ?? 'unknown_operation';
    const endpoint = this.config.endpoint;

    const status =
      typeof error === 'object' &&
      error !== null &&
      'response' in error &&
      typeof (error as any).response?.status === 'number'
        ? (error as any).response.status
        : undefined;

    const gqlMessages: string[] = [];
    const responseErrors = (error as any)?.response?.errors;
    if (Array.isArray(responseErrors)) {
      for (const e of responseErrors) {
        if (typeof e?.message === 'string' && e.message.trim()) gqlMessages.push(e.message.trim());
      }
    }

    const combined = (gqlMessages.join(' ') || (error instanceof Error ? error.message : '')).trim();
    const lower = combined.toLowerCase();

    const kind =
      status === 401 || status === 403
        ? 'auth'
        : status === 404
          ? 'missing_endpoint'
          : lower.includes('cannot query field') || lower.includes('unknown argument')
            ? 'schema_mismatch'
            : 'unknown';

    const msg =
      `[DiscoveryGraphQL:${kind}] ` +
      `operation=${op} status=${typeof status === 'number' ? status : 'unknown'} ` +
      `endpoint=${endpoint} ` +
      (combined ? `message=${combined}` : 'message=Unknown error');

    const wrapped = new Error(msg);
    if (error instanceof Error) (wrapped as any).cause = error;
    return wrapped;
  }

  private async gqlRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    try {
      return await this.client.request<T>(query, variables);
    } catch (error) {
      throw this.decorateGraphqlError(error, query);
    }
  }

  private async getQueryFields(): Promise<GraphQLField[] | null> {
    if (this.queryFieldsCache !== undefined) {
      return this.queryFieldsCache;
    }
    if (this.queryFieldsPromise) {
      return this.queryFieldsPromise;
    }

    this.queryFieldsPromise = (async () => {
      try {
        const data = await this.gqlRequest<IntrospectionQueryResult>(INTROSPECTION_QUERY);
        const fields = data.__schema?.queryType?.fields ?? [];
        this.queryFieldsCache = fields;
        return fields;
      } catch (error) {
        console.warn('[AIAgentDiscoveryClient] Failed to introspect query fields:', error);
        this.queryFieldsCache = null;
        return null;
      } finally {
        this.queryFieldsPromise = undefined;
      }
    })();

    return this.queryFieldsPromise;
  }

  private async hasQueryField(fieldName: string): Promise<boolean> {
    const fields = await this.getQueryFields();
    return Array.isArray(fields) ? fields.some((f) => f?.name === fieldName) : false;
  }

  private async supportsKbV2Queries(): Promise<boolean> {
    if (typeof this.kbV2SupportCache === 'boolean') return this.kbV2SupportCache;
    if (this.kbV2SupportPromise) return this.kbV2SupportPromise;

    this.kbV2SupportPromise = (async () => {
      try {
        const fields = await this.getQueryFields();
        if (!Array.isArray(fields) || fields.length === 0) {
          // Introspection disabled or failed → assume legacy.
          this.kbV2SupportCache = false;
          return false;
        }
        const names = new Set(fields.map((f) => f?.name).filter(Boolean) as string[]);
        const ok = names.has('kbAgents') && names.has('kbAgent') && names.has('kbSemanticAgentSearch');
        this.kbV2SupportCache = ok;
        return ok;
      } catch {
        this.kbV2SupportCache = false;
        return false;
      } finally {
        this.kbV2SupportPromise = undefined;
      }
    })();

    return this.kbV2SupportPromise;
  }

  /**
   * Map a KB v2 agent node into the legacy AgentData shape used across the monorepo.
   */
  private mapKbAgentToAgentData(agent: KbAgent | null | undefined): AgentData {
    const a = (agent ?? {}) as Partial<KbAgent>;

    const pickAccountAddress = (...accounts: Array<KbAccount | null | undefined>): string | null => {
      for (const acc of accounts) {
        const addr = acc?.address;
        if (typeof addr === 'string' && addr.trim()) {
          return addr.trim();
        }
      }
      return null;
    };

    const did8004 = typeof a.did8004 === 'string' && a.did8004.trim() ? a.did8004.trim() : null;
    const agentId8004 =
      typeof a.agentId8004 === 'number' && Number.isFinite(a.agentId8004) ? a.agentId8004 : null;

    // Best-effort: infer chainId from the most specific account we have.
    const chainId =
      (typeof a.agentAccount?.chainId === 'number' ? a.agentAccount?.chainId : null) ??
      (typeof a.agentWalletAccount?.chainId === 'number' ? a.agentWalletAccount?.chainId : null) ??
      (typeof a.agentOwnerEOAAccount?.chainId === 'number' ? a.agentOwnerEOAAccount?.chainId : null) ??
      (typeof a.identityOwnerAccount?.chainId === 'number' ? a.identityOwnerAccount?.chainId : null) ??
      (typeof a.identityWalletAccount?.chainId === 'number' ? a.identityWalletAccount?.chainId : null) ??
      null;

    // "agentAccount" in KB v2 is the SmartAgent-controlled account (AgentAccount).
    // For non-smart agents, fall back to agent/identity wallet/owner accounts.
    const agentAccount =
      pickAccountAddress(
        a.agentAccount,
        a.agentWalletAccount,
        a.identityWalletAccount,
        a.agentOwnerEOAAccount,
        a.identityOwnerAccount,
        a.agentOwnerAccount,
      ) ?? null;

    const identityOwner =
      pickAccountAddress(a.identityOwnerAccount, a.agentOwnerEOAAccount, a.agentOwnerAccount) ?? null;

    const registeredBy =
      (typeof a.identity8004?.descriptor?.registeredBy === 'string' && a.identity8004.descriptor.registeredBy.trim()
        ? a.identity8004.descriptor.registeredBy.trim()
        : null) ??
      (typeof a.identityEns?.descriptor?.registeredBy === 'string' && a.identityEns.descriptor.registeredBy.trim()
        ? a.identityEns.descriptor.registeredBy.trim()
        : null) ??
      null;

    const registeredByAddress =
      registeredBy && /^0x[a-fA-F0-9]{40}$/.test(registeredBy) ? registeredBy : null;

    const isOwnerEoa =
      (a.agentOwnerEOAAccount?.accountType ?? a.identityOwnerAccount?.accountType ?? '')
        .toString()
        .toLowerCase()
        .includes('eoa');

    // Pull descriptor JSON where available.
    const rawJson =
      (typeof a.identity8004?.descriptor?.json === 'string' && a.identity8004.descriptor.json) ||
      (typeof a.identityEns?.descriptor?.json === 'string' && a.identityEns.descriptor.json) ||
      null;

    // Infer A2A/MCP endpoints from protocol descriptors.
    const protocolDescriptors = [
      ...(Array.isArray(a.identity8004?.descriptor?.protocolDescriptors)
        ? (a.identity8004?.descriptor?.protocolDescriptors as KbProtocolDescriptor[])
        : []),
      ...(Array.isArray(a.identityEns?.descriptor?.protocolDescriptors)
        ? (a.identityEns?.descriptor?.protocolDescriptors as KbProtocolDescriptor[])
        : []),
    ];

    const a2aEndpoint =
      protocolDescriptors.find((p) => String(p?.protocol || '').toLowerCase() === 'a2a')?.serviceUrl ??
      null;

    const hasMcp =
      protocolDescriptors.some((p) => String(p?.protocol || '').toLowerCase() === 'mcp') || false;

    const normalized: AgentData = {
      agentId: agentId8004 ?? undefined,
      uaid:
        typeof a.uaid === 'string' && a.uaid.trim().startsWith('uaid:')
          ? a.uaid.trim()
          : null,
      agentName: typeof a.agentName === 'string' ? a.agentName : undefined,
      chainId: chainId ?? undefined,
      agentAccount: agentAccount ?? undefined,
      agentIdentityOwnerAccount: (registeredByAddress ?? identityOwner) ?? undefined,
      eoaAgentIdentityOwnerAccount: registeredByAddress ?? (isOwnerEoa ? identityOwner : null),
      eoaAgentAccount: isOwnerEoa ? agentAccount : null,
      // Extra KB v2 account fields (flattened)
      identityOwnerAccount: pickAccountAddress(a.identityOwnerAccount) ?? undefined,
      identityWalletAccount: pickAccountAddress(a.identityWalletAccount) ?? undefined,
      identityOperatorAccount: pickAccountAddress(a.identityOperatorAccount) ?? undefined,
      agentOwnerAccount: pickAccountAddress(a.agentOwnerAccount) ?? undefined,
      agentWalletAccount: pickAccountAddress(a.agentWalletAccount) ?? undefined,
      agentOperatorAccount: pickAccountAddress(a.agentOperatorAccount) ?? undefined,
      agentOwnerEOAAccount: pickAccountAddress(a.agentOwnerEOAAccount) ?? undefined,
      smartAgentAccount: pickAccountAddress(a.agentAccount) ?? undefined,
      didIdentity: did8004,
      did: did8004,
      a2aEndpoint,
      mcp: hasMcp,
      rawJson,
      // Minimal capability hints
      active: true,
    };

    return this.normalizeAgent(normalized);
  }

  private buildKbAgentSelection(): string {
    return `
      iri
      uaid
      agentName
      agentTypes
      did8004
      agentId8004
      isSmartAgent
      identity8004 {
        iri
        kind
        did
        descriptor {
          iri
          kind
          json
          onchainMetadataJson
          registeredBy
          registryNamespace
          skills
          domains
          protocolDescriptors {
            iri
            protocol
            serviceUrl
            protocolVersion
            json
            skills
            domains
          }
        }
      }
      identityEns {
        iri
        kind
        did
        descriptor {
          iri
          kind
          json
          onchainMetadataJson
          registeredBy
          registryNamespace
          skills
          domains
          protocolDescriptors {
            iri
            protocol
            serviceUrl
            protocolVersion
            json
            skills
            domains
          }
        }
      }
      identityOwnerAccount { iri chainId address accountType didEthr }
      identityOperatorAccount { iri chainId address accountType didEthr }
      identityWalletAccount { iri chainId address accountType didEthr }

      agentOwnerAccount { iri chainId address accountType didEthr }
      agentOperatorAccount { iri chainId address accountType didEthr }
      agentWalletAccount { iri chainId address accountType didEthr }
      agentOwnerEOAAccount { iri chainId address accountType didEthr }

      agentAccount { iri chainId address accountType didEthr }
    `;
  }

  private async supportsQueryField(fieldName: string): Promise<boolean> {
    const fields = await this.getQueryFields();
    if (!fields) return false;
    return fields.some((f) => f.name === fieldName);
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

    // UAID is required (do not synthesize from did:8004).
    const uaidRaw = record.uaid;
    const uaidStr = typeof uaidRaw === 'string' ? uaidRaw.trim() : '';
    if (!uaidStr) {
      const agentId8004 =
        typeof record.agentId === 'string' || typeof record.agentId === 'number'
          ? String(record.agentId)
          : '';
      const chainId =
        typeof record.chainId === 'number' || typeof record.chainId === 'string'
          ? String(record.chainId)
          : '';
      throw new Error(
        `[Discovery] Missing uaid for agent (chainId=${chainId || '?'}, agentId=${agentId8004 || '?'}) from KB GraphQL. Ensure Query.kbAgents / Query.kbOwnedAgentsAllChains returns KbAgent.uaid.`,
      );
    }
    if (!uaidStr.startsWith('uaid:')) {
      const agentId8004 =
        typeof record.agentId === 'string' || typeof record.agentId === 'number'
          ? String(record.agentId)
          : '';
      const chainId =
        typeof record.chainId === 'number' || typeof record.chainId === 'string'
          ? String(record.chainId)
          : '';
      throw new Error(
        `[Discovery] Invalid uaid value for agent (chainId=${chainId || '?'}, agentId=${agentId8004 || '?'}, uaid=${uaidStr}). Expected uaid to start with "uaid:". Your KB is currently returning a DID (e.g. "did:8004:...") in the uaid field.`,
      );
    }
    normalized.uaid = uaidStr;

    const agentAccount = toOptionalString(record.agentAccount);
    if (agentAccount !== undefined) {
      normalized.agentAccount = agentAccount;
    }

    const agentIdentityOwnerAccount = toOptionalString(record.agentIdentityOwnerAccount);
    if (agentIdentityOwnerAccount !== undefined) {
      normalized.agentIdentityOwnerAccount = agentIdentityOwnerAccount;
    }

    const eoaAgentIdentityOwnerAccount = toOptionalStringOrNull(record.eoaAgentIdentityOwnerAccount);
    if (eoaAgentIdentityOwnerAccount !== undefined) {
      normalized.eoaAgentIdentityOwnerAccount = eoaAgentIdentityOwnerAccount;
    }

    const eoaAgentAccount = toOptionalStringOrNull(record.eoaAgentAccount);
    if (eoaAgentAccount !== undefined) {
      normalized.eoaAgentAccount = eoaAgentAccount;
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

    const agentUri = toOptionalStringOrNull(record.agentUri);
    if (agentUri !== undefined) {
      normalized.agentUri = agentUri;
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

    const agentCardJson = toOptionalStringOrNull(record.agentCardJson);
    if (agentCardJson !== undefined) {
      normalized.agentCardJson = agentCardJson;
    }

    const agentCardReadAt = toOptionalNumberOrNull(record.agentCardReadAt);
    if (agentCardReadAt !== undefined) {
      normalized.agentCardReadAt = agentCardReadAt;
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
    const effectiveLimit = limit ?? 100;
    const effectiveOffset = offset ?? 0;

    const query = `
      query ListKbAgents($first: Int, $skip: Int) {
        kbAgents(first: $first, skip: $skip, orderBy: agentId8004, orderDirection: DESC) {
          agents { ${this.buildKbAgentSelection()} }
          total
          hasMore
        }
      }
    `;

    try {
      const data = await this.gqlRequest<{ kbAgents: KbAgentSearchResult }>(query, {
        first: effectiveLimit,
        skip: effectiveOffset,
      });

      const list = data?.kbAgents?.agents ?? [];
      return list.map((a) => this.mapKbAgentToAgentData(a));
    } catch (error) {
      throw error;
    }
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
    requiredSkills?: string[];
    intentType?: string;
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
          ${this.buildKbAgentSelection()}
        }
      }
    `;

      const requiredSkills = Array.isArray(params.requiredSkills) ? params.requiredSkills : undefined;
      // Note: intentType is not sent to GraphQL - backend should extract it from intentJson
      // We keep it in params for logging/debugging but don't include it in the GraphQL query

      const query = `
        query KbSemanticAgentSearch($input: SemanticAgentSearchInput!) {
          kbSemanticAgentSearch(input: $input) {
            ${selection}
          }
        }
      `;

      try {
        const input: Record<string, unknown> = {};
        if (text) input.text = text;
        if (intentJson) input.intentJson = intentJson;
        if (typeof topK === 'number') input.topK = topK;
        if (Array.isArray(requiredSkills) && requiredSkills.length > 0) input.requiredSkills = requiredSkills;

        const data = await this.client.request<{ kbSemanticAgentSearch?: KbSemanticAgentSearchResult }>(query, {
          input,
        });

      const root = data.kbSemanticAgentSearch;
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

        const normalizedAgent = this.mapKbAgentToAgentData(item.agent as any);

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

  /**
   * Fetch OASF skills taxonomy from the discovery GraphQL endpoint (best-effort).
   * Returns [] if the backend does not expose `oasfSkills`.
   */
  async oasfSkills(params?: {
    key?: string;
    nameKey?: string;
    category?: string;
    extendsKey?: string;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: string;
  }): Promise<OasfSkill[]> {
    const query = `
      query OasfSkills(
        $key: String
        $nameKey: String
        $category: String
        $extendsKey: String
        $limit: Int
        $offset: Int
        $orderBy: String
        $orderDirection: String
      ) {
        oasfSkills(
          key: $key
          nameKey: $nameKey
          category: $category
          extendsKey: $extendsKey
          limit: $limit
          offset: $offset
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          key
          nameKey
          uid
          caption
          extendsKey
          category
        }
      }
    `;

    try {
      const variables: Record<string, unknown> = {};
      if (typeof params?.limit === 'number') variables.limit = params.limit;
      if (typeof params?.offset === 'number') variables.offset = params.offset;
      if (params?.orderBy) variables.orderBy = params.orderBy;
      if (params?.orderDirection) variables.orderDirection = params.orderDirection;
      if (params?.key) variables.key = params.key;
      if (params?.nameKey) variables.nameKey = params.nameKey;
      if (params?.category) variables.category = params.category;
      if (params?.extendsKey) variables.extendsKey = params.extendsKey;

      const data = await this.client.request<{ oasfSkills?: OasfSkill[] }>(query, variables);
      return Array.isArray(data?.oasfSkills) ? data.oasfSkills : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // If the backend schema doesn't expose the field, treat it as "unsupported".
      if (message.includes('Cannot query field "oasfSkills"')) {
        return [];
      }
      // Some deployments expose the field but error due to resolver returning null for a non-null list.
      // Treat this as "taxonomy unavailable" rather than failing the caller.
      if (/Cannot return null for non-nullable field\s+Query\.oasfSkills\b/i.test(message)) {
        return [];
      }
      // Handle SPARQL translation errors (GraphDB backend)
      if (message.includes('SPARQL') || message.includes('MALFORMED QUERY')) {
        console.warn('[AIAgentDiscoveryClient] oasfSkills SPARQL translation error (backend issue):', message);
        return [];
      }
      console.warn('[AIAgentDiscoveryClient] oasfSkills query failed:', error);
      throw error;
    }
  }

  /**
   * Fetch OASF domains taxonomy from the discovery GraphQL endpoint (best-effort).
   * Returns [] if the backend does not expose `oasfDomains`.
   */
  async oasfDomains(params?: {
    key?: string;
    nameKey?: string;
    category?: string;
    extendsKey?: string;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: string;
  }): Promise<OasfDomain[]> {
    const query = `
      query OasfDomains(
        $key: String
        $nameKey: String
        $category: String
        $extendsKey: String
        $limit: Int
        $offset: Int
        $orderBy: String
        $orderDirection: String
      ) {
        oasfDomains(
          key: $key
          nameKey: $nameKey
          category: $category
          extendsKey: $extendsKey
          limit: $limit
          offset: $offset
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          key
          nameKey
          uid
          caption
          extendsKey
          category
        }
      }
    `;

    try {
      const variables: Record<string, unknown> = {};
      if (typeof params?.limit === 'number') variables.limit = params.limit;
      if (typeof params?.offset === 'number') variables.offset = params.offset;
      if (params?.orderBy) variables.orderBy = params.orderBy;
      if (params?.orderDirection) variables.orderDirection = params.orderDirection;
      if (params?.key) variables.key = params.key;
      if (params?.nameKey) variables.nameKey = params.nameKey;
      if (params?.category) variables.category = params.category;
      if (params?.extendsKey) variables.extendsKey = params.extendsKey;

      const data = await this.client.request<{ oasfDomains?: OasfDomain[] }>(query, variables);
      return Array.isArray(data?.oasfDomains) ? data.oasfDomains : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Cannot query field "oasfDomains"')) {
        return [];
      }
      if (/Cannot return null for non-nullable field\s+Query\.oasfDomains\b/i.test(message)) {
        return [];
      }
      // Handle SPARQL translation errors (GraphDB backend)
      if (message.includes('SPARQL') || message.includes('MALFORMED QUERY')) {
        console.warn('[AIAgentDiscoveryClient] oasfDomains SPARQL translation error (backend issue):', message);
        return [];
      }
      console.warn('[AIAgentDiscoveryClient] oasfDomains query failed:', error);
      throw error;
    }
  }

  /**
   * Fetch intent types from the discovery GraphQL endpoint (best-effort).
   * Returns [] if the backend does not expose `intentTypes`.
   */
  async intentTypes(params?: {
    key?: string;
    label?: string;
    limit?: number;
    offset?: number;
  }): Promise<DiscoveryIntentType[]> {
    const query = `
      query IntentTypes($key: String, $label: String, $limit: Int, $offset: Int) {
        intentTypes(key: $key, label: $label, limit: $limit, offset: $offset) {
          key
          label
          description
        }
      }
    `;
    try {
      const variables: Record<string, unknown> = {
        limit: typeof params?.limit === 'number' ? params.limit : 10000,
        offset: typeof params?.offset === 'number' ? params.offset : 0,
      };
      if (params?.key) variables.key = params.key;
      if (params?.label) variables.label = params.label;

      const data = await this.client.request<{ intentTypes?: DiscoveryIntentType[] }>(query, variables);
      return Array.isArray(data?.intentTypes) ? data.intentTypes : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Cannot query field "intentTypes"')) return [];
      if (/Cannot return null for non-nullable field\s+Query\.intentTypes\b/i.test(message)) return [];
      if (message.includes('SPARQL') || message.includes('MALFORMED QUERY')) {
        console.warn('[AIAgentDiscoveryClient] intentTypes SPARQL translation error (backend issue):', message);
        return [];
      }
      console.warn('[AIAgentDiscoveryClient] intentTypes query failed:', error);
      throw error;
    }
  }

  /**
   * Fetch task types from the discovery GraphQL endpoint (best-effort).
   * Returns [] if the backend does not expose `taskTypes`.
   */
  async taskTypes(params?: {
    key?: string;
    label?: string;
    limit?: number;
    offset?: number;
  }): Promise<DiscoveryTaskType[]> {
    const query = `
      query TaskTypes($key: String, $label: String, $limit: Int, $offset: Int) {
        taskTypes(key: $key, label: $label, limit: $limit, offset: $offset) {
          key
          label
          description
        }
      }
    `;
    try {
      const variables: Record<string, unknown> = {
        limit: typeof params?.limit === 'number' ? params.limit : 10000,
        offset: typeof params?.offset === 'number' ? params.offset : 0,
      };
      if (params?.key) variables.key = params.key;
      if (params?.label) variables.label = params.label;

      const data = await this.client.request<{ taskTypes?: DiscoveryTaskType[] }>(query, variables);
      return Array.isArray(data?.taskTypes) ? data.taskTypes : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Cannot query field "taskTypes"')) return [];
      if (/Cannot return null for non-nullable field\s+Query\.taskTypes\b/i.test(message)) return [];
      if (message.includes('SPARQL') || message.includes('MALFORMED QUERY')) {
        console.warn('[AIAgentDiscoveryClient] taskTypes SPARQL translation error (backend issue):', message);
        return [];
      }
      console.warn('[AIAgentDiscoveryClient] taskTypes query failed:', error);
      throw error;
    }
  }

  /**
   * Fetch intent-task mappings from the discovery GraphQL endpoint (best-effort).
   * Returns [] if the backend does not expose `intentTaskMappings`.
   */
  async intentTaskMappings(params?: {
    intentKey?: string;
    taskKey?: string;
    limit?: number;
    offset?: number;
  }): Promise<DiscoveryIntentTaskMapping[]> {
    const query = `
      query IntentTaskMappings($intentKey: String, $taskKey: String, $limit: Int, $offset: Int) {
        intentTaskMappings(intentKey: $intentKey, taskKey: $taskKey, limit: $limit, offset: $offset) {
          intent { key label description }
          task { key label description }
          requiredSkills
          optionalSkills
        }
      }
    `;
    try {
      const variables: Record<string, unknown> = {
        limit: typeof params?.limit === 'number' ? params.limit : 10000,
        offset: typeof params?.offset === 'number' ? params.offset : 0,
      };
      if (params?.intentKey) variables.intentKey = params.intentKey;
      if (params?.taskKey) variables.taskKey = params.taskKey;

      const data = await this.client.request<{ intentTaskMappings?: DiscoveryIntentTaskMapping[] }>(query, variables);
      return Array.isArray(data?.intentTaskMappings) ? data.intentTaskMappings : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Cannot query field "intentTaskMappings"')) return [];
      if (/Cannot return null for non-nullable field\s+Query\.intentTaskMappings\b/i.test(message)) return [];
      if (message.includes('SPARQL') || message.includes('MALFORMED QUERY')) {
        console.warn('[AIAgentDiscoveryClient] intentTaskMappings SPARQL translation error (backend issue):', message);
        return [];
      }
      console.warn('[AIAgentDiscoveryClient] intentTaskMappings query failed:', error);
      throw error;
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
                agentName
                agentAccount
                agentIdentityOwnerAccount
                eoaAgentIdentityOwnerAccount
                eoaAgentAccount
                agentCategory
                didIdentity
                didAccount
                didName
                agentUri
                createdAtBlock
                createdAtTime
                updatedAtTime
                type
                description
                image
                a2aEndpoint
                did
                mcp
                x402support
                active
                supportedTrust
                rawJson
                agentCardJson
                agentCardReadAt
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
      agentName
      agentAccount
      agentIdentityOwnerAccount
      eoaAgentIdentityOwnerAccount
      eoaAgentAccount
      agentCategory
      didIdentity
      didAccount
      didName
      agentUri
      createdAtBlock
      createdAtTime
      updatedAtTime
      type
      description
      image
      a2aEndpoint
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
              agentName
              agentIdentityOwnerAccount
              eoaAgentIdentityOwnerAccount
              eoaAgentAccount
              agentCategory
              didIdentity
              didAccount
              didName
              agentUri
              createdAtBlock
              createdAtTime
              updatedAtTime
              type
              description
              image
              a2aEndpoint
              did
              mcp
              x402support
              active
              supportedTrust
              rawJson
              agentCardJson
              agentCardReadAt
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
    orderBy?:
      | 'agentId'
      | 'agentName'
      | 'createdAtTime'
      | 'createdAtBlock'
      | 'agentIdentityOwnerAccount'
      | 'eoaAgentIdentityOwnerAccount'
      | 'eoaAgentAccount'
      | 'agentCategory'
      | 'trustLedgerScore'
      | 'trustLedgerBadgeCount'
      | 'trustLedgerOverallRank'
      | 'trustLedgerCapabilityRank';
    orderDirection?: 'ASC' | 'DESC';
  }): Promise<{ agents: AgentData[]; total: number; hasMore: boolean }> {
    const query = `
      query KbAgents(
        $where: KbAgentWhereInput
        $first: Int
        $skip: Int
        $orderBy: KbAgentOrderBy
        $orderDirection: OrderDirection
      ) {
        kbAgents(
          where: $where
          first: $first
          skip: $skip
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          agents {
            ${this.buildKbAgentSelection()}
          }
          total
          hasMore
        }
      }
    `;

    // Default ordering when not explicitly provided: newest agents first
    // by agentId DESC.
    const effectiveOrderDirection: 'ASC' | 'DESC' =
      (options.orderDirection ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Map legacy orderBy to KB orderBy.
    const effectiveOrderByKb: 'agentId8004' | 'agentName' | 'uaid' =
      options.orderBy === 'agentName' ? 'agentName' : 'agentId8004';

    const whereIn = (options.where ?? {}) as Record<string, unknown>;
    const kbWhere: Record<string, unknown> = {};
    // chainId: v1 can provide chainId or chainId_in.
    if (typeof whereIn.chainId === 'number') kbWhere.chainId = whereIn.chainId;
    if (!('chainId' in kbWhere) && Array.isArray(whereIn.chainId_in) && whereIn.chainId_in.length === 1) {
      const v = whereIn.chainId_in[0];
      if (typeof v === 'number') kbWhere.chainId = v;
    }

    // agentId: v1 can provide agentId or agentId_in.
    const agentIdCandidate =
      typeof whereIn.agentId === 'string' || typeof whereIn.agentId === 'number'
        ? whereIn.agentId
        : Array.isArray(whereIn.agentId_in) && whereIn.agentId_in.length === 1
          ? whereIn.agentId_in[0]
          : undefined;
    if (typeof agentIdCandidate === 'string' || typeof agentIdCandidate === 'number') {
      const n = Number(agentIdCandidate);
      if (Number.isFinite(n)) kbWhere.agentId8004 = Math.floor(n);
    }

    // did: v1 can provide did/didIdentity or did_contains_nocase.
    const didCandidate =
      (typeof whereIn.didIdentity === 'string' && whereIn.didIdentity) ||
      (typeof whereIn.did === 'string' && whereIn.did) ||
      (typeof (whereIn as any).did_contains_nocase === 'string' && (whereIn as any).did_contains_nocase) ||
      undefined;
    if (typeof didCandidate === 'string' && didCandidate.trim().startsWith('did:')) {
      kbWhere.did8004 = didCandidate.trim();
    }

    // agentName: v1 commonly uses agentName_contains_nocase.
    const nameCandidate =
      (typeof whereIn.agentName_contains === 'string' && whereIn.agentName_contains) ||
      (typeof whereIn.agentName === 'string' && whereIn.agentName) ||
      (typeof (whereIn as any).agentName_contains_nocase === 'string' && (whereIn as any).agentName_contains_nocase) ||
      undefined;
    if (typeof nameCandidate === 'string' && nameCandidate.trim()) {
      kbWhere.agentName_contains = nameCandidate.trim();
    }

    // A2A: v1 uses hasA2aEndpoint or a2aEndpoint_not: null.
    const hasA2aEndpoint =
      (typeof (whereIn as any).hasA2aEndpoint === 'boolean' && (whereIn as any).hasA2aEndpoint) ||
      ((whereIn as any).a2aEndpoint_not === null);
    if (hasA2aEndpoint) {
      kbWhere.hasA2a = true;
    }

    // Smart agent: v1 may provide isSmartAgent.
    if (typeof (whereIn as any).isSmartAgent === 'boolean') {
      kbWhere.isSmartAgent = (whereIn as any).isSmartAgent;
    }

    const variables: Record<string, unknown> = {
      where: Object.keys(kbWhere).length ? kbWhere : undefined,
      first: typeof options.first === 'number' ? options.first : undefined,
      skip: typeof options.skip === 'number' ? options.skip : undefined,
      orderBy: effectiveOrderByKb,
      orderDirection: effectiveOrderDirection,
    };

    const data = await this.client.request<{
      kbAgents?: {
        agents?: KbAgent[];
        total?: number;
        hasMore?: boolean;
      };
    }>(query, variables);

    const result = data.kbAgents ?? { agents: [], total: 0, hasMore: false };
    const agents = (result.agents ?? []).map((agent) => this.mapKbAgentToAgentData(agent));

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
   * Uses agentMetadata_collection (The Graph subgraph) or agentMetadata (custom schema) query
   * to get all metadata key-value pairs. Tries subgraph format first, falls back to custom schema.
   * Handles pagination if an agent has more than 1000 metadata entries
   * @param chainId - Chain ID
   * @param agentId - Agent ID
   * @returns Record of all metadata key-value pairs, or null if not available
   */
  /**
   * @deprecated Use getAllAgentMetadata instead. This method name is misleading.
   */
  async getTokenMetadata(chainId: number, agentId: number | string): Promise<Record<string, string> | null> {
    return this.getAllAgentMetadata(chainId, agentId);
  }

  /**
   * Get all agent metadata entries from the discovery GraphQL backend.
   * Uses agentMetadata_collection (The Graph subgraph) or agentMetadata (custom schema) query.
   * Tries subgraph format first, falls back to custom schema.
   * Handles pagination if an agent has more than 1000 metadata entries.
   * @param chainId - Chain ID
   * @param agentId - Agent ID
   * @returns Record of all metadata key-value pairs, or null if not available
   */
  async getAllAgentMetadata(chainId: number, agentId: number | string): Promise<Record<string, string> | null> {
    // If we already learned the GraphQL schema doesn't support this query field,
    // skip to avoid repeated GRAPHQL_VALIDATION_FAILED warnings.
    if (this.tokenMetadataCollectionSupported === false) {
      return null;
    }

    // Try The Graph subgraph format first (agentMetadata_collection with agent_ filter)
    // Then fallback to custom schema format (agentMetadata query)
    const metadata: Record<string, string> = {};
    const pageSize = 1000; // The Graph's default page size
    let skip = 0;
    let hasMore = true;
    let useSubgraphFormat = true; // Try subgraph format first

    while (hasMore) {
      let query: string;
      let variables: any;
      let data: any;

      if (useSubgraphFormat) {
        // The Graph subgraph format: agentMetadata_collection with agent_ filter
        query = `
          query GetTokenMetadata($where: AgentMetadata_filter, $first: Int, $skip: Int) {
            agentMetadata_collection(
              where: $where
              first: $first
              skip: $skip
              orderBy: blockNumber
              orderDirection: asc
            ) {
              id
              key
              value
              valueText
              indexedKey
              blockNumber
              agent {
                id
              }
            }
          }
        `;
        variables = {
          where: {
            agent_: {
              id: String(agentId),
            },
          },
          first: pageSize,
          skip: skip,
        };
      } else {
        // Custom schema format: agentMetadata query
        query = `
          query GetTokenMetadata($where: AgentMetadataWhereInput, $first: Int, $skip: Int) {
            agentMetadata(
              where: $where
              first: $first
              skip: $skip
            ) {
              entries {
                key
                value
                valueText
                id
                indexedKey
              }
              total
              hasMore
            }
          }
        `;
        variables = {
          where: {
            chainId,
            agentId: String(agentId),
          },
          first: pageSize,
          skip: skip,
        };
      }

      try {
        data = await this.client.request(query, variables);

        if (useSubgraphFormat) {
          // Handle subgraph format response
          if (!data.agentMetadata_collection || !Array.isArray(data.agentMetadata_collection)) {
            // Switch to custom schema format
            useSubgraphFormat = false;
            skip = 0; // Reset skip for new format
            continue;
          }

          // Add entries from this page
          for (const entry of data.agentMetadata_collection) {
            // Extract key from id (format: "agentId-key") or use key field if available
            let metadataKey: string | undefined;
            if (entry.key) {
              metadataKey = entry.key;
            } else if (entry.id) {
              // Extract key from id like "276-agentAccount" -> "agentAccount"
              const parts = entry.id.split('-');
              if (parts.length > 1) {
                metadataKey = parts.slice(1).join('-');
              }
            }
            
            if (metadataKey) {
              // Prefer valueText over value (valueText is the decoded string, value may be hex)
              const entryValue = entry.valueText ?? entry.value;
              if (entryValue) {
                metadata[metadataKey] = entryValue;
              }
            }
          }

          // Check if we got a full page (might have more)
          hasMore = data.agentMetadata_collection.length === pageSize;
        } else {
          // Handle custom schema format response
          if (!data.agentMetadata?.entries || !Array.isArray(data.agentMetadata.entries)) {
            hasMore = false;
            break;
          }

          // Add entries from this page
          for (const entry of data.agentMetadata.entries) {
            if (entry.key) {
              // Prefer valueText over value (valueText is the decoded string, value may be hex)
              const entryValue = entry.valueText ?? entry.value;
              if (entryValue) {
                metadata[entry.key] = entryValue;
              }
            }
          }

          // Check if we got a full page (might have more)
          hasMore = data.agentMetadata.hasMore === true && data.agentMetadata.entries.length === pageSize;
        }
        
        skip += pageSize;

        // Safety check: The Graph has a max skip of 5000
        // If we've reached that, we can't fetch more (unlikely for a single agent)
        if (skip >= 5000) {
          console.warn(`[AIAgentDiscoveryClient.getTokenMetadata] Reached The Graph skip limit (5000) for agent ${agentId}`);
          hasMore = false;
        }
      } catch (error) {
        // If agentMetadata_collection fails, try custom schema format (agentMetadata query)
        const responseErrors = (error as any)?.response?.errors;
        const schemaDoesNotSupportCollection =
          Array.isArray(responseErrors) &&
          responseErrors.some(
            (e: any) =>
              typeof e?.message === 'string' &&
              (e.message.includes('agentMetadata_collection') || e.message.includes('AgentMetadata_filter')) &&
              (e?.extensions?.code === 'GRAPHQL_VALIDATION_FAILED' ||
                e.message.includes('Cannot query field')),
          );

        if (schemaDoesNotSupportCollection) {
          // Fallback to custom schema format
          const customResult = await this.getTokenMetadataCustomSchema(chainId, agentId);
          if (customResult) {
            return customResult;
          }
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
        // Try custom schema as fallback
        return this.getTokenMetadataCustomSchema(chainId, agentId);
      }
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  /**
   * Fallback method: Uses agentMetadata query (custom schema format) to get all metadata key-value pairs
   * @param chainId - Chain ID
   * @param agentId - Agent ID
   * @returns Record of all metadata key-value pairs, or null if not available
   */
  private async getTokenMetadataCustomSchema(chainId: number, agentId: number | string): Promise<Record<string, string> | null> {
    const metadata: Record<string, string> = {};
    const pageSize = 1000;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const query = `
        query GetTokenMetadata($where: AgentMetadataWhereInput, $first: Int, $skip: Int) {
          agentMetadata(
            where: $where
            first: $first
            skip: $skip
          ) {
            entries {
              key
              value
              valueText
              id
              indexedKey
            }
            total
            hasMore
          }
        }
      `;

      try {
        const data = await this.client.request<{
          agentMetadata?: {
            entries?: Array<{
              key: string;
              value?: string | null;
              valueText?: string | null;
              id?: string;
              indexedKey?: string | null;
            }>;
            total?: number;
            hasMore?: boolean;
          };
        }>(query, {
          where: {
            chainId,
            agentId: String(agentId),
          },
          first: pageSize,
          skip: skip,
        });

        if (!data.agentMetadata?.entries || !Array.isArray(data.agentMetadata.entries)) {
          hasMore = false;
          break;
        }

        for (const entry of data.agentMetadata.entries) {
          if (entry.key) {
            const entryValue = entry.valueText ?? entry.value;
            if (entryValue) {
              metadata[entry.key] = entryValue;
            }
          }
        }

        hasMore = data.agentMetadata.hasMore === true && data.agentMetadata.entries.length === pageSize;
        skip += pageSize;

        if (skip >= 5000) {
          console.warn(`[AIAgentDiscoveryClient.getTokenMetadataCustomSchema] Reached skip limit (5000) for agent ${agentId}`);
          hasMore = false;
        }
      } catch (error) {
        console.warn('[AIAgentDiscoveryClient.getTokenMetadataCustomSchema] Error:', error);
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
    const id = typeof agentId === 'number' ? agentId : Number.parseInt(String(agentId), 10);
    if (!Number.isFinite(id)) {
      return null;
    }

    const query = `
      query KbAgent($chainId: Int!, $agentId8004: Int!) {
        kbAgent(chainId: $chainId, agentId8004: $agentId8004) {
          ${this.buildKbAgentSelection()}
        }
      }
    `;

    try {
      const data = await this.client.request<{ kbAgent?: KbAgent | null }>(query, {
        chainId,
        agentId8004: id,
      });

      if (!data.kbAgent) return null;
      return this.mapKbAgentToAgentData(data.kbAgent);
    } catch (error) {
      console.warn('[AIAgentDiscoveryClient.getAgent] kbAgent query failed, trying kbAgents fallback:', error);
    }

    const fallback = `
      query KbAgentsFallback($where: KbAgentWhereInput, $first: Int) {
        kbAgents(where: $where, first: $first, orderBy: agentId8004, orderDirection: DESC) {
          agents { ${this.buildKbAgentSelection()} }
          total
          hasMore
        }
      }
    `;

    try {
      const data = await this.client.request<{ kbAgents?: KbAgentSearchResult }>(fallback, {
        where: { chainId, agentId8004: id },
        first: 1,
      });
      const agent = data?.kbAgents?.agents?.[0];
      return agent ? this.mapKbAgentToAgentData(agent) : null;
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.getAgent] kbAgents fallback failed:', error);
      return null;
    }
  }

  async getAgentByName(agentName: string): Promise<AgentData | null> {
    const trimmed = agentName?.trim();
    if (!trimmed) return null;

    const query = `
      query KbAgentsByName($where: KbAgentWhereInput, $first: Int) {
        kbAgents(where: $where, first: $first, orderBy: agentId8004, orderDirection: DESC) {
          agents { ${this.buildKbAgentSelection()} }
          total
          hasMore
        }
      }
    `;

    try {
      const data = await this.client.request<{ kbAgents?: KbAgentSearchResult }>(query, {
        where: { agentName_contains: trimmed },
        first: 20,
      });

      const list = data?.kbAgents?.agents ?? [];
      if (!list.length) return null;

      const exact =
        list.find((a) => String(a.agentName ?? '').toLowerCase() === trimmed.toLowerCase()) ??
        list[0];

      return exact ? this.mapKbAgentToAgentData(exact) : null;
    } catch (error) {
      console.error('[AIAgentDiscoveryClient.getAgentByName] Error fetching agent:', error);
      return null;
    }
  }

  /**
   * Resolve a single agent by UAID (KB v2).
   */
  async getAgentByUaid(uaid: string): Promise<AgentData | null> {
    const trimmed = String(uaid ?? '').trim();
    if (!trimmed) return null;

    const query = `
      query KbAgentByUaid($where: KbAgentWhereInput, $first: Int) {
        kbAgents(where: $where, first: $first, orderBy: agentId8004, orderDirection: DESC) {
          agents { ${this.buildKbAgentSelection()} }
          total
          hasMore
        }
      }
    `;

    const data = await this.gqlRequest<{ kbAgents: KbAgentSearchResult }>(query, {
      where: { uaid: trimmed },
      first: 1,
    });

    const agent = data?.kbAgents?.agents?.[0];
    return agent ? this.mapKbAgentToAgentData(agent) : null;
  }

  /**
   * Search agents by name
   * @param searchTerm - Search term to match against agent names
   * @param limit - Maximum number of results
   * @returns List of matching agents
   */
  async searchAgents(searchTerm: string, limit?: number): Promise<AgentData[]> {
    const query = `
      query SearchAgents($query: String!, $limit: Int) {
        searchAgents(query: $query, limit: $limit) {
          chainId
          agentId
          agentAccount
          agentName
          agentIdentityOwnerAccount
          eoaAgentIdentityOwnerAccount
          eoaAgentAccount
          agentCategory
          didIdentity
          didAccount
          didName
          agentUri
          createdAtBlock
          createdAtTime
          updatedAtTime
          type
          description
          image
          a2aEndpoint
          did
          mcp
          x402support
          active
          supportedTrust
          rawJson
          agentCardJson
          agentCardReadAt
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
        query: searchTerm,
        limit: limit || 100,
      });

      const agents = data.searchAgents || [];
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
      orderBy?:
        | 'agentId'
        | 'agentName'
        | 'createdAtTime'
        | 'createdAtBlock'
        | 'agentIdentityOwnerAccount'
        | 'eoaAgentIdentityOwnerAccount'
        | 'eoaAgentAccount'
        | 'agentCategory'
        | 'trustLedgerScore'
        | 'trustLedgerBadgeCount'
        | 'trustLedgerOverallRank'
        | 'trustLedgerCapabilityRank';
      orderDirection?: 'ASC' | 'DESC';
    }
  ): Promise<AgentData[]> {
    if (!eoaAddress || typeof eoaAddress !== 'string' || !eoaAddress.startsWith('0x')) {
      throw new Error('Invalid EOA address. Must be a valid Ethereum address starting with 0x');
    }

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? 'agentId';
    const orderDirection = options?.orderDirection ?? 'DESC';

    const effectiveOrderDirection: 'ASC' | 'DESC' =
      (orderDirection ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const orderByKb: 'agentId8004' | 'agentName' | 'uaid' =
      orderBy === 'agentName' ? 'agentName' : 'agentId8004';

    const query = `
      query KbOwnedAgentsAllChains(
        $ownerAddress: String!
        $first: Int
        $skip: Int
        $orderBy: KbAgentOrderBy
        $orderDirection: OrderDirection
      ) {
        kbOwnedAgentsAllChains(
          ownerAddress: $ownerAddress
          first: $first
          skip: $skip
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          agents { ${this.buildKbAgentSelection()} }
          total
          hasMore
        }
      }
    `;

    const data = await this.gqlRequest<{ kbOwnedAgentsAllChains: KbAgentSearchResult }>(query, {
      ownerAddress: eoaAddress,
      first: limit,
      skip: offset,
      orderBy: orderByKb,
      orderDirection: effectiveOrderDirection,
    });

    const list = data?.kbOwnedAgentsAllChains?.agents ?? [];
    return list.map((a) => this.mapKbAgentToAgentData(a));
  }

  /**
   * UAID-native ownership check (KB v2).
   */
  async isOwnerByUaid(uaid: string, walletAddress: string): Promise<boolean> {
    const u = String(uaid ?? '').trim();
    const w = String(walletAddress ?? '').trim();
    if (!u || !w) return false;

    const query = `
      query KbIsOwner($uaid: String!, $walletAddress: String!) {
        kbIsOwner(uaid: $uaid, walletAddress: $walletAddress)
      }
    `;

    const data = await this.gqlRequest<{ kbIsOwner?: boolean }>(query, {
      uaid: u,
      walletAddress: w,
    });

    return Boolean(data?.kbIsOwner);
  }
}

