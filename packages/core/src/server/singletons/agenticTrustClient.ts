/**
 * AgenticTrust API Client
 * 
 * Client for interacting with the AgenticTrust GraphQL API
 */

import { GraphQLClient } from 'graphql-request';
import type { ApiClientConfig } from '../lib/types';
import { AgentsAPI } from '../lib/agents';
import type { DiscoverAgentsOptions, ListAgentsResponse } from '../lib/agents';
import { A2AProtocolProviderAPI } from '../lib/a2aProtocolProvider';
import { VeramoAPI, type AuthChallenge, type ChallengeVerificationResult } from '../lib/veramo';


import { getENSClient } from './ensClient';
import { getDiscoveryClient } from './discoveryClient';
import { getReputationRegistryClient, isReputationClientInitialized, resetReputationClient } from './reputationClient';
import { getIdentityRegistryClient } from '../singletons/identityClient';


import { isUserAppEnabled } from '../userApps/userApp';
import { createVeramoAgentForClient } from '../lib/veramoFactory';
import { getChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';
import { Agent, loadAgentDetail } from '../lib/agent';
import type { AgentDetail } from '../models/agentDetail';
import { createFeedbackAuth } from '../lib/agentFeedback';
import type { RequestAuthParams } from '../lib/agentFeedback';
import { parseDid8004 } from '@agentic-trust/8004-ext-sdk';

import type { SessionPackage } from '../../shared/sessionPackage';

type OwnerType = 'eoa' | 'aa';
type ExecutionMode = 'auto' | 'server' | 'client';

type CreateAgentBaseParams = {
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
  chainId?: number;
};

type CreateAgentEOAClientResult = Awaited<ReturnType<AgentsAPI['createAgentForEOA']>>;
type CreateAgentEOAServerResult = Awaited<ReturnType<AgentsAPI['createAgentForEOAPK']>>;
type CreateAgentAAClientResult = Awaited<ReturnType<AgentsAPI['createAgentForAA']>>;
type CreateAgentAAServerResult = Awaited<ReturnType<AgentsAPI['createAgentForAAPK']>>;

type CreateAgentResult =
  | CreateAgentEOAClientResult
  | CreateAgentEOAServerResult
  | CreateAgentAAClientResult
  | CreateAgentAAServerResult;

export class AgenticTrustClient {
  private graphQLClient: GraphQLClient;
  private config: ApiClientConfig;
  public agents: AgentsAPI;
  public a2aProtocolProvider: A2AProtocolProviderAPI;
  public veramo: VeramoAPI;




  private constructor(config: ApiClientConfig) {
    this.config = { ...config };
    
    // Construct GraphQL endpoint URL
    if (!config.graphQLUrl) {
      throw new Error(
        'graphQLUrl is required in ApiClientConfig. ' +
        'Set the AGENTIC_TRUST_DISCOVERY_URL environment variable (or provide graphQLUrl in config).'
      );
    }
    
    const endpoint = config.graphQLUrl.endsWith('/graphql')
      ? config.graphQLUrl
      : `${config.graphQLUrl.replace(/\/$/, '')}/graphql`;

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...config.headers,
    };

    // Add API key if provided
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    // Create GraphQL client
    this.graphQLClient = new GraphQLClient(endpoint, {
      headers,
    });

    // Initialize discovery client singleton with this client's config
    // This ensures the singleton uses the same configuration as this client
    // Initialize lazily (will be initialized when first used)
    import('./discoveryClient').then(({ getDiscoveryClient }) => {
      getDiscoveryClient({
        endpoint,
        apiKey: config.apiKey,
        headers: config.headers,
      }).catch((error) => {
        console.warn('Failed to initialize DiscoveryClient singleton:', error);
      });
    });

    // Initialize API namespaces
    this.agents = new AgentsAPI(this);
    this.a2aProtocolProvider = new A2AProtocolProviderAPI(this.graphQLClient);
    this.veramo = new VeramoAPI();

  }

  /**
   * Initialize the Veramo agent (internal method)
   * Called automatically during create() if not provided in config
   */
  private async initializeVeramoAgent(config: ApiClientConfig): Promise<void> {

    
    if (config.veramoAgent) {
      // Use provided agent
      this.veramo.connect(config.veramoAgent);
    } else {

      // Create agent internally
      const agent = await createVeramoAgentForClient(
        config.privateKey,
        config.rpcUrl
      );
      this.veramo.connect(agent);
    }
  }

  /**
   * Create a new AgenticTrust client instance
   */
  static async create(config: ApiClientConfig): Promise<AgenticTrustClient> {


    const client = new AgenticTrustClient(config);
    
    // Step 1: Initialize Veramo agent (always happens - either provided or created from privateKey)
    await client.initializeVeramoAgent(config);
    
    // Step 2: Initialize reputation client if configured
    // Priority: sessionPackage > reputation config > top-level config with identity/reputation registry
    if (config.sessionPackage) {
      console.log('🔧 create: Initializing reputation from session package...');
      await client.initializeReputationFromSessionPackage(config.sessionPackage as { filePath?: string; package?: SessionPackage; ensRegistry: `0x${string}` });
    } else if (config.identityRegistry && config.reputationRegistry) {
      // Initialize reputation from top-level config (identityRegistry and reputationRegistry)
      // Uses the EOA derived from privateKey (same as VeramoAgent)
      // Note: Reputation client requires private key for signing operations
      if (config.privateKey) {
        console.log('🔧 create: Initializing reputation from top-level config...');
        await client.initializeClientReputationFromConfig(config);
      } else {
      }
    } else {
    }

    // Step 3: Eagerly initialize core domain clients (best-effort)
    // so downstream calls don't pay first-call initialization cost.
    const defaultChainId = DEFAULT_CHAIN_ID;
    try {
      await Promise.allSettled([
        getDiscoveryClient(),                // discovery indexer
        getENSClient(defaultChainId),        // ENS client
        getIdentityRegistryClient(defaultChainId),   // identity client
        getReputationRegistryClient(defaultChainId), // reputation client
      ]);
    } catch {
      // Individual domain client initialization errors are logged
      // in their respective modules; we don't fail client creation.
    }

    return client;
  }

  /**
   * High-level agent search API exposed directly on the AgenticTrustClient.
   * This is a thin wrapper around AgentsAPI.searchAgents so that apps can call
   * client.searchAgents(...) instead of client.agents.searchAgents(...).
   */
  async searchAgents(
    options?: DiscoverAgentsOptions | string,
  ): Promise<ListAgentsResponse> {
    return this.agents.searchAgents(options as any);
  }

  /**
   * High-level feedbackAuth helper exposed directly on AgenticTrustClient.
   * This delegates to the shared server-side createFeedbackAuth implementation,
   * which uses the ReputationClient singleton and IdentityRegistry checks.
   */
  async createFeedbackAuth(params: RequestAuthParams): Promise<`0x${string}`> {
    return createFeedbackAuth(params);
  }

  /**
   * Fetch feedback entries for a given agent.
   *
   * Strategy:
   *  1. Try the discovery indexer's feedback search GraphQL API
   *     (e.g. searchFeedbacksGraph) when available.
   *  2. If that fails or is not supported, fall back to on-chain
   *     `readAllFeedback` on the ReputationRegistry via the ReputationClient.
   *
   * The return type is intentionally un-opinionated (`unknown[]`) so callers
   * can evolve their own view models without being tightly coupled to the
   * underlying indexer/contract schema.
   */
  async getAgentFeedback(params: {
    agentId: string;
    chainId?: number;
    clientAddresses?: string[];
    tag1?: string;
    tag2?: string;
    includeRevoked?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]> {
    const {
      agentId,
      chainId,
      clientAddresses,
      tag1,
      tag2,
      includeRevoked = false,
      limit,
      offset,
    } = params;

    const trimmed = (agentId ?? '').toString().trim();
    if (!trimmed) {
      throw new Error('agentId is required for getAgentFeedback');
    }

    const resolvedChainId =
      Number.isFinite(chainId ?? NaN) && (chainId ?? 0) > 0
        ? (chainId as number)
        : DEFAULT_CHAIN_ID;

    let agentIdBigInt: bigint;
    try {
      agentIdBigInt = BigInt(trimmed);
    } catch {
      throw new Error(`Invalid agentId for getAgentFeedback: ${agentId}`);
    }

    // 1. Try discovery indexer feedback search first (best-effort)
    try {
      const discoveryClient = await getDiscoveryClient();

      const query = `
        query SearchFeedbacksGraph(
          $where: FeedbackWhereInput
          $first: Int
          $skip: Int
        ) {
          searchFeedbacksGraph(
            where: $where
            first: $first
            skip: $skip
          ) {
            feedbacks {
              id
              agentId
              chainId
              clientAddress
              score
              tag1
              tag2
              feedbackUri
              feedbackHash
              isRevoked
            }
            total
            hasMore
          }
        }
      `;

      const variables: Record<string, unknown> = {
        where: {
          agentId: trimmed,
          chainId: resolvedChainId,
        },
        first: typeof limit === 'number' ? limit : 100,
        skip: typeof offset === 'number' ? offset : 0,
      };

      const result = await discoveryClient.request<{
        searchFeedbacksGraph?: {
          feedbacks?: unknown[];
          total?: number | null;
          hasMore?: boolean | null;
        };
      }>(query, variables);

      if (result && (result as any).searchFeedbacksGraph) {
        const node = (result as any).searchFeedbacksGraph;
        const list = Array.isArray(node.feedbacks) ? node.feedbacks : [];
        return list as unknown[];
      }
    } catch (error) {
      console.warn(
        '[AgenticTrustClient.getAgentFeedback] discovery feedback search failed; falling back to on-chain readAllFeedback:',
        error,
      );
    }

    // 2. Fallback: on-chain ReputationRegistry readAllFeedback
    const reputationClient = await getReputationRegistryClient(resolvedChainId);
    const raw = await (reputationClient as any).readAllFeedback(
      agentIdBigInt,
      clientAddresses,
      tag1,
      tag2,
      includeRevoked,
    );

    const clients: string[] = raw?.clientAddresses ?? [];
    const scores: number[] = raw?.scores ?? [];
    const tag1s: string[] = raw?.tag1s ?? [];
    const tag2s: string[] = raw?.tag2s ?? [];
    const revokedStatuses: boolean[] = raw?.revokedStatuses ?? [];

    const maxLen = Math.max(
      clients.length,
      scores.length,
      tag1s.length,
      tag2s.length,
      revokedStatuses.length,
    );

    const records: unknown[] = [];
    for (let i = 0; i < maxLen; i++) {
      records.push({
        agentId: trimmed,
        chainId: resolvedChainId,
        clientAddress: clients[i],
        score: scores[i],
        tag1: tag1s[i],
        tag2: tag2s[i],
        isRevoked: revokedStatuses[i],
        index: i,
      });
    }

    return records;
  }

  /**
   * Get aggregated reputation summary for an agentId from the on-chain
   * ReputationRegistry via the ReputationClient.
   */
  async getReputationSummary(params: {
    agentId: string;
    chainId?: number;
    clientAddresses?: string[];
    tag1?: string;
    tag2?: string;
  }): Promise<{ count: bigint; averageScore: number }> {
    const { agentId, chainId, clientAddresses, tag1, tag2 } = params;

    const trimmed = (agentId ?? '').toString().trim();
    if (!trimmed) {
      throw new Error('agentId is required for getReputationSummary');
    }

    const resolvedChainId =
      Number.isFinite(chainId ?? NaN) && (chainId ?? 0) > 0
        ? (chainId as number)
        : DEFAULT_CHAIN_ID;

    let agentIdBigInt: bigint;
    try {
      agentIdBigInt = BigInt(trimmed);
    } catch {
      throw new Error(`Invalid agentId for getReputationSummary: ${agentId}`);
    }

    const reputationClient = await getReputationRegistryClient(resolvedChainId);
    return (reputationClient as any).getSummary(
      agentIdBigInt,
      clientAddresses,
      tag1,
      tag2,
    );
  }

  /**
   * ENS helpers exposed via AgenticTrustClient so that apps do not talk to
   * the ENS singleton directly.
   */
  async isENSNameAvailable(
    ensName: string,
    chainId?: number,
  ): Promise<boolean | null> {
    const { isENSNameAvailable } = await import('./ensClient');
    return isENSNameAvailable(ensName, chainId);
  }

  async getENSInfo(
    ensName: string,
    chainId?: number,
  ): Promise<{
    name: string;
    chainId?: number;
    available: boolean | null;
    account: `0x${string}` | string | null;
    image: string | null;
    url: string | null;
    description: string | null;
  }> {
    const { getENSInfo } = await import('./ensClient');
    return getENSInfo(ensName, chainId);
  }

  async addAgentNameToL1Org(params: {
    agentName: string;
    orgName: string;
    agentAddress: `0x${string}`;
    agentUrl?: string;
    chainId?: number;
  }): Promise<string> {
    const { addAgentNameToL1Org } = await import('./ensClient');
    return addAgentNameToL1Org(params as any);
  }

  async addAgentNameToL2Org(params: {
    agentName: string;
    orgName: string;
    agentAddress: `0x${string}`;
    agentUrl?: string;
    agentDescription?: string;
    agentImage?: string;
    chainId?: number;
  }): Promise<{
    calls: {
      to: `0x${string}`;
      data: `0x${string}`;
      value?: bigint;
    }[];
  }> {
    const { addAgentNameToL2Org } = await import('./ensClient');
    return addAgentNameToL2Org(params as any);
  }

  /**
   * Set the token URI (registration tokenUri) for an existing agent NFT
   * in the IdentityRegistry. This delegates to the Admin Agents API and
   * requires AdminApp / admin permissions to be configured.
   */
  async setAgentTokenUri(params: {
    agentId: string | bigint;
    chainId?: number;
    tokenUri: string;
  }): Promise<{ txHash: string }> {
    const { agentId, chainId, tokenUri } = params;
    if (!tokenUri || typeof tokenUri !== 'string' || tokenUri.trim().length === 0) {
      throw new Error('tokenUri is required for setAgentTokenUri');
    }

    const idAsString =
      typeof agentId === 'bigint' ? agentId.toString(10) : String(agentId || '').trim();
    if (!idAsString) {
      throw new Error('agentId is required for setAgentTokenUri');
    }

    return this.agents.admin.updateAgent({
      agentId: idAsString,
      chainId,
      tokenUri: tokenUri,
    });
  }

  /**
   * Transfer an agent NFT to a new owner address.
   * Thin wrapper over AgentsAPI.admin.transferAgent.
   */
  async transferAgent(params: {
    agentId: string | bigint;
    to: `0x${string}`;
    chainId?: number;
  }): Promise<{ txHash: string }> {
    const { agentId, to, chainId } = params;

    const idAsString =
      typeof agentId === 'bigint' ? agentId.toString(10) : String(agentId || '').trim();
    if (!idAsString) {
      throw new Error('agentId is required for transferAgent');
    }

    if (!to || typeof to !== 'string' || !to.startsWith('0x') || to.length !== 42) {
      throw new Error(`Invalid destination address for transferAgent: ${to}`);
    }

    return this.agents.admin.transferAgent({
      agentId: idAsString,
      chainId,
      to,
    });
  }

  /**
   * Update the on-chain metadata keys `agentName` and/or `agentAccount`
   * in the IdentityRegistry for an existing agent NFT.
   *
   * This is a thin wrapper over AgentsAPI.admin.updateAgent that builds the
   * appropriate metadata entries. Requires AdminApp / admin permissions.
   */
  async updateNameAndAccountMetadata(params: {
    agentId: string | bigint;
    chainId?: number;
    agentName?: string | null;
    agentAccount?: string | null;
  }): Promise<{ txHash: string }> {
    const { agentId, chainId, agentName, agentAccount } = params;

    const idAsString =
      typeof agentId === 'bigint' ? agentId.toString(10) : String(agentId || '').trim();
    if (!idAsString) {
      throw new Error('agentId is required for updateNameAndAccountMetadata');
    }

    const metadata: Array<{ key: string; value: string }> = [];

    if (agentName && agentName.toString().trim().length > 0) {
      metadata.push({
        key: 'agentName',
        value: agentName.toString().trim(),
      });
    }

    if (agentAccount && agentAccount.toString().trim().length > 0) {
      metadata.push({
        key: 'agentAccount',
        value: agentAccount.toString().trim(),
      });
    }

    if (metadata.length === 0) {
      throw new Error(
        'At least one of agentName or agentAccount must be provided for updateNameAndAccountMetadata',
      );
    }

    return this.agents.admin.updateAgent({
      agentId: idAsString,
      chainId,
      metadata,
    });
  }

  /**
   * Prepare low-level calls for updating an agent's token URI and/or metadata,
   * suitable for client-side AA/bundler execution. Mirrors AgentsAPI.admin.prepareUpdateAgent.
   */
  async prepareUpdateAgent(params: {
    agentId: string | bigint;
    tokenUri?: string;
    metadata?: Array<{ key: string; value: string }>;
    chainId?: number;
  }): Promise<{
    chainId: number;
    identityRegistry: `0x${string}`;
    bundlerUrl: string;
    calls: Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }>;
  }> {
    const { agentId, chainId, tokenUri, metadata } = params;
    const idAsString =
      typeof agentId === 'bigint' ? agentId.toString(10) : String(agentId || '').trim();
    if (!idAsString) {
      throw new Error('agentId is required for prepareUpdateAgent');
    }

    return this.agents.admin.prepareUpdateAgent({
      agentId: idAsString,
      chainId,
      tokenUri,
      metadata,
    } as any);
  }

  async prepareL1AgentNameInfoCalls(params: {
    agentAddress: `0x${string}`;
    orgName: string;
    agentName: string;
    agentUrl?: string;
    agentDescription?: string;
    chainId?: number;
  }): Promise<{
    calls: {
      to: `0x${string}`;
      data: `0x${string}`;
      value?: bigint;
    }[];
  }> {
    const { prepareL1AgentNameInfoCalls } = await import('./ensClient');
    return prepareL1AgentNameInfoCalls(params as any);
  }

  async prepareL2AgentNameInfoCalls(params: {
    agentAddress: `0x${string}`;
    orgName: string;
    agentName: string;
    agentUrl?: string;
    agentDescription?: string;
    agentImage?: string;
    chainId?: number;
  }): Promise<{
    calls: {
      to: `0x${string}`;
      data: `0x${string}`;
      value?: bigint;
    }[];
  }> {
    const { prepareL2AgentNameInfoCalls } = await import('./ensClient');
    return prepareL2AgentNameInfoCalls(params as any);
  }

  /**
   * High-level createAgent helper that routes to the appropriate underlying
   * AgentsAPI method based on ownerType (EOA vs AA) and executionMode.
   *
   * - ownerType: 'eoa' | 'aa'
   * - executionMode:
   *    - 'auto'   (default): use server if an admin/private key is configured, otherwise client
   *    - 'server' : execute on server (requires admin/private key, otherwise falls back to 'client')
   *    - 'client' : prepare transactions/calls for client-side signing/execution
   */
  async createAgent(params: {
    ownerType: OwnerType;
    executionMode?: ExecutionMode;
  } & CreateAgentBaseParams): Promise<CreateAgentResult> {
    const { ownerType, executionMode = 'auto', ...rest } = params;

    const hasPrivateKey =
      !!this.config.privateKey || !!process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY;

    let mode: ExecutionMode = executionMode;
    if (executionMode === 'auto') {
      mode = hasPrivateKey ? 'server' : 'client';
    } else if (executionMode === 'server' && !hasPrivateKey) {
      console.warn(
        '[AgenticTrustClient.createAgent] executionMode="server" requested but no admin/private key configured; falling back to "client" mode.',
      );
      mode = 'client';
    }

    if (ownerType === 'eoa') {
      if (mode === 'server') {
        return (await this.agents.createAgentForEOAPK(rest)) as CreateAgentEOAServerResult;
      }
      return (await this.agents.createAgentForEOA(rest)) as CreateAgentEOAClientResult;
    }

    // ownerType === 'aa'
    if (mode === 'server') {
      return (await this.agents.createAgentForAAPK(rest)) as CreateAgentAAServerResult;
    }
    return (await this.agents.createAgentForAA(rest)) as CreateAgentAAClientResult;
  }

  /**
   * Get a single agent by ID.
   * Uses loadAgentDetail to get the latest data from the NFT contract,
   * with discovery data used as fallback for missing fields.
   */
  async getAgent(agentId: string, chainId: number = DEFAULT_CHAIN_ID): Promise<Agent | null> {
    try {
      const agentDetail = await loadAgentDetail(this, agentId, chainId);
      
      // Convert AgentDetail to AgentData format expected by Agent constructor
      // AgentDetail extends AgentInfo which has all the fields needed
      const agentData: Agent['data'] = {
        agentId: agentDetail.agentId,
        agentName: agentDetail.agentName,
        chainId: agentDetail.chainId,
        agentAccount: agentDetail.agentAccount,
        agentOwner: agentDetail.agentOwner,
        contractAddress: agentDetail.contractAddress ?? undefined,
        didIdentity: agentDetail.didIdentity ?? undefined,
        didAccount: agentDetail.didAccount ?? undefined,
        didName: agentDetail.didName ?? undefined,
        tokenUri: agentDetail.tokenUri ?? undefined,
        createdAtBlock: agentDetail.createdAtBlock,
        createdAtTime: agentDetail.createdAtTime,
        updatedAtTime: agentDetail.updatedAtTime ?? undefined,
        type: agentDetail.type ?? undefined,
        description: agentDetail.description ?? undefined,
        image: agentDetail.image ?? undefined,
        a2aEndpoint: agentDetail.a2aEndpoint ?? undefined,
        ensEndpoint: agentDetail.ensEndpoint ?? undefined,
        agentAccountEndpoint: agentDetail.agentAccountEndpoint ?? undefined,
        supportedTrust: agentDetail.supportedTrust ?? undefined,
        rawJson: agentDetail.rawJson ?? undefined,
        did: agentDetail.did ?? undefined,
        mcp: agentDetail.mcp ?? undefined,
        x402support: agentDetail.x402support ?? undefined,
        active: agentDetail.active ?? undefined,
      };

      return new Agent(agentData, this);
    } catch (error) {
      console.warn(`[AgenticTrustClient.getAgent] Failed to load agent ${agentId} on chain ${chainId}:`, error);
      return null;
    }
  }

  /**
   * Resolve and load an agent by its registered name using the discovery indexer.
   * Returns an Agent instance bound to this client or null if not found.
   */
  async getAgentByName(agentName: string): Promise<Agent | null> {
    const discoveryClient = await getDiscoveryClient();
    const agentData = await discoveryClient.getAgentByName(agentName);

    if (!agentData) {
      return null;
    }

    return new Agent(agentData, this);
  }

  /**
   * Get the on-chain owner (EOA or account) of an agentId from the IdentityRegistry.
   * Returns null if the owner cannot be resolved (e.g. token does not exist).
   */
  async getAgentOwner(
    agentId: string,
    chainId?: number,
  ): Promise<`0x${string}` | null> {
    const resolvedChainId = chainId ?? DEFAULT_CHAIN_ID;

    const trimmed = agentId.trim();
    let agentIdBigInt: bigint;
    try {
      agentIdBigInt = BigInt(trimmed);
    } catch {
      throw new Error(`Invalid agentId for getAgentOwner: ${agentId}`);
    }

    try {
      const identityClient = await getIdentityRegistryClient(resolvedChainId);
      const owner = await (identityClient as any).getOwner(agentIdBigInt);
      if (typeof owner === 'string' && /^0x[a-fA-F0-9]{40}$/.test(owner)) {
        return owner as `0x${string}`;
      }
      return null;
    } catch (error) {
      console.warn('[AgenticTrustClient.getAgentOwner] Failed to resolve owner:', error);
      return null;
    }
  }

  /**
   * Resolve and load an agent by did:8004 identifier.
   */
  async getAgentByDid(did8004: string): Promise<Agent | null> {
    const { agentId, chainId } = parseDid8004(did8004);
    return this.getAgent(agentId, chainId);
  }

  /**
   * Get a fully-hydrated AgentDetail for a given agentId and chainId.
   * This reuses the shared buildAgentDetail implementation so that
   * discovery, identity, and registration data are resolved consistently.
   */
  async getAgentDetails(
    agentId: string,
    chainId?: number,
  ): Promise<AgentDetail> {
    const resolvedChainId = chainId ?? DEFAULT_CHAIN_ID;
    const trimmed = agentId.trim();
    let agentIdBigInt: bigint;
    try {
      agentIdBigInt = BigInt(trimmed);
    } catch {
      throw new Error(`Invalid agentId for getAgentDetails: ${agentId}`);
    }
    return loadAgentDetail(this, agentIdBigInt, resolvedChainId);
  }

  /**
   * Get a fully-hydrated AgentDetail for a given did:8004 identifier.
   */
  async getAgentDetailsByDid(did8004: string): Promise<AgentDetail> {
    // loadAgentDetail will parse did:8004 and derive chainId/agentId internally.
    return loadAgentDetail(this, did8004, DEFAULT_CHAIN_ID);
  }

  /**
   * Resolve an agent by its owner account address.
   *
   * Strategy:
   *  1. Try ENS reverse lookup via ENS client (getAgentIdentityByAccount)
   *  2. If not found, fall back to discovery search by account address
   *  3. If an agentId is resolved, return fully-hydrated AgentDetail
   *
   * Returns null if no agent can be resolved for the given account.
   */
  async getAgentByAccount(
    account: `0x${string}`,
    chainId?: number,
  ): Promise<AgentDetail | null> {
    let workingChainId = Number.isFinite(chainId ?? NaN) && (chainId ?? 0) > 0
      ? (chainId as number)
      : DEFAULT_CHAIN_ID;

    let agentId: string | null = null;

    // 1. Try ENS reverse lookup first
    try {
      const ensClient = await getENSClient(workingChainId);
      const identity = await (ensClient as any).getAgentIdentityByAccount(account);
      if (identity?.agentId) {
        agentId = identity.agentId.toString();
      }
    } catch (error) {
      console.warn('getAgentByAccount: Reverse ENS lookup by account failed:', error);
    }

    // 2. Fall back to discovery search by account if needed
    if (!agentId) {
      try {
        const searchResults = await this.searchAgents({
          query: account,
          page: 1,
          pageSize: 1,
        });

        const candidate = searchResults.agents?.[0];
        if (candidate && typeof candidate === 'object') {
          const candidateObject = candidate as unknown as Record<string, unknown>;
          const candidateDataRaw = candidateObject.data;
          const candidateData =
            candidateDataRaw && typeof candidateDataRaw === 'object'
              ? (candidateDataRaw as Record<string, unknown>)
              : null;

          const candidateAgentIdValue =
            candidateData && candidateData.agentId !== undefined
              ? (candidateData as any).agentId
              : (candidateObject as any).agentId;

          if (candidateAgentIdValue !== undefined && candidateAgentIdValue !== null) {
            if (typeof candidateAgentIdValue === 'bigint') {
              agentId = candidateAgentIdValue.toString();
            } else if (
              typeof candidateAgentIdValue === 'number' &&
              Number.isFinite(candidateAgentIdValue)
            ) {
              agentId = Math.trunc(candidateAgentIdValue).toString();
            } else if (
              typeof candidateAgentIdValue === 'string' &&
              candidateAgentIdValue.trim().length > 0
            ) {
              agentId = candidateAgentIdValue.trim();
            }
          }

          const candidateChainId =
            candidateData && typeof (candidateData as any).chainId === 'number'
              ? (candidateData as any).chainId
              : undefined;
          if ((!workingChainId || Number.isNaN(workingChainId)) && typeof candidateChainId === 'number') {
            workingChainId = candidateChainId;
          }
        }
      } catch (error) {
        console.warn('getAgentByAccount: Discovery search by account failed:', error);
      }
    }

    if (!agentId) {
      return null;
    }

    const effectiveChainId =
      Number.isFinite(workingChainId) && workingChainId > 0 ? workingChainId : DEFAULT_CHAIN_ID;

    return this.getAgentDetails(agentId, effectiveChainId);
  }



  /**
   * Extract an agentId from a transaction receipt using the on-chain IdentityRegistry.
   * Thin wrapper around AgentsAPI.extractAgentIdFromReceipt so apps can call
   * client.extractAgentIdFromReceipt(...) directly.
   */
  async extractAgentIdFromReceipt(
    receipt: any,
    chainId?: number,
  ): Promise<string | null> {
    return this.agents.extractAgentIdFromReceipt(
      receipt,
      chainId ?? DEFAULT_CHAIN_ID,
    );
  }



  /**
   * Revoke a previously submitted feedback entry for an agent.
   *
   * This is a high-level helper that:
   *  - resolves the ReputationClient singleton for the given chain
   *  - converts the provided agentId/feedbackIndex into bigint
   *  - calls the underlying ReputationRegistry.revokeFeedback(...)
   */
  async revokeFeedback(params: {
    agentId: string;
    feedbackIndex: string | number | bigint;
    chainId?: number;
  }): Promise<{ txHash: string }> {
    const { agentId, feedbackIndex, chainId } = params;
    const resolvedChainId = chainId ?? DEFAULT_CHAIN_ID;

    const trimmed = agentId.trim();
    let agentIdBigInt: bigint;
    try {
      agentIdBigInt = BigInt(trimmed);
    } catch {
      throw new Error(`Invalid agentId for revokeFeedback: ${agentId}`);
    }

    const feedbackIndexBigInt =
      typeof feedbackIndex === 'bigint' ? feedbackIndex : BigInt(feedbackIndex);

    const reputationClient = await getReputationRegistryClient(resolvedChainId);
    return (reputationClient as any).revokeFeedback(agentIdBigInt, feedbackIndexBigInt);
  }


  /**
   * Append a response to an existing feedback entry for an agent.
   *
   * High-level helper that converts string/number inputs to bigint and delegates
   * to the ReputationClient's appendToFeedback implementation.
   */
  async appendToFeedback(params: {
    agentId: string;
    clientAddress: `0x${string}`;
    feedbackIndex: string | number | bigint;
    responseUri?: string;
    responseHash?: `0x${string}`;
    chainId?: number;
  }): Promise<{ txHash: string }> {
    const { agentId, clientAddress, feedbackIndex, responseUri, responseHash, chainId } = params;
    const resolvedChainId = chainId ?? DEFAULT_CHAIN_ID;

    const trimmed = agentId.trim();
    let agentIdBigInt: bigint;
    try {
      agentIdBigInt = BigInt(trimmed);
    } catch {
      throw new Error(`Invalid agentId for appendToFeedback: ${agentId}`);
    }

    const feedbackIndexBigInt =
      typeof feedbackIndex === 'bigint' ? feedbackIndex : BigInt(feedbackIndex);

    const reputationClient = await getReputationRegistryClient(resolvedChainId);
    return (reputationClient as any).appendToFeedback({
      agentId: agentIdBigInt,
      clientAddress,
      feedbackIndex: feedbackIndexBigInt,
      responseUri,
      responseHash,
    });
  }

  /**
   * Get the ENS client singleton
   * @returns The ENS client instance
   */
  async getENSClient(): Promise<any> {
    const { getENSClient } = await import('./ensClient');
    return await getENSClient();
  }

  async getDiscoveryClient(): Promise<any> {
    const { getDiscoveryClient } = await import('./discoveryClient');
    return await getDiscoveryClient();
  }

  /**
   * Verify a signed challenge
   * Handles all Veramo agent logic internally - no Veramo exposure at app level
   * 
   * @param auth - The authentication challenge with signature
   * @param expectedAudience - Expected audience (provider URL) for validation
   * @returns Verification result with client address if valid
   */
  async verifyChallenge(
    auth: AuthChallenge,
    expectedAudience: string
  ): Promise<ChallengeVerificationResult> {
    return this.veramo.verifyChallenge(auth, expectedAudience);
  }


  /**
   * Initialize reputation client from session package
   * Uses environment variables only (no overrides allowed)
   * @internal
   */
  private async initializeReputationFromSessionPackage(config: {
    filePath?: string;
    package?: SessionPackage;
    ensRegistry: `0x${string}`;
  }): Promise<void> {
    console.log('🔧 initializeReputationFromSessionPackage: Starting...');
    const { loadSessionPackage, buildDelegationSetup, buildAgentAccountFromSession } = await import('../lib/sessionPackage');
    
    // Load session package
    const sessionPackage = config.package || loadSessionPackage(config.filePath);
    // buildDelegationSetup uses env vars only (no overrides)
    const delegationSetup = buildDelegationSetup(sessionPackage);
    
    // Build agent account from session
    console.log('🔧 initializeReputationFromSessionPackage: Building agent account from session package...');
    const agentAccount = await buildAgentAccountFromSession(sessionPackage);
    
    // Create wallet client
    console.log('🔧 initializeReputationFromSessionPackage: Creating wallet client...')
    console.log("agentAccount inside initializeReputationFromSessionPackage -----> ", agentAccount.address);
    const { createWalletClient, http: httpTransport } = await import('viem');
    const walletClient = createWalletClient({
      account: agentAccount,
      chain: delegationSetup.chain,
      transport: httpTransport(delegationSetup.rpcUrl),
    });


    const reputationRegistry = this.config.reputationRegistry;
    if (!reputationRegistry) {
      throw new Error(
        'reputationRegistry is required. Set AGENTIC_TRUST_REPUTATION_REGISTRY environment variable.'
      );
    }

    const identityRegistry = this.config.identityRegistry;
    if (!identityRegistry) {
      throw new Error(
        'identityRegistry is required. Set AGENTIC_TRUST_IDENTITY_REGISTRY environment variable.'
      );
    }

  }

  /**
   * Initialize reputation client from top-level config (identityRegistry and reputationRegistry)
   * Uses the EOA (Externally Owned Account) derived from the private key
   * @internal
   */
  private async initializeClientReputationFromConfig(config: ApiClientConfig): Promise<void> {
    console.log('🔧 initializeReputationFromConfig: Starting...');
    
    const identityRegistry = config.identityRegistry;
    const reputationRegistry = config.reputationRegistry;
    
    if (!identityRegistry || !reputationRegistry) {
      throw new Error(
        'identityRegistry and reputationRegistry are required. Set AGENTIC_TRUST_IDENTITY_REGISTRY and AGENTIC_TRUST_REPUTATION_REGISTRY environment variables.'
      );
    }


    const rpcUrl = config.rpcUrl;
    if (!rpcUrl) {
      throw new Error(
        'RPC URL is required. Set AGENTIC_TRUST_RPC_URL environment variable.'
      );
    }

    // Get ENS registry (optional, but recommended)
    const ensRegistry = config.sessionPackage?.ensRegistry ||
      (getChainEnvVar('AGENTIC_TRUST_ENS_REGISTRY', DEFAULT_CHAIN_ID) || undefined) as `0x${string}` | undefined;
    
    if (!ensRegistry) {
      console.log('⚠️ ENS registry not provided. which might be ok.');
    }

    // Try to get AccountProvider from AdminApp or ClientApp (supports wallet providers)
    // If not available, fall back to privateKey-based creation
    let accountProvider: any;
    let eoaAddress: `0x${string}` | undefined;

    // Try AdminApp first (for admin operations) if this process has admin role
    if (isUserAppEnabled('admin')) {
      try {
        const { getAdminApp } = await import('../userApps/adminApp');
        const adminApp = await getAdminApp();
        if (adminApp && adminApp.accountProvider) {
          // Use AdminApp's AccountProvider (works with private key OR wallet provider)
          accountProvider = adminApp.accountProvider; // For admin, agent and client are the same
          eoaAddress = adminApp.address;
          console.log('🔧 initializeReputationFromConfig: Using AdminApp AccountProvider', eoaAddress);
        }
      } catch (error) {
        // AdminApp not available, try ClientApp
        console.log('🔧 initializeReputationFromConfig: AdminApp not available, trying ClientApp...');
      }
    } else {
      // Skip AdminApp for non-admin apps (web, provider, etc.)
      console.log('🔧 initializeReputationFromConfig: Skipping AdminApp (no admin role), trying ClientApp...');
    }

    // Try ClientApp if AdminApp didn't work
    if (!accountProvider) {
      try {
        const { getClientApp } = await import('../userApps/clientApp');
        const clientApp = await getClientApp();
        if (clientApp && clientApp.accountProvider) {
          // Use ClientApp's AccountProvider
          const { ViemAccountProvider } = await import('@agentic-trust/8004-sdk');
          accountProvider = new ViemAccountProvider({
            publicClient: clientApp.publicClient,
            walletClient: clientApp.walletClient as any,
            account: clientApp.account,
            chainConfig: {
              id: clientApp.publicClient.chain?.id || 11155111,
              rpcUrl: (clientApp.publicClient.transport as any)?.url || '',
              name: clientApp.publicClient.chain?.name || 'Unknown',
              chain: clientApp.publicClient.chain || undefined,
            },
          });
          accountProvider = clientApp.accountProvider;
          eoaAddress = clientApp.address;
          console.log('🔧 initializeReputationFromConfig: Using ClientApp AccountProvider', eoaAddress);
        }
      } catch (error) {
        // ClientApp not available, fall back to privateKey
        console.log('🔧 initializeReputationFromConfig: ClientApp not available, falling back to privateKey...');
      }
    }

    // Fall back to privateKey-based creation if no wallet/app available
    if (!accountProvider && config.privateKey) {
      console.log('🔧 initializeReputationFromConfig: Creating AccountProvider from privateKey...');
      
      // Normalize private key (same logic as veramoFactory)
      let cleanedKey = config.privateKey.trim().replace(/\s+/g, '');
      if (cleanedKey.startsWith('0x')) {
        cleanedKey = cleanedKey.slice(2);
      }
      if (!/^[0-9a-fA-F]{64}$/.test(cleanedKey)) {
        throw new Error('Invalid private key format');
      }
      const normalizedKey = `0x${cleanedKey}` as `0x${string}`;

      // Create account from private key
      const { privateKeyToAccount } = await import('viem/accounts');
      const account = privateKeyToAccount(normalizedKey);
      eoaAddress = account.address as `0x${string}`;

      // Create public and wallet clients
      const { createPublicClient, createWalletClient, http: httpTransport } = await import('viem');
      const { sepolia } = await import('viem/chains');

      const publicClient = createPublicClient({
        chain: sepolia,
        transport: httpTransport(rpcUrl),
      });

      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: httpTransport(rpcUrl),
      });

      // Create AccountProviders
      const { ViemAccountProvider } = await import('@agentic-trust/8004-sdk');
      accountProvider = new ViemAccountProvider({
        publicClient,
        walletClient,
        account,
        chainConfig: {
          id: sepolia.id,
          rpcUrl,
          name: sepolia.name,
          chain: sepolia,
        },
      });
      console.log('🔧 initializeReputationFromConfig: Using EOA from private key', eoaAddress);
    }

    // If we still don't have AccountProviders, throw error
    if (!accountProvider) {
      throw new Error(
        'Cannot initialize reputation client: No wallet available. ' +
        'Provide either:\n' +
        '  1. Wallet connection (MetaMask/Web3Auth) - AdminApp will be used\n' +
        '  2. Private key via AGENTIC_TRUST_ADMIN_PRIVATE_KEY or config.privateKey\n' +
        '  3. ClientApp initialization (add "client" to AGENTIC_TRUST_APP_ROLES)'
      );
    }

    // Create the reputation client using the AccountProviders
    // The AccountProviders can be from AdminApp (wallet provider), ClientApp, or created from privateKey
    const { AIAgentReputationClient } = await import('@agentic-trust/8004-ext-sdk');
    
    const reputationClient = await AIAgentReputationClient.create(
      accountProvider,
      identityRegistry,
      reputationRegistry,
      (ensRegistry || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as `0x${string}` // Default ENS registry on Sepolia
    );

    // Store the reputation client in the singleton
    // Import the singleton module and set it directly
    //const reputationClientModule = await import('./reputationClient');
    // Access the singleton instance variable (we need to export a setter or access it)
    // For now, we'll use a workaround - the singleton will be initialized when getReputationRegistryClient is called
    // But we've created the client here, so future calls to getReputationRegistryClient should use the singleton's logic
    // Actually, the singleton pattern creates its own instance, so we need to either:
    // 1. Store this instance somewhere accessible to the singleton, or
    // 2. Make sure the singleton uses the same adapters
    
    // Since the singleton recreates the client, we need to ensure it uses the same adapters
    // The singleton logic in reputationClient.ts will use getAdminApp/getClientApp which should return the same adapters
    // So the singleton should work correctly
    
    console.log('✅ initializeReputationFromConfig: Reputation client created with walletClient/adapter', eoaAddress);
  }

  /**
   * Execute a GraphQL query
   */
  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    return this.graphQLClient.request<T>(query, variables);
  }

  /**
   * Execute a GraphQL mutation
   */
  async mutate<T = unknown>(
    mutation: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    return this.graphQLClient.request<T>(mutation, variables);
  }

  /**
   * Get the underlying GraphQL client (for advanced usage)
   */
  getGraphQLClient(): GraphQLClient {
    return this.graphQLClient;
  }

  /**
   * Update the API key and recreate the client
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
    
    const graphQLUrl = this.config.graphQLUrl || '';
    
    // Recreate client with new API key
    const endpoint = graphQLUrl.endsWith('/graphql')
      ? graphQLUrl
      : `${graphQLUrl.replace(/\/$/, '')}/graphql`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...this.config.headers,
    };

    this.graphQLClient = new GraphQLClient(endpoint, {
      headers,
    });

    // Recreate APIs with new client (keep existing Veramo connection)
    this.agents = new AgentsAPI(this);
    this.a2aProtocolProvider = new A2AProtocolProviderAPI(this.graphQLClient);
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<ApiClientConfig> {
    return { ...this.config };
  }

    /**
   * Get the admin EOA address derived from AGENTIC_TRUST_ADMIN_PRIVATE_KEY
   * @returns The admin's Ethereum address
   * @throws Error if AGENTIC_TRUST_ADMIN_PRIVATE_KEY is not set or invalid
   */
    async getAdminEOAAddress(): Promise<`0x${string}`> {
      const privateKey = process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY;
  
      if (!privateKey) {
        throw new Error('AGENTIC_TRUST_ADMIN_PRIVATE_KEY environment variable is required');
      }
  
      const { privateKeyToAccount } = await import('viem/accounts');
      const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
      const account = privateKeyToAccount(normalizedKey as `0x${string}`);
  
      return account.address as `0x${string}`;
    }
}

