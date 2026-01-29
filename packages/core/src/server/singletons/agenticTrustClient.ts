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
import { getChainById, getChainRpcUrl } from '../lib/chainConfig';


import { isUserAppEnabled } from '../userApps/userApp';
import { createVeramoAgentForClient } from '../lib/veramoFactory';
import { getChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';
import { Agent, loadAgentDetail } from '../lib/agent';
import type { AgentDetail } from '../models/agentDetail';
import { createFeedbackAuth, createFeedbackAuthWithDelegation, type CreateFeedbackAuthWithDelegationResult } from '../lib/agentFeedback';
import type { RequestAuthParams } from '../lib/agentFeedback';
import { parseDid8004 } from '@agentic-trust/8004-ext-sdk';

import type { SessionPackage } from '../../shared/sessionPackage';
import type { Address } from 'viem';

type OwnerType = 'eoa' | 'smartAccount';
type ExecutionMode = 'auto' | 'server' | 'client';

const DEFAULT_DISCOVERY_URL = 'https://8004-agent.io/graphql-kb';
const DEFAULT_DISCOVERY_API_KEY =
  '9073051bb4bb81de87567794f24caf78f77d7985f79bc1cf6f79c33ce2cafdc3';



function as0xAddress(value: string | undefined): `0x${string}` | undefined {
  const v = String(value || '').trim();
  if (!v) return undefined;
  const with0x = v.startsWith('0x') ? v : `0x${v}`;
  if (!/^0x[a-fA-F0-9]{40}$/.test(with0x)) return undefined;
  return with0x as `0x${string}`;
}

type CreateAgentBaseParams = {
  agentName: string;
  agentAccount: `0x${string}`;
  agentCategory?: string;
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

type CreateAgentWithEOAOwnerUsingWalletResult = Awaited<
  ReturnType<AgentsAPI['createAgentWithEOAOwnerUsingWallet']>
>;
type CreateAgentWithEOAOwnerUsingPrivateKeyResult = Awaited<
  ReturnType<AgentsAPI['createAgentWithEOAOwnerUsingPrivateKey']>
>;
type CreateAgentWithSmartAccountOwnerUsingWalletResult = Awaited<
  ReturnType<AgentsAPI['createAgentWithSmartAccountOwnerUsingWallet']>
>;
type CreateAgentWithSmartAccountOwnerUsingPrivateKeyResult = Awaited<
  ReturnType<AgentsAPI['createAgentWithSmartAccountOwnerUsingPrivateKey']>
>;

type CreateAgentResult =
  | CreateAgentWithEOAOwnerUsingWalletResult
  | CreateAgentWithEOAOwnerUsingPrivateKeyResult
  | CreateAgentWithSmartAccountOwnerUsingWalletResult
  | CreateAgentWithSmartAccountOwnerUsingPrivateKeyResult;

export class AgenticTrustClient {
  private graphQLClient: GraphQLClient;
  private config: ApiClientConfig;
  public agents: AgentsAPI;
  public a2aProtocolProvider: A2AProtocolProviderAPI;
  public veramo: VeramoAPI;
  /** Resolves when async initialization (Veramo + optional reputation clients) is complete */
  public readonly ready: Promise<void>;

  constructor(
    configOrParams:
      | ApiClientConfig
      | {
          privateKey: string;
          chainId: number;
          rpcUrl: string;
          discoveryUrl?: string;
          discoveryApiKey?: string;
          identityRegistry?: `0x${string}`;
          reputationRegistry?: `0x${string}`;
        },
  ) {
    const config: ApiClientConfig =
      'chainId' in (configOrParams as any)
        ? (() => {
            const params = configOrParams as {
              privateKey: string;
              chainId: number;
              rpcUrl: string;
              discoveryUrl?: string;
              discoveryApiKey?: string;
              identityRegistry?: `0x${string}`;
              reputationRegistry?: `0x${string}`;
            };

            const chainId = Number(params.chainId);
            if (!Number.isFinite(chainId)) {
              throw new Error('chainId is required');
            }

            const envIdentity = as0xAddress(getChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId));
            const envReputation = as0xAddress(getChainEnvVar('AGENTIC_TRUST_REPUTATION_REGISTRY', chainId));
            //const baked = DEFAULT_REGISTRIES_BY_CHAIN[chainId];

            const identityRegistry =
              params.identityRegistry || envIdentity;
            const reputationRegistry =
              params.reputationRegistry || envReputation;

            if (!identityRegistry || !reputationRegistry) {
              throw new Error(
                `Missing default registry addresses for chainId=${chainId}. ` +
                  `Provide identityRegistry/reputationRegistry explicitly or set ` +
                  `AGENTIC_TRUST_IDENTITY_REGISTRY_<CHAIN> and AGENTIC_TRUST_REPUTATION_REGISTRY_<CHAIN>.`,
              );
            }

            const graphQLUrl = (params.discoveryUrl || DEFAULT_DISCOVERY_URL).trim();
            const apiKey = (params.discoveryApiKey || DEFAULT_DISCOVERY_API_KEY).trim();

            return {
              graphQLUrl,
              apiKey,
              privateKey: String(params.privateKey || '').trim(),
              rpcUrl: String(params.rpcUrl || '').trim(),
              identityRegistry,
              reputationRegistry,
            } satisfies ApiClientConfig;
          })()
        : (configOrParams as ApiClientConfig);

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

    // Kick off async initialization. Users can await `client.ready` if they need
    // Veramo / reputation client to be ready before making calls.
    this.ready = (async () => {
      // Step 1: Initialize Veramo agent (always happens - either provided or created from privateKey)
      await this.initializeVeramoAgent(config);

      // Step 2: Initialize reputation client if configured
      // Priority: sessionPackage > reputation config > top-level config with identity/reputation registry
      if (config.sessionPackage) {
        console.log('🔧 create: Initializing reputation from session package...');
        await this.initializeReputationFromSessionPackage(
          config.sessionPackage as { filePath?: string; package?: SessionPackage; ensRegistry: `0x${string}` },
        );
      } else if (config.identityRegistry && config.reputationRegistry) {
        // Initialize reputation from top-level config (identityRegistry and reputationRegistry)
        // Uses the EOA derived from privateKey (same as VeramoAgent)
        // Note: Reputation client requires private key for signing operations
        if (config.privateKey) {
          console.log('🔧 create: Initializing reputation from top-level config...');
          await this.initializeClientReputationFromConfig(config);
        }
      }

      // Step 3: Eagerly initialize core domain clients (best-effort)
      // so downstream calls don't pay first-call initialization cost.
      const defaultChainId = DEFAULT_CHAIN_ID;
      try {
        await Promise.allSettled([
          getDiscoveryClient(), // discovery indexer
          getENSClient(defaultChainId), // ENS client
          getIdentityRegistryClient(defaultChainId), // identity client
          getReputationRegistryClient(defaultChainId), // reputation client
        ]);
      } catch {
        // Individual domain client initialization errors are logged
        // in their respective modules; we don't fail client creation.
      }
    })();
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
    await client.ready;
    return client;
  }

  /** @deprecated Use `new AgenticTrustClient({ privateKey, chainId, rpcUrl, ... })` instead. */
  static async createWithDefaults(params: {
    privateKey: string;
    chainId: number;
    rpcUrl: string;
    discoveryUrl?: string;
    discoveryApiKey?: string;
    identityRegistry?: `0x${string}`;
    reputationRegistry?: `0x${string}`;
  }): Promise<AgenticTrustClient> {
    const client = new AgenticTrustClient(params);
    await client.ready;
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
   * Create a feedbackAuth and also produce a pre-signed ERC-8092 delegation association
   * payload (approver signature only).
   */
  async createFeedbackAuthWithDelegation(
    params: RequestAuthParams,
  ): Promise<CreateFeedbackAuthWithDelegationResult> {
    return createFeedbackAuthWithDelegation(params);
  }

  /**
   * Fetch feedback entries for a given agent.
   *
   * Strategy:
   *  1. Try the discovery indexer's KB GraphQL API when available.
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

    // 1. Try discovery indexer feedback search first.
    const discoveryClient = await getDiscoveryClient();
    if (typeof (discoveryClient as any).searchFeedbackAdvanced !== 'function') {
      throw new Error('Discovery client does not expose searchFeedbackAdvanced()');
    }

    const res = await (discoveryClient as any).searchFeedbackAdvanced({
      chainId: resolvedChainId,
      agentId: trimmed,
      limit: typeof limit === 'number' ? limit : 100,
      offset: typeof offset === 'number' ? offset : 0,
      orderBy: 'timestamp',
      orderDirection: 'DESC',
    });
    const list = Array.isArray(res?.feedbacks) ? (res.feedbacks as unknown[]) : [];
    if (list.length > 0) {
      return list;
    }

    const reputationClient = await getReputationRegistryClient(resolvedChainId);

    // 2. Fallback: on-chain ReputationRegistry readAllFeedback
    try {
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
    } catch (error) {
      console.warn(
        '[AgenticTrustClient.getAgentFeedback] on-chain readAllFeedback failed; falling back to per-client readFeedback:',
        error,
      );
    }

    // 3. Fallback: per-client readFeedback (slower, but avoids ABI mismatches in readAllFeedback)
    const resolvedLimit = typeof limit === 'number' ? limit : 100;
    const resolvedOffset = typeof offset === 'number' ? offset : 0;
    const targetCount = Math.max(0, resolvedOffset + resolvedLimit);

    const clientsList: string[] =
      Array.isArray(clientAddresses) && clientAddresses.length > 0
        ? clientAddresses
        : await (reputationClient as any).getClients(agentIdBigInt).catch(() => []);

    const out: unknown[] = [];
    for (const clientAddress of clientsList) {
      let lastIndex: bigint = 0n;
      try {
        lastIndex = await (reputationClient as any).getLastIndex(agentIdBigInt, clientAddress);
      } catch {
        continue;
      }

      // getLastIndex() returns the last used index (0 if none). Iterate backwards for "most recent" first per client.
      for (let idx = lastIndex; idx >= 0n; idx--) {
        let entry: any;
        try {
          entry = await (reputationClient as any).readFeedback(agentIdBigInt, clientAddress, idx);
        } catch {
          // Some registries may have sparse indexes; ignore missing entries.
          if (idx === 0n) break;
          continue;
        }

        const isRevoked = !!entry?.isRevoked;
        if (!includeRevoked && isRevoked) {
          if (idx === 0n) break;
          continue;
        }

        const entryTag1 = String(entry?.tag1 ?? '');
        const entryTag2 = String(entry?.tag2 ?? '');
        if (tag1 && entryTag1 !== tag1) {
          if (idx === 0n) break;
          continue;
        }
        if (tag2 && entryTag2 !== tag2) {
          if (idx === 0n) break;
          continue;
        }

        out.push({
          agentId: trimmed,
          chainId: resolvedChainId,
          clientAddress,
          score: Number(entry?.score ?? 0),
          tag1: entryTag1,
          tag2: entryTag2,
          isRevoked,
          feedbackIndex: idx.toString(),
        });

        if (targetCount > 0 && out.length >= targetCount) {
          break;
        }

        if (idx === 0n) break;
      }

      if (targetCount > 0 && out.length >= targetCount) {
        break;
      }
    }

    return out.slice(resolvedOffset, resolvedOffset + resolvedLimit);
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
    const clients =
      Array.isArray(clientAddresses) && clientAddresses.length > 0
        ? clientAddresses
        : await (reputationClient as any).getClients(agentIdBigInt).catch(() => []);

    if (!clients || clients.length === 0) {
      return { count: 0n, averageScore: 0 };
    }

    return (reputationClient as any).getSummary(agentIdBigInt, clients, tag1, tag2);
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
   * - ownerType: 'eoa' | 'smartAccount'
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
        return (await this.agents.createAgentWithEOAOwnerUsingPrivateKey(rest)) as CreateAgentWithEOAOwnerUsingPrivateKeyResult;
      }
      return (await this.agents.createAgentWithEOAOwnerUsingWallet(rest)) as CreateAgentWithEOAOwnerUsingWalletResult;
    }

    // ownerType === 'smartAccount'
    if (mode === 'server') {
      return (await this.agents.createAgentWithSmartAccountOwnerUsingPrivateKey(rest)) as CreateAgentWithSmartAccountOwnerUsingPrivateKeyResult;
    }
    return (await this.agents.createAgentWithSmartAccountOwnerUsingWallet(rest)) as CreateAgentWithSmartAccountOwnerUsingWalletResult;
  }

  /**
   * Get a single agent by ID.
   * Uses loadAgentDetail to get the latest data from the NFT contract,
   * with discovery data used as fallback for missing fields.
   */
  async getAgent(
    agentId: string,
    chainId: number = DEFAULT_CHAIN_ID,
    options?: { includeRegistration?: boolean },
  ): Promise<Agent | null> {
    try {
      // Default to skipping registration/tokenURI/IPFS reads unless explicitly requested.
      // This keeps hot paths (like feedback auth) resilient to IPFS and reduces RPC load.
      const agentDetail = await loadAgentDetail(this, agentId, chainId, {
        includeRegistration: options?.includeRegistration ?? false,
      });
      
      // Convert AgentDetail to AgentData format expected by Agent constructor
      // AgentDetail extends AgentInfo which has all the fields needed
      const agentData: Agent['data'] = {
        agentId: agentDetail.agentId,
        agentName: agentDetail.agentName,
        chainId: agentDetail.chainId,
        agentAccount: agentDetail.agentAccount,
        agentIdentityOwnerAccount: agentDetail.agentIdentityOwnerAccount,
        eoaAgentIdentityOwnerAccount: agentDetail.eoaAgentIdentityOwnerAccount ?? undefined,
        eoaAgentAccount: agentDetail.eoaAgentAccount ?? undefined,
        contractAddress: agentDetail.contractAddress ?? undefined,
        didIdentity: agentDetail.didIdentity ?? undefined,
        didAccount: agentDetail.didAccount ?? undefined,
        didName: agentDetail.didName ?? undefined,
        agentUri: agentDetail.agentUri ?? undefined,
        createdAtBlock: agentDetail.createdAtBlock,
        createdAtTime: agentDetail.createdAtTime,
        updatedAtTime: agentDetail.updatedAtTime ?? undefined,
        type: agentDetail.type ?? undefined,
        description: agentDetail.description ?? undefined,
        image: agentDetail.image ?? undefined,
        a2aEndpoint: agentDetail.a2aEndpoint ?? undefined,
        supportedTrust: agentDetail.supportedTrust ?? undefined,
        rawJson: agentDetail.rawJson ?? undefined,
        agentCardJson: agentDetail.agentCardJson ?? undefined,
        agentCardReadAt: agentDetail.agentCardReadAt ?? undefined,
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
      if (owner && typeof owner === 'string' && /^0x[a-fA-F0-9]{40}$/.test(owner)) {
        return owner as `0x${string}`;
      }
      return null;
    } catch (error) {
      console.warn('[AgenticTrustClient.getAgentOwner] Failed to resolve owner:', error);
      return null;
    }
  }

  /**
   * Check if a wallet address owns an agent.
   * Performs blockchain verification to determine ownership relationship.
   * Agent NFT → Agent Account (AA) → EOA (wallet)
   */
  async isOwner(
    did8004: string,
    walletAddress: `0x${string}`,
    chainId?: number,
  ): Promise<boolean> {
    const resolvedChainId = chainId ?? DEFAULT_CHAIN_ID;

    // Parse the DID to get agent info
    let agentId: string;
    try {
      const parsed = parseDid8004(did8004);
      agentId = parsed.agentId;
    } catch (error) {
      console.warn('[AgenticTrustClient.isOwner] Invalid DID format:', did8004, error);
      return false;
    }

    const lowerWallet = walletAddress.toLowerCase();

    try {
      // Create a client for the chain
      const chain = getChainById(resolvedChainId);
      const rpcUrl = getChainRpcUrl(resolvedChainId);
      if (!rpcUrl) {
        console.warn('[AgenticTrustClient.isOwner] No RPC URL for chain:', resolvedChainId);
        return false;
      }

      const { createPublicClient, http } = await import('viem');
      const client = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      // Resolve identity registry + on-chain ownership without loading AgentDetail (no IPFS).
      const identityClient = await getIdentityRegistryClient(resolvedChainId);
      const identityRegistryAddress = (identityClient as any)?.identityRegistryAddress as Address | undefined;
      if (!identityRegistryAddress) {
        console.warn('[AgenticTrustClient.isOwner] Missing identityRegistryAddress');
        return false;
      }

      const tokenId = BigInt(agentId);

      const IDENTITY_ABI = [
        {
          type: 'function',
          name: 'ownerOf',
          stateMutability: 'view',
          inputs: [{ name: 'tokenId', type: 'uint256' }],
          outputs: [{ name: 'owner', type: 'address' }],
        },
        {
          type: 'function',
          name: 'getAgentWallet',
          stateMutability: 'view',
          inputs: [{ name: 'agentId', type: 'uint256' }],
          outputs: [{ name: 'wallet', type: 'address' }],
        },
      ] as const;

      // 1) Direct NFT owner check
      let nftOwner: string | null = null;
      try {
        nftOwner = (await client.readContract({
          address: identityRegistryAddress,
          abi: IDENTITY_ABI,
          functionName: 'ownerOf',
          args: [tokenId],
        })) as string;
      } catch (e) {
        console.warn('[AgenticTrustClient.isOwner] ownerOf failed:', e);
        nftOwner = null;
      }

      if (nftOwner && nftOwner.toLowerCase() === lowerWallet) {
        return true;
      }

      // 2) If not the NFT owner, check controller of configured agent wallet (AA)
      let agentAccount: string | null = null;
      try {
        agentAccount = (await client.readContract({
          address: identityRegistryAddress,
          abi: IDENTITY_ABI,
          functionName: 'getAgentWallet',
          args: [tokenId],
        })) as string;
      } catch (e) {
        // If getAgentWallet is unavailable on a deployment, fall back to false.
        console.warn('[AgenticTrustClient.isOwner] getAgentWallet failed:', e);
        agentAccount = null;
      }

      if (!agentAccount || !agentAccount.startsWith('0x')) {
        return false;
      }

      // Get bytecode to check if it's a contract
      const code = await client.getBytecode({ address: agentAccount as Address });

      // EOA ownership: direct address comparison
      if (!code || code === '0x') {
        return agentAccount.toLowerCase() === lowerWallet;
      }

      // Smart contract ownership: try different patterns
      let controller: string | null = null;

      // Try ERC-173 owner() function
      try {
        controller = (await client.readContract({
          address: agentAccount as Address,
          abi: [
            {
              name: 'owner',
              type: 'function',
              stateMutability: 'view' as const,
              inputs: [],
              outputs: [{ type: 'address' }],
            },
          ],
          functionName: 'owner',
        })) as string;
      } catch {
        // ignore
      }

      // Fallback: try getOwner() function
      if (!controller) {
        try {
          controller = (await client.readContract({
            address: agentAccount as Address,
            abi: [
              {
                name: 'getOwner',
                type: 'function',
                stateMutability: 'view' as const,
                inputs: [],
                outputs: [{ type: 'address' }],
              },
            ],
            functionName: 'getOwner',
          })) as string;
        } catch {
          // ignore
        }
      }

      // Fallback: try owners() array function
      if (!controller) {
        try {
          const owners = (await client.readContract({
            address: agentAccount as Address,
            abi: [
              {
                name: 'owners',
                type: 'function',
                stateMutability: 'view' as const,
                inputs: [],
                outputs: [{ type: 'address[]' }],
              },
            ],
            functionName: 'owners',
          })) as string[];
          controller = owners?.[0] ?? null;
        } catch {
          // ignore
        }
      }

      return Boolean(controller && controller.toLowerCase() === lowerWallet);
    } catch (error) {
      console.warn('[AgenticTrustClient.isOwner] Ownership check failed:', error);
      return false;
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
  async getAgentDetailsByDid(
    did8004: string,
    options?: { includeRegistration?: boolean },
  ): Promise<AgentDetail> {
    // loadAgentDetail will parse did:8004 and derive chainId/agentId internally.
    return loadAgentDetail(this, did8004, DEFAULT_CHAIN_ID, options);
  }

  /**
   * UAID-first detail lookup (KB v2).
   * Resolves UAID -> did:8004 via discovery, then reuses the existing did-based loader.
   */
  async getAgentDetailsByUaid(
    uaid: string,
    options?: { includeRegistration?: boolean },
  ): Promise<AgentDetail> {
    const trimmed = String(uaid ?? '').trim();
    if (!trimmed) {
      throw new Error('uaid is required');
    }

    const discoveryClient = await getDiscoveryClient();
    const agent = await (discoveryClient as any).getAgentByUaid?.(trimmed);
    const did8004 = typeof agent?.didIdentity === 'string' ? agent.didIdentity : null;
    if (!did8004 || !did8004.startsWith('did:8004:')) {
      throw new Error(`Agent not found for uaid=${trimmed}`);
    }

    return loadAgentDetail(this, did8004, DEFAULT_CHAIN_ID, options);
  }

  /**
   * UAID universal resolver: UAID -> target DID -> DID-method resolver.
   *
   * IMPORTANT: UAIDs are not guaranteed to be did:8004. They may target did:ethr, did:web, etc.
   *
   * Policy:
   * - did:8004 -> use existing on-chain aware loader
   * - otherwise -> KB-first details (no on-chain), return empty on-chain sections
   */
  async getAgentDetailsByUaidUniversal(
    uaid: string,
    options?: { includeRegistration?: boolean },
  ): Promise<AgentDetail> {
    const { parseHcs14UaidDidTarget } = await import('../lib/uaid');
    const parsed = parseHcs14UaidDidTarget(uaid);
    const targetDid = parsed.targetDid;

    // If UAID targets did:8004, we can reuse the full loader.
    if (targetDid.startsWith('did:8004:')) {
      return this.getAgentDetailsByDid(targetDid, options);
    }

    // Otherwise: fetch via KB by UAID and return a best-effort "details" view (no on-chain).
    const discoveryClient = await getDiscoveryClient();
    const agent = await (discoveryClient as any).getAgentByUaid?.(parsed.uaid);
    if (!agent) {
      throw new Error(`Agent not found for uaid=${parsed.uaid}`);
    }

    // If KB can supply a did:8004 identity for this UAID, upgrade to the full loader.
    const did8004 = typeof agent.didIdentity === 'string' ? agent.didIdentity : null;
    if (did8004 && did8004.startsWith('did:8004:')) {
      return this.getAgentDetailsByDid(did8004, options);
    }

    // Build a minimal AgentDetail payload.
    return {
      success: true,
      agentId: String(agent.agentId ?? parsed.uaid),
      agentName: String(agent.agentName ?? parsed.uaid),
      chainId: typeof agent.chainId === 'number' ? agent.chainId : 0,
      agentAccount: String(agent.agentAccount ?? ''),
      agentIdentityOwnerAccount: String(agent.agentIdentityOwnerAccount ?? ''),
      eoaAgentIdentityOwnerAccount: (agent as any).eoaAgentIdentityOwnerAccount ?? null,
      eoaAgentAccount: (agent as any).eoaAgentAccount ?? null,
      didIdentity: (agent as any).didIdentity ?? null,
      didAccount: (agent as any).didAccount ?? null,
      didName: (agent as any).didName ?? null,
      agentUri: (agent as any).agentUri ?? null,
      createdAtBlock: typeof (agent as any).createdAtBlock === 'number' ? (agent as any).createdAtBlock : 0,
      createdAtTime:
        typeof (agent as any).createdAtTime === 'number'
          ? (agent as any).createdAtTime
          : Number((agent as any).createdAtTime ?? 0) || 0,
      updatedAtTime:
        typeof (agent as any).updatedAtTime === 'number'
          ? (agent as any).updatedAtTime
          : (agent as any).updatedAtTime != null
            ? Number((agent as any).updatedAtTime)
            : null,
      type: (agent as any).type ?? null,
      description: (agent as any).description ?? null,
      image: (agent as any).image ?? null,
      a2aEndpoint: (agent as any).a2aEndpoint ?? null,
      mcpEndpoint: (agent as any).mcpEndpoint ?? null,
      supportedTrust: (agent as any).supportedTrust ?? null,
      rawJson: (agent as any).rawJson ?? null,
      agentCardJson: (agent as any).agentCardJson ?? null,
      agentCardReadAt: (agent as any).agentCardReadAt ?? null,
      did: (agent as any).did ?? null,
      mcp: (agent as any).mcp ?? null,
      x402support: (agent as any).x402support ?? null,
      active: (agent as any).active ?? null,
      feedbackCount: (agent as any).feedbackCount ?? null,
      feedbackAverageScore: (agent as any).feedbackAverageScore ?? null,
      validationPendingCount: (agent as any).validationPendingCount ?? null,
      validationCompletedCount: (agent as any).validationCompletedCount ?? null,
      validationRequestedCount: (agent as any).validationRequestedCount ?? null,
      initiatedAssociationCount: (agent as any).initiatedAssociationCount ?? null,
      approvedAssociationCount: (agent as any).approvedAssociationCount ?? null,
      atiOverallScore: (agent as any).atiOverallScore ?? null,
      atiOverallConfidence: (agent as any).atiOverallConfidence ?? null,
      atiVersion: (agent as any).atiVersion ?? null,
      atiComputedAt: (agent as any).atiComputedAt ?? null,
      atiBundleJson: (agent as any).atiBundleJson ?? null,
      trustLedgerScore: (agent as any).trustLedgerScore ?? null,
      trustLedgerBadgeCount: (agent as any).trustLedgerBadgeCount ?? null,
      trustLedgerOverallRank: (agent as any).trustLedgerOverallRank ?? null,
      trustLedgerCapabilityRank: (agent as any).trustLedgerCapabilityRank ?? null,

      // On-chain sections: empty for non-chain UAIDs.
      identityMetadata: { tokenUri: null, metadata: {} },
      identityRegistration: null,

      // Preserve discovery record for UI inspection.
      discovery: agent as any,
      uaid: parsed.uaid,
      targetDid,
    };
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
   * Search validation requests for an agent using GraphQL
   */
  async searchValidationRequestsAdvanced(params: {
    chainId: number;
    agentId: string | number;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: 'ASC' | 'DESC';
  }): Promise<{ validationRequests: Array<Record<string, unknown>> } | null> {
    const { getDiscoveryClient } = await import('./discoveryClient');
    const discoveryClient = await getDiscoveryClient();
    if (!discoveryClient || typeof discoveryClient.searchValidationRequestsAdvanced !== 'function') {
      return null;
    }
    return await discoveryClient.searchValidationRequestsAdvanced(params);
  }

  /**
   * Search feedback for an agent using GraphQL
   */
  async searchFeedbackAdvanced(params: {
    chainId: number;
    agentId: string | number;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: 'ASC' | 'DESC';
  }): Promise<{ feedbacks: Array<Record<string, unknown>> } | null> {
    const { getDiscoveryClient } = await import('./discoveryClient');
    const discoveryClient = await getDiscoveryClient();
    if (!discoveryClient || typeof discoveryClient.searchFeedbackAdvanced !== 'function') {
      return null;
    }
    return await discoveryClient.searchFeedbackAdvanced(params);
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

