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
  onchainMetadataJson?: string | null;
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

export type KbAssertionsSummary = {
  reviewResponses?: { total: number } | null;
  validationResponses?: { total: number } | null;
  /** @deprecated use reviewResponses */
  feedback8004?: { total: number } | null;
  /** @deprecated use validationResponses */
  validation8004?: { total: number } | null;
  total?: number | null;
};

export type KbAgent = {
  iri: string;
  uaid?: string | null;
  agentName?: string | null;
  agentTypes: string[];
  did8004?: string | null;
  agentId8004?: number | null;
  isSmartAgent: boolean;
  createdAtBlock?: number | null;
  createdAtTime?: number | string | null;
  updatedAtTime?: number | string | null;
  assertions?: KbAssertionsSummary | null;
  /** Primary identity (GraphDB KB v2); prefer identity8004/identityEns when absent */
  identity?: KbIdentity | null;
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
    kind?: string;
    fields?: TypeField[];
    inputFields?: TypeField[];
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
      kind
      fields {
        name
        type {
          ...TypeRef
        }
      }
      inputFields {
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

/** Review assertion item (was FeedbackData; renamed to align with schema review/validation) */
export interface ReviewData {
  id?: string;
  agentId?: string | number;
  clientAddress?: string;
  score?: number;
  feedbackUri?: string;
  /** JSON payload; schema field is `json` */
  reviewJson?: string;
  comment?: string;
  ratingPct?: number;
  txHash?: string;
  blockNumber?: number;
  timestamp?: string | number;
  isRevoked?: boolean;
  responseCount?: number;
  [key: string]: unknown;
}

/** @deprecated use ReviewData */
export type FeedbackData = ReviewData;

export interface SearchReviewsAdvancedOptions {
  uaid: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

/** @deprecated use SearchReviewsAdvancedOptions with uaid (build uaid from did:8004:chainId:agentId) */
export interface SearchFeedbackAdvancedOptions {
  uaid?: string;
  chainId?: number;
  agentId?: string | number;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

export interface SearchValidationRequestsAdvancedOptions {
  uaid: string;
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
        // GraphDB-backed KB may expose kbAgentByUaid instead of kbAgent(chainId, agentId8004).
        const hasAgentLookup = names.has('kbAgent') || names.has('kbAgentByUaid');
        const ok = names.has('kbAgents') && hasAgentLookup && (names.has('kbSemanticAgentSearch') || names.has('kbAgents'));
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

    const toFiniteNumberOrUndefined = (value: unknown): number | undefined => {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    };

    const parseDid8004Parts = (did: unknown): { chainId?: number; agentId?: number } => {
      if (typeof did !== 'string') return {};
      const trimmed = did.trim();
      // did:8004:<chainId>:<agentId>
      const parts = trimmed.split(':');
      if (parts.length >= 4 && parts[0] === 'did' && parts[1] === '8004') {
        const chainId = Number(parts[2]);
        const agentId = Number(parts[3]);
        return {
          chainId: Number.isFinite(chainId) ? chainId : undefined,
          agentId: Number.isFinite(agentId) ? agentId : undefined,
        };
      }
      return {};
    };

    const parseUaidDid8004Parts = (uaid: unknown): { chainId?: number; agentId?: number } => {
      if (typeof uaid !== 'string') return {};
      const trimmed = uaid.trim();
      // UAID did-target form: uaid:did:<methodSpecificId>;...
      if (!trimmed.startsWith('uaid:did:')) return {};
      const rest = trimmed.slice('uaid:did:'.length);
      const msid = rest.split(';')[0] ?? '';
      // For did:8004 target, msid looks like: 8004:<chainId>:<agentId>
      const parts = msid.split(':');
      if (parts.length >= 3 && parts[0] === '8004') {
        const chainId = Number(parts[1]);
        const agentId = Number(parts[2]);
        return {
          chainId: Number.isFinite(chainId) ? chainId : undefined,
          agentId: Number.isFinite(agentId) ? agentId : undefined,
        };
      }
      return {};
    };

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
    const chainIdFromAccounts =
      (typeof a.agentAccount?.chainId === 'number' ? a.agentAccount?.chainId : null) ??
      (typeof a.agentWalletAccount?.chainId === 'number' ? a.agentWalletAccount?.chainId : null) ??
      (typeof a.agentOwnerEOAAccount?.chainId === 'number' ? a.agentOwnerEOAAccount?.chainId : null) ??
      (typeof a.identityOwnerAccount?.chainId === 'number' ? a.identityOwnerAccount?.chainId : null) ??
      (typeof a.identityWalletAccount?.chainId === 'number' ? a.identityWalletAccount?.chainId : null) ??
      null;

    const chainId =
      chainIdFromAccounts ??
      parseDid8004Parts(did8004).chainId ??
      parseUaidDid8004Parts(a.uaid).chainId ??
      null;

    const agentIdFromParsed =
      parseDid8004Parts(did8004).agentId ??
      parseUaidDid8004Parts(a.uaid).agentId ??
      undefined;

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

    // Pull on-chain metadata JSON (for Info card) where available.
    const onchainMetadataJson =
      (typeof a.identity8004?.descriptor?.onchainMetadataJson === 'string' &&
      a.identity8004.descriptor.onchainMetadataJson.trim()
        ? a.identity8004.descriptor.onchainMetadataJson
        : null) ??
      (typeof a.identityEns?.descriptor?.onchainMetadataJson === 'string' &&
      a.identityEns.descriptor.onchainMetadataJson.trim()
        ? a.identityEns.descriptor.onchainMetadataJson
        : null) ??
      null;

    // Pull registration URI from onchain metadata if present (KB-backed, not on-chain call).
    // Per UAID migration: expect a single canonical field name `agentUri`.
    const agentUriFromOnchainMetadata = (() => {
      const candidates = [
        a.identity8004?.descriptor?.onchainMetadataJson,
        a.identityEns?.descriptor?.onchainMetadataJson,
      ];
      for (const raw of candidates) {
        if (typeof raw !== 'string' || !raw.trim()) continue;
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const v = typeof parsed.agentUri === 'string' ? parsed.agentUri.trim() : '';
          if (v) return v;
        } catch {
          // ignore parse errors
        }
      }
      return null;
    })();

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

    // Assertions totals: prefer reviewResponses/validationResponses; fallback to legacy names
    const feedbackCount =
      toFiniteNumberOrUndefined(a.assertions?.reviewResponses?.total) ??
      toFiniteNumberOrUndefined(a.assertions?.feedback8004?.total) ??
      toFiniteNumberOrUndefined((a as any).assertionsFeedback8004?.total) ??
      toFiniteNumberOrUndefined((a as any).assertions_feedback8004?.total);

    const validationTotal =
      toFiniteNumberOrUndefined(a.assertions?.validationResponses?.total) ??
      toFiniteNumberOrUndefined(a.assertions?.validation8004?.total) ??
      toFiniteNumberOrUndefined((a as any).assertionsValidation8004?.total) ??
      toFiniteNumberOrUndefined((a as any).assertions_validation8004?.total);

    const normalized: AgentData = {
      agentId: agentId8004 ?? agentIdFromParsed ?? undefined,
      uaid:
        typeof a.uaid === 'string' && a.uaid.trim().startsWith('uaid:')
          ? a.uaid.trim()
          : null,
      agentName: typeof a.agentName === 'string' ? a.agentName : undefined,
      chainId: chainId ?? undefined,
      createdAtBlock: typeof a.createdAtBlock === 'number' ? a.createdAtBlock : undefined,
      createdAtTime:
        typeof a.createdAtTime === 'number'
          ? a.createdAtTime
          : a.createdAtTime != null
            ? Number(a.createdAtTime)
            : undefined,
      updatedAtTime:
        typeof a.updatedAtTime === 'number'
          ? a.updatedAtTime
          : a.updatedAtTime != null
            ? Number(a.updatedAtTime)
            : undefined,
      feedbackCount,
      // KB assertions only provide totals (not pending/requested breakdowns). Treat them as "completed".
      validationCompletedCount: validationTotal ?? undefined,
      validationPendingCount: validationTotal !== undefined ? 0 : undefined,
      validationRequestedCount: validationTotal ?? undefined,
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
      agentUri: agentUriFromOnchainMetadata ?? undefined,
      a2aEndpoint,
      mcp: hasMcp,
      rawJson,
      onchainMetadataJson,
      // Minimal capability hints
      active: true,
    };

    return this.normalizeAgent(normalized);
  }

  private kbAgentSelectionCache: { light?: string; full?: string } = {};
  private kbAgentSelectionPromise: { light?: Promise<string>; full?: Promise<string> } = {};

  private async getKbAgentSelection(options?: { includeIdentityAndAccounts?: boolean }): Promise<string> {
    const mode = options?.includeIdentityAndAccounts ? 'full' : 'light';
    const cached = this.kbAgentSelectionCache[mode];
    if (typeof cached === 'string') {
      return cached;
    }
    const inflight = this.kbAgentSelectionPromise[mode];
    if (inflight) {
      return inflight;
    }

    const base = `
      iri
      uaid
      agentName
      agentTypes
      did8004
      agentId8004
      isSmartAgent
      createdAtBlock
      createdAtTime
      updatedAtTime
    `;

    const identityAndAccounts = `
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

    this.kbAgentSelectionPromise[mode] = (async () => {
      try {
        const fields = await this.getTypeFields('KbAgent');
        const names = new Set((fields ?? []).map((f) => f?.name).filter(Boolean) as string[]);

        const assertionsParts: string[] = [];
        if (names.has('assertions')) {
          const rev = names.has('reviewResponses') ? 'reviewResponses' : 'feedback8004';
          const val = names.has('validationResponses') ? 'validationResponses' : 'validation8004';
          assertionsParts.push(`
            assertions {
              ${rev} { total }
              ${val} { total }
              total
            }
          `);
        }
        if (names.has('reviewAssertions')) {
          assertionsParts.push(`reviewAssertions { total }`);
        } else if (names.has('assertionsFeedback8004')) {
          assertionsParts.push(`assertionsFeedback8004 { total }`);
        }
        if (names.has('validationAssertions')) {
          assertionsParts.push(`validationAssertions { total }`);
        } else if (names.has('assertionsValidation8004')) {
          assertionsParts.push(`assertionsValidation8004 { total }`);
        }

        // Fallback: prefer new names, then legacy
        const assertionsBlock =
          assertionsParts.length > 0
            ? assertionsParts.join('\n')
            : `
              assertions {
                reviewResponses { total }
                validationResponses { total }
                total
              }
            `;

        const selection = [
          base,
          assertionsBlock,
          mode === 'full' ? identityAndAccounts : '',
        ]
          .filter((part) => typeof part === 'string' && part.trim().length > 0)
          .join('\n');

        this.kbAgentSelectionCache[mode] = selection;
        return selection;
      } catch {
        const selection = [
          base,
          `
            assertions {
              reviewResponses { total }
              validationResponses { total }
              total
            }
          `,
          mode === 'full' ? identityAndAccounts : '',
        ]
          .filter((part) => typeof part === 'string' && part.trim().length > 0)
          .join('\n');

        this.kbAgentSelectionCache[mode] = selection;
        return selection;
      } finally {
        this.kbAgentSelectionPromise[mode] = undefined;
      }
    })();

    return this.kbAgentSelectionPromise[mode] as Promise<string>;
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

    const selection = await this.getKbAgentSelection({ includeIdentityAndAccounts: false });
    const query = `
      query ListKbAgents($first: Int, $skip: Int) {
        kbAgents(first: $first, skip: $skip, orderBy: agentId8004, orderDirection: DESC) {
          agents { ${selection} }
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
   * NOTE: This expects the KB GraphQL schema. If the backend does not expose
   * `kbSemanticAgentSearch`, it will throw.
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

    const agentSelection = await this.getKbAgentSelection({ includeIdentityAndAccounts: false });
    const selection = `
      total
      matches {
        score
        matchReasons
        agent {
          ${agentSelection}
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
      throw error;
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
      if (message.includes('Cannot query field "oasfSkills"')) {
        throw new Error('Discovery KB schema missing Query.oasfSkills');
      }
      if (/Cannot return null for non-nullable field\s+Query\.oasfSkills\b/i.test(message)) {
        throw new Error('Discovery KB resolver bug: Query.oasfSkills returned null');
      }
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
        throw new Error('Discovery KB schema missing Query.oasfDomains');
      }
      if (/Cannot return null for non-nullable field\s+Query\.oasfDomains\b/i.test(message)) {
        throw new Error('Discovery KB resolver bug: Query.oasfDomains returned null');
      }
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
      if (message.includes('Cannot query field "intentTypes"')) {
        throw new Error('Discovery KB schema missing Query.intentTypes');
      }
      if (/Cannot return null for non-nullable field\s+Query\.intentTypes\b/i.test(message)) {
        throw new Error('Discovery KB resolver bug: Query.intentTypes returned null');
      }
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
      if (message.includes('Cannot query field "taskTypes"')) {
        throw new Error('Discovery KB schema missing Query.taskTypes');
      }
      if (/Cannot return null for non-nullable field\s+Query\.taskTypes\b/i.test(message)) {
        throw new Error('Discovery KB resolver bug: Query.taskTypes returned null');
      }
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
      if (message.includes('Cannot query field "intentTaskMappings"')) {
        throw new Error('Discovery KB schema missing Query.intentTaskMappings');
      }
      if (/Cannot return null for non-nullable field\s+Query\.intentTaskMappings\b/i.test(message)) {
        throw new Error('Discovery KB resolver bug: Query.intentTaskMappings returned null');
      }
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
    const selection = await this.getKbAgentSelection({ includeIdentityAndAccounts: false });
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
            ${selection}
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

    // Assertions: allow KB-native hasAssertions filter.
    if (typeof (whereIn as any).hasAssertions === 'boolean') {
      kbWhere.hasAssertions = (whereIn as any).hasAssertions;
    }

    // Aggregated assertion minimums (KB v2).
    // The v1 search layer expresses these as *_gte fields; map them onto KbAgentWhereInput.
    const minFeedback =
      typeof (whereIn as any).feedbackCount_gte === 'number'
        ? (whereIn as any).feedbackCount_gte
        : undefined;
    const minValidations =
      typeof (whereIn as any).validationCompletedCount_gte === 'number'
        ? (whereIn as any).validationCompletedCount_gte
        : undefined;
    const minAvgRating =
      typeof (whereIn as any).feedbackAverageScore_gte === 'number'
        ? (whereIn as any).feedbackAverageScore_gte
        : undefined;

    const hasNumericFiltersRequested =
      (typeof minFeedback === 'number' && Number.isFinite(minFeedback) && minFeedback > 0) ||
      (typeof minValidations === 'number' && Number.isFinite(minValidations) && minValidations > 0) ||
      (typeof minAvgRating === 'number' && Number.isFinite(minAvgRating) && minAvgRating > 0);

    const kbWhereFieldNames = hasNumericFiltersRequested
      ? new Set(
          (await this.getTypeFields('KbAgentWhereInput') ?? [])
            .map((f) => f?.name)
            .filter((name): name is string => typeof name === 'string' && name.length > 0),
        )
      : new Set<string>();

    const requireKbWhereField = (fieldName: string, context: string) => {
      if (!kbWhereFieldNames.has(fieldName)) {
        const hint = Array.from(kbWhereFieldNames)
          .filter((n) => /feedback|validation|score/i.test(n))
          .slice(0, 25);
        throw new Error(
          `[Discovery][graphql-kb] Unsupported filter (${context}). ` +
            `KbAgentWhereInput is missing field "${fieldName}". ` +
            `Available relevant fields: ${hint.join(', ') || '(none)'}`,
        );
      }
    };

    const pickKbWhereField = (candidates: string[]): string | null => {
      for (const name of candidates) {
        if (kbWhereFieldNames.has(name)) return name;
      }
      return null;
    };

    if (typeof minFeedback === 'number' && Number.isFinite(minFeedback) && minFeedback > 0) {
      requireKbWhereField('minReviewAssertionCount', 'minFeedbackCount');
      requireKbWhereField('hasReviews', 'minFeedbackCount');
      kbWhere.minReviewAssertionCount = Math.floor(minFeedback);
      kbWhere.hasReviews = true;
    }

    if (typeof minValidations === 'number' && Number.isFinite(minValidations) && minValidations > 0) {
      requireKbWhereField('minValidationAssertionCount', 'minValidationCompletedCount');
      requireKbWhereField('hasValidations', 'minValidationCompletedCount');
      kbWhere.minValidationAssertionCount = Math.floor(minValidations);
      kbWhere.hasValidations = true;
    }

    if (typeof minAvgRating === 'number' && Number.isFinite(minAvgRating) && minAvgRating > 0) {
      const chosen = pickKbWhereField([
        'minFeedbackAverageScore8004',
        'minFeedbackAverageScore',
        'feedbackAverageScore_gte',
      ]);

      if (!chosen) {
        const hint = Array.from(kbWhereFieldNames)
          .filter((n) => /review|feedback|score|average/i.test(n))
          .slice(0, 25);
        throw new Error(
          `[Discovery][graphql-kb] Unsupported filter (minFeedbackAverageScore). ` +
            `KbAgentWhereInput does not expose a review average score filter. ` +
            `Available relevant fields: ${hint.join(', ') || '(none)'}`,
        );
      }

      (kbWhere as any)[chosen] = minAvgRating;
      if (kbWhereFieldNames.has('hasReviews')) {
        kbWhere.hasReviews = true;
      }
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
      const kind = data.__type?.kind ?? null;
      const fields =
        kind === 'INPUT_OBJECT'
          ? (data.__type?.inputFields ?? null)
          : (data.__type?.fields ?? null);
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
    // Legacy metadata queries are removed. With KB v2, the client should use:
    // - registration JSON: identity*.descriptor.json (-> `rawJson`)
    // - info JSON: identity*.descriptor.onchainMetadataJson (-> `onchainMetadataJson`)
    // Or fall back to on-chain reads.
    void chainId;
    void agentId;
    return null;
  }

  /**
   * Fallback method: Uses agentMetadata query (custom schema format) to get all metadata key-value pairs
   * @param chainId - Chain ID
   * @param agentId - Agent ID
   * @returns Record of all metadata key-value pairs, or null if not available
   */
  private async getTokenMetadataCustomSchema(chainId: number, agentId: number | string): Promise<Record<string, string> | null> {
    // Legacy query removed.
    void chainId;
    void agentId;
    return null;
  }

  /**
   * Get a single agent by chainId+agentId (convenience).
   * Discovery is UAID-only: builds uaid and calls getAgentByUaid(uaid).
   */
  async getAgent(chainId: number, agentId: number | string): Promise<AgentData | null> {
    const id = typeof agentId === 'number' ? agentId : Number.parseInt(String(agentId), 10);
    if (!Number.isFinite(id)) return null;
    const uaid = `uaid:did:8004:${chainId}:${id}`;
    return this.getAgentByUaid(uaid);
  }

  async getAgentByName(agentName: string): Promise<AgentData | null> {
    const trimmed = agentName?.trim();
    if (!trimmed) return null;

    const selection = await this.getKbAgentSelection({ includeIdentityAndAccounts: false });
    const query = `
      query KbAgentsByName($where: KbAgentWhereInput, $first: Int) {
        kbAgents(where: $where, first: $first, orderBy: agentId8004, orderDirection: DESC) {
          agents { ${selection} }
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
   * Resolve a single agent by UAID (KB v2). UAID-only; no fallback to chainId/agentId.
   */
  async getAgentByUaid(uaid: string): Promise<AgentData | null> {
    const trimmed = String(uaid ?? '').trim();
    if (!trimmed) return null;

    const selection = await this.getKbAgentSelection({ includeIdentityAndAccounts: false });
    const query = `
      query KbAgentByUaid($uaid: String!) {
        kbAgentByUaid(uaid: $uaid) {
          ${selection}
        }
      }
    `;
    try {
      const data = await this.gqlRequest<{ kbAgentByUaid?: KbAgent | null }>(query, { uaid: trimmed });
      const agent = data?.kbAgentByUaid ?? null;
      return agent ? this.mapKbAgentToAgentData(agent) : null;
    } catch (error) {
      console.warn('[AIAgentDiscoveryClient.getAgentByUaid] kbAgentByUaid failed:', error);
      return null;
    }
  }

  /**
   * Resolve a single agent by UAID including identity/accounts (KB v2). UAID-only; no fallback.
   */
  async getAgentByUaidFull(uaid: string): Promise<AgentData | null> {
    const trimmed = String(uaid ?? '').trim();
    if (!trimmed) return null;

    const selection = await this.getKbAgentSelection({ includeIdentityAndAccounts: true });
    const query = `
      query KbAgentByUaidFull($uaid: String!) {
        kbAgentByUaid(uaid: $uaid) {
          ${selection}
        }
      }
    `;
    try {
      const data = await this.gqlRequest<{ kbAgentByUaid?: KbAgent | null }>(query, { uaid: trimmed });
      const agent = data?.kbAgentByUaid ?? null;
      return agent ? this.mapKbAgentToAgentData(agent) : null;
    } catch (error) {
      console.warn('[AIAgentDiscoveryClient.getAgentByUaidFull] kbAgentByUaid failed:', error);
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
   * Search validation requests for an agent by UAID (GraphQL kbAgentByUaid + validationAssertions)
   */
  async searchValidationRequestsAdvanced(
    options: SearchValidationRequestsAdvancedOptions,
  ): Promise<{ validationRequests: ValidationRequestData[] } | null> {
    const { uaid, limit = 10, offset = 0 } = options;
    const uaidTrimmed = typeof uaid === 'string' ? uaid.trim() : '';
    if (!uaidTrimmed) {
      throw new Error('uaid is required for searchValidationRequestsAdvanced');
    }

    const queryText = `
      query KbValidationAssertionsByUaid($uaid: String!, $first: Int, $skip: Int) {
        kbAgentByUaid(uaid: $uaid) {
          validationAssertions(first: $first, skip: $skip) {
            total
            items {
              iri
              agentDid8004
              json
              record { txHash blockNumber timestamp rawJson }
            }
          }
        }
      }
    `;
    const variables: Record<string, unknown> = {
      uaid: uaidTrimmed,
      first: typeof limit === 'number' ? limit : undefined,
      skip: typeof offset === 'number' ? offset : undefined,
    };
    const data = await this.client.request<any>(queryText, variables);
    const connection = data?.kbAgentByUaid?.validationAssertions;
    const items: any[] = Array.isArray(connection?.items) ? connection.items : [];

    const parseJson = (value: unknown): any | null => {
      if (typeof value !== 'string' || !value.trim()) return null;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };

    const toNumberOrUndefined = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
      return undefined;
    };

    const mapped: ValidationRequestData[] = items
      .filter(Boolean)
      .map((item: any) => {
        const iri = typeof item?.iri === 'string' ? item.iri : undefined;
        const record = item?.record ?? null;

        const recordTxHash = typeof record?.txHash === 'string' ? record.txHash : undefined;
        const recordBlockNumber = toNumberOrUndefined(record?.blockNumber);
        const recordTimestamp =
          typeof record?.timestamp === 'number' || typeof record?.timestamp === 'string'
            ? record.timestamp
            : undefined;

        const parsedTop = parseJson(item?.json);
        const parsedRecord = parseJson(record?.rawJson);
        const recordResponseJsonText = typeof parsedRecord?.responseJson === 'string' ? parsedRecord.responseJson : null;
        const parsedResponseJson = parseJson(recordResponseJsonText);

        const parsed = parsedTop ?? parsedResponseJson;

        const requestHash = typeof parsed?.requestHash === 'string' ? parsed.requestHash : undefined;
        const validatorAddress = typeof parsed?.validatorAddress === 'string' ? parsed.validatorAddress : undefined;
        const createdAt = typeof parsed?.createdAt === 'string' ? parsed.createdAt : undefined;

        const rawId =
          typeof parsedRecord?.id === 'string'
            ? parsedRecord.id
            : typeof parsed?.id === 'string'
              ? parsed.id
              : undefined;

        const agentDid = typeof item?.agentDid8004 === 'string' ? item.agentDid8004 : undefined;
        const didMatch = agentDid ? /^did:8004:(\d+):(\d+)$/.exec(agentDid) : null;
        const parsedAgentId = didMatch?.[2] != null ? parseInt(didMatch[2], 10) : undefined;
        return {
          iri,
          id: rawId ?? iri,
          agentId: parsedAgentId != null ? String(parsedAgentId) : undefined,
          agentId8004: parsedAgentId,
          validatorAddress,
          requestUri: iri,
          responseUri: iri,
          requestJson:
            typeof item?.json === 'string'
              ? item.json
              : typeof recordResponseJsonText === 'string'
                ? recordResponseJsonText
                : undefined,
          responseJson: recordResponseJsonText ?? undefined,
          requestHash,
          txHash: recordTxHash ?? (typeof parsedRecord?.txHash === 'string' ? parsedRecord.txHash : undefined),
          blockNumber:
            recordBlockNumber ??
            toNumberOrUndefined(parsedRecord?.blockNumber) ??
            toNumberOrUndefined(parsed?.blockNumber),
          timestamp:
            recordTimestamp ??
            (typeof parsedRecord?.timestamp === 'string' || typeof parsedRecord?.timestamp === 'number'
              ? parsedRecord.timestamp
              : undefined),
          createdAt,
        } as ValidationRequestData;
      });

    return { validationRequests: mapped };
  }

  /**
   * Search reviews for an agent by UAID (GraphQL kbAgentByUaid + reviewAssertions)
   */
  async searchReviewsAdvanced(
    options: SearchReviewsAdvancedOptions,
  ): Promise<{ reviews: ReviewData[] } | null> {
    const { uaid, limit = 10, offset = 0 } = options;
    const uaidTrimmed = typeof uaid === 'string' ? uaid.trim() : '';
    if (!uaidTrimmed) {
      throw new Error('uaid is required for searchReviewsAdvanced');
    }
    const queryText = `
      query KbReviewAssertionsByUaid($uaid: String!, $first: Int, $skip: Int) {
        kbAgentByUaid(uaid: $uaid) {
          reviewAssertions(first: $first, skip: $skip) {
            total
            items {
              iri
              agentDid8004
              json
              record { txHash blockNumber timestamp rawJson }
            }
          }
        }
      }
    `;
    const variables: Record<string, unknown> = {
      uaid: uaidTrimmed,
      first: typeof limit === 'number' ? limit : undefined,
      skip: typeof offset === 'number' ? offset : undefined,
    };
    const data = await this.client.request<any>(queryText, variables);
    const connection = data?.kbAgentByUaid?.reviewAssertions;
    const items: any[] = Array.isArray(connection?.items) ? connection.items : [];
    const parseJson = (value: unknown): any | null => {
      if (typeof value !== 'string' || !value.trim()) return null;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };
    const mapped: ReviewData[] = items
      .filter(Boolean)
      .map((item: any) => {
        const iri = typeof item?.iri === 'string' ? item.iri : undefined;
        const record = item?.record ?? null;
        const recordTxHash = typeof record?.txHash === 'string' ? record.txHash : undefined;
        const recordBlockNumber = typeof record?.blockNumber === 'number' ? record.blockNumber : undefined;
        const recordTimestamp = typeof record?.timestamp === 'number' ? record.timestamp : undefined;
        const parsedTop = parseJson(item?.json);
        const parsedRecord = parseJson(record?.rawJson);
        const parsedFeedbackJson = parseJson(parsedRecord?.feedbackJson);
        const clientAddress =
          typeof parsedRecord?.clientAddress === 'string'
            ? parsedRecord.clientAddress
            : typeof parsedFeedbackJson?.proofOfPayment?.fromAddress === 'string'
              ? parsedFeedbackJson.proofOfPayment.fromAddress
              : undefined;
        const scoreRaw =
          parsedTop?.score ??
          parsedTop?.rating ??
          parsedFeedbackJson?.score ??
          parsedFeedbackJson?.rating ??
          undefined;
        const score =
          typeof scoreRaw === 'number'
            ? scoreRaw
            : typeof scoreRaw === 'string' && scoreRaw.trim()
              ? Number(scoreRaw)
              : undefined;
        const comment =
          typeof parsedTop?.comment === 'string'
            ? parsedTop.comment
            : typeof parsedTop?.text === 'string'
              ? parsedTop.text
              : typeof parsedFeedbackJson?.comment === 'string'
                ? parsedFeedbackJson.comment
                : typeof parsedFeedbackJson?.text === 'string'
                  ? parsedFeedbackJson.text
                  : undefined;
        const agentDid = typeof item?.agentDid8004 === 'string' ? item.agentDid8004 : undefined;
        const didMatch = agentDid ? /^did:8004:(\d+):(\d+)$/.exec(agentDid) : null;
        const parsedAgentId = didMatch?.[2] != null ? parseInt(didMatch[2], 10) : undefined;
        return {
          iri,
          id: iri,
          agentId: parsedAgentId != null ? String(parsedAgentId) : undefined,
          clientAddress,
          score: Number.isFinite(score as number) ? (score as number) : undefined,
          comment,
          reviewJson: typeof item?.json === 'string' ? item.json : (typeof parsedRecord?.feedbackJson === 'string' ? parsedRecord.feedbackJson : undefined),
          txHash: recordTxHash ?? (typeof parsedRecord?.txHash === 'string' ? parsedRecord.txHash : undefined),
          blockNumber: recordBlockNumber ?? (typeof parsedRecord?.blockNumber === 'number' ? parsedRecord.blockNumber : undefined),
          timestamp: recordTimestamp ?? (typeof parsedRecord?.timestamp === 'number' ? parsedRecord.timestamp : undefined),
          isRevoked: typeof parsedRecord?.isRevoked === 'boolean' ? parsedRecord.isRevoked : undefined,
        } as ReviewData;
      });
    return { reviews: mapped };
  }

  /**
   * Search feedback/reviews for an agent (UAID or legacy chainId+agentId). Prefer searchReviewsAdvanced(uaid).
   */
  async searchFeedbackAdvanced(
    options: SearchFeedbackAdvancedOptions,
  ): Promise<{ feedbacks: FeedbackData[] } | null> {
    const { uaid, chainId, agentId, limit = 10, offset = 0 } = options;
    let uaidResolved: string;
    if (typeof uaid === 'string' && uaid.trim()) {
      uaidResolved = uaid.trim();
    } else if (
      typeof chainId === 'number' &&
      Number.isFinite(chainId) &&
      (typeof agentId === 'number' || (typeof agentId === 'string' && agentId.trim()))
    ) {
      const aid = typeof agentId === 'number' ? agentId : parseInt(String(agentId), 10);
      if (!Number.isFinite(aid) || aid <= 0) {
        throw new Error(`Invalid agentId for searchFeedbackAdvanced: ${agentId}`);
      }
      uaidResolved = `did:8004:${chainId}:${aid}`;
    } else {
      throw new Error('searchFeedbackAdvanced requires uaid or (chainId and agentId)');
    }
    const res = await this.searchReviewsAdvanced({ uaid: uaidResolved, limit, offset });
    if (!res?.reviews) return null;
    const feedbacks: FeedbackData[] = res.reviews.map((r) => ({
      ...r,
      feedbackUri: r.feedbackUri,
      feedbackJson: r.reviewJson ?? (r as any).feedbackJson,
    }));
    return { feedbacks };
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

    const selection = await this.getKbAgentSelection({ includeIdentityAndAccounts: false });
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
          agents { ${selection} }
          total
          hasMore
        }
      }
    `;

    try {
      const data = await this.gqlRequest<{ kbOwnedAgentsAllChains: KbAgentSearchResult }>(query, {
        ownerAddress: eoaAddress,
        first: limit,
        skip: offset,
        orderBy: orderByKb,
        orderDirection: effectiveOrderDirection,
      });

      const list = data?.kbOwnedAgentsAllChains?.agents ?? [];
      return list.map((a) => this.mapKbAgentToAgentData(a));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Cannot return null for non-nullable field') && msg.includes('kbOwnedAgentsAllChains')) {
        console.warn('[AIAgentDiscoveryClient.getOwnedAgents] Backend returned null for kbOwnedAgentsAllChains (resolver bug); returning empty list.');
        return [];
      }
      throw error;
    }
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

