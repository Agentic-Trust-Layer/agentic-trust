/**
 * Agent class
 * 
 * Represents a discovered agent with protocol support (A2A, MCP, etc.)
 * Abstracts protocol details so clients can interact with agents without
 * knowing the underlying protocol implementation.
 */

import type { AgenticTrustClient } from '../singletons/agenticTrustClient';
import { A2AProtocolProvider } from './a2aProtocolProvider';
import type {
  A2AAgentCard as AgentCard,
  AgentSkill,
  AgentCapabilities,
} from '../models/a2aAgentCardInfo';
import type { AgentData as DiscoveryAgentData, GiveFeedbackParams } from '@agentic-trust/8004-ext-sdk';
import { parseDid8004 } from '@agentic-trust/8004-ext-sdk';
import { getProviderApp } from '../userApps/providerApp';
import { getReputationClient } from '../singletons/reputationClient';
import { getIPFSStorage } from './ipfs';
import { getIdentityClient } from '../singletons/identityClient';
import { DEFAULT_CHAIN_ID, requireChainEnvVar } from './chainConfig';
import { ethers } from 'ethers';
import type { AgentDetail, AgentIdentifier } from '../models/agentDetail';
import type { FeedbackFile } from '@agentic-trust/8004-sdk';

// Re-export types
export type {
  A2AAgentCard as AgentCard,
  AgentSkill,
  AgentCapabilities,
} from '../models/a2aAgentCardInfo';

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

export interface FeedbackAuthParams {
  clientAddress: `0x${string}`;
  agentId?: string | number | bigint;
  indexLimit?: number;
  expirySeconds?: number;
  chainId?: number;
  skillId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface FeedbackAuthResult {
  feedbackAuthId: string;
  agentId: string;
  chainId: number;
  payload: Record<string, unknown>;
  response: MessageResponse;
}

export interface FeedbackAuthIssueParams {
  clientAddress: `0x${string}`;
  agentId?: bigint | string;
  skillId?: string;
  expirySeconds?: number;
}

export type GiveFeedbackInput = Omit<GiveFeedbackParams, 'agent' | 'agentId'> & {
  agentId?: string;
  clientAddress?: `0x${string}`;
  skill?: string;
  context?: string;
  capability?: string;
};

/**
 * Agent data from discovery (GraphQL)
 */
export type AgentData = DiscoveryAgentData;

/**
 * Agent class - represents a discovered agent with protocol support
 */
export class Agent {
  private a2aProvider: A2AProtocolProvider | null = null;
  private agentCard: AgentCard | null = null;
  private endpoint: { providerId: string; endpoint: string; method?: string } | null = null;
  private initialized: boolean = false;

  constructor(
    public readonly data: AgentData,
    private readonly client: AgenticTrustClient
  ) {
    // Auto-initialize if agent has an a2aEndpoint
    if (this.data.a2aEndpoint) {
      this.initialize();
    }
  }

  /**
   * Get agent ID
   */
  get agentId(): number | undefined {
    const { agentId } = this.data;
    if (typeof agentId === 'number') {
      return agentId;
    }
    if (typeof agentId === 'string') {
      const parsed = Number(agentId);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  /**
   * Get agent name
   */
  get agentName(): string | undefined {
    return this.data.agentName;
  }

  /**
   * Get agent account address
   */
  get agentAccount(): string | undefined {
    const account = this.data.agentAccount;
    if (typeof account === 'string' && account.trim().length > 0) {
      return account;
    }
    const legacyAddress = (this.data as Record<string, unknown>).agentAddress;
    if (typeof legacyAddress === 'string' && legacyAddress.trim().length > 0) {
      return legacyAddress;
    }
    return undefined;
  }

  /**
   * Backwards-compatible alias for agentAccount
   */
  get agentAddress(): string | undefined {
    return this.agentAccount;
  }

  /**
   * Get agent owner address
   */
  get agentOwner(): string | undefined {
    const owner = this.data.agentOwner;
    if (typeof owner === 'string' && owner.trim().length > 0) {
      return owner;
    }
    return undefined;
  }

  /**
   * Get identity DID (e.g. did:8004)
   */
  get didIdentity(): string | null | undefined {
    const value = (this.data as Record<string, unknown>).didIdentity;
    if (value === null) {
      return null;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return undefined;
  }

  /**
   * Get account DID (e.g. did:ethr)
   */
  get didAccount(): string | null | undefined {
    const value = (this.data as Record<string, unknown>).didAccount;
    if (value === null) {
      return null;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return undefined;
  }

  /**
   * Get name DID (e.g. did:ens)
   */
  get didName(): string | null | undefined {
    const value = (this.data as Record<string, unknown>).didName;
    if (value === null) {
      return null;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return undefined;
  }

  /**
   * Get A2A endpoint URL
   */
  get a2aEndpoint(): string | undefined {
    return typeof this.data.a2aEndpoint === 'string'
      ? this.data.a2aEndpoint
      : undefined;
  }


  private initialize(): void {
    if (this.initialized) {
      return;
    }

    if (!this.data.a2aEndpoint) {
      return; // No endpoint, agent cannot be initialized
    }

    // Get Veramo agent from the client
    const veramoAgent = this.client.veramo.getAgent();

    // Create A2A Protocol Provider for this agent
    // This does NOT fetch the agent card - card is fetched lazily when needed
    this.a2aProvider = new A2AProtocolProvider(this.data.a2aEndpoint, veramoAgent);

    this.initialized = true;
  }


  isInitialized(): boolean {
    return this.initialized;
  }

  async fetchCard(): Promise<AgentCard | null> {
    if (!this.a2aProvider) {
      throw new Error('Agent not initialized. Call initialize(client) first.');
    }

    // Lazy load: only fetch if not already cached
    if (!this.agentCard) {
      this.agentCard = await this.a2aProvider.fetchAgentCard();
    }

    return this.agentCard;
  }

  getCard(): AgentCard | null {
    return this.agentCard;
  }

  async getSkills(): Promise<AgentSkill[]> {
    const card = await this.fetchCard(); // Lazy load
    return card?.skills || [];
  }

  async getCapabilities(): Promise<AgentCapabilities | null> {
    const card = await this.fetchCard(); // Lazy load
    return card?.capabilities || null;
  }

  async supportsProtocol(): Promise<boolean> {
    if (!this.a2aProvider) {
      return false;
    }

    const card = await this.fetchCard();
    return card !== null && 
           card.skills !== undefined && 
           card.skills.length > 0 && 
           card.url !== undefined;
  }


  async getEndpoint(): Promise<{ providerId: string; endpoint: string; method?: string } | null> {
    if (!this.a2aProvider) {
      throw new Error('Agent not initialized. Call initialize(client) first.');
    }

    if (!this.endpoint) {
      const endpointInfo = await this.a2aProvider.getA2AEndpoint();
      if (endpointInfo) {
        this.endpoint = {
          providerId: endpointInfo.providerId,
          endpoint: endpointInfo.endpoint,
          method: endpointInfo.method,
        };
      }
    }

    return this.endpoint;
  }

  /**
   * Send a message to the agent
   */
  async sendMessage(request: MessageRequest): Promise<MessageResponse> {
    if (!this.a2aProvider) {
      throw new Error('Agent not initialized. Call initialize(client) first.');
    }

    // Check if agent has a valid A2A endpoint
    if (!this.data.a2aEndpoint) {
      throw new Error(
        'Agent does not have an A2A endpoint configured. ' +
        'The agent must have a valid A2A endpoint URL to receive messages.'
      );
    }

    // Build A2A request format
    const endpointInfo = await this.getEndpoint();
    if (!endpointInfo) {
      throw new Error('Agent endpoint not available');
    }

    const a2aRequest = {
      fromAgentId: 'client',
      toAgentId: endpointInfo.providerId,
      message: request.message,
      payload: request.payload,
      metadata: request.metadata,
      skillId: request.skillId,
    };

    const response = await this.a2aProvider.sendMessage(a2aRequest);
    return response;
  }

  /**
   * Verify the agent by sending an authentication challenge
   * Creates a signed challenge and sends it to the agent's endpoint
   * This will force a fresh authentication challenge even if already authenticated
   * @returns true if verification passed, false otherwise
   */
  async verify(): Promise<boolean> {
    if (!this.a2aProvider) {
      throw new Error('Agent not initialized. Call initialize(client) first.');
    }

    try {
      // Get endpoint info
      const endpointInfo = await this.getEndpoint();
      if (!endpointInfo) {
        throw new Error('Agent endpoint not available');
      }

      // Get agent card to determine audience for challenge
      const agentCard = await this.fetchCard();
      if (!agentCard?.provider?.url) {
        throw new Error('Agent card URL is required for verification');
      }

      // Reset authentication state to force a fresh challenge
      // Access the private authenticated flag via type assertion
      (this.a2aProvider as any).authenticated = false;

      // Create a signed challenge using the A2A protocol provider
      // We'll send a minimal message with auth to test verification
      const a2aRequest = {
        fromAgentId: 'client',
        toAgentId: endpointInfo.providerId,
        message: 'verify', // Minimal message for verification
        payload: {},
      };

      // The sendMessage will automatically create and include auth challenge
      // since we reset authenticated to false
      const response = await this.a2aProvider.sendMessage(a2aRequest);

      // If the response is successful and doesn't contain authentication errors,
      // verification passed
      if (response.success === false) {
        // Check if it's an authentication error
        if (response.error?.includes('authentication') || 
            response.error?.includes('Authentication failed')) {
          return false;
        }
        // Other errors might be acceptable (e.g., agent doesn't understand the message)
        // but verification itself passed if no auth error
        return true;
      }

      // Success response means verification passed
      return true;
    } catch (error) {
      // If error contains authentication failure, verification failed
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('authentication') || 
          errorMessage.includes('Authentication failed')) {
        return false;
      }
      // Other errors might indicate verification failed
      console.error('Verification error:', error);
      return false;
  }
}

  /**
   * Request a feedback authorization token from the agent's A2A endpoint.
   * Automatically verifies the agent (unless skipVerify=true) before sending the requestAuth message.
   */
  async getFeedbackAuth(params: FeedbackAuthParams): Promise<FeedbackAuthResult> {
    const clientAddress = params.clientAddress?.toLowerCase();
    if (
      !clientAddress ||
      !clientAddress.startsWith('0x') ||
      clientAddress.length !== 42
    ) {
      throw new Error('clientAddress must be a 0x-prefixed 20-byte address');
    }

    const resolvedChainId =
      typeof params.chainId === 'number'
        ? params.chainId
        : Number.isFinite((this.data as any)?.chainId)
          ? Number((this.data as any).chainId)
          : DEFAULT_CHAIN_ID;

    const resolveAgentId = (
      value: string | number | bigint | undefined,
    ): string | undefined => {
      if (value === undefined || value === null) {
        return undefined;
      }
      try {
        return BigInt(value as any).toString();
      } catch {
        const stringified = String(value).trim();
        return stringified.length > 0 ? stringified : undefined;
      }
    };

    const resolvedAgentId =
      resolveAgentId(params.agentId) ?? resolveAgentId(this.data.agentId);

    if (!resolvedAgentId) {
      throw new Error('Agent ID is required to request feedback auth.');
    }

    const verified = await this.verify();
    if (!verified) {
      throw new Error('Agent verification failed before requesting feedback auth.');
    }

    const payload: Record<string, unknown> = {
      clientAddress,
    };

    const numericAgentId = Number.parseInt(resolvedAgentId, 10);
    payload.agentId = Number.isFinite(numericAgentId)
      ? numericAgentId
      : resolvedAgentId;

    if (typeof params.indexLimit === 'number' && params.indexLimit > 0) {
      payload.indexLimit = params.indexLimit;
    }

    if (typeof params.expirySeconds === 'number' && params.expirySeconds > 0) {
      payload.expirySeconds = params.expirySeconds;
    }

    const skillId = params.skillId ?? 'agent.feedback.requestAuth';
    const message = params.message ?? 'Request feedback authorization';
    const metadata: Record<string, unknown> = {
      ...(params.metadata || {}),
      requestType: 'feedbackAuth',
      agentId: resolvedAgentId,
      chainId: resolvedChainId,
    };

    const messageRequest: MessageRequest = {
      message,
      payload,
      metadata,
      skillId,
    };

    const response = await this.sendMessage(messageRequest);
    if (!response?.success) {
      throw new Error(response?.error || 'Provider rejected feedback auth request');
    }

    const providerPayload = (response.response || {}) as Record<string, unknown>;
    const feedbackAuthId =
      (providerPayload.feedbackAuth as string | undefined) ??
      (providerPayload.feedbackAuthId as string | undefined) ??
      (providerPayload.feedbackAuthID as string | undefined) ??
      null;

    if (!feedbackAuthId) {
      throw new Error('Provider response did not include feedbackAuth');
    }

    return {
      feedbackAuthId,
      agentId: resolvedAgentId,
      chainId: resolvedChainId,
      payload: providerPayload,
      response,
    };
  }

  /**
   * Issue a feedback authorization on behalf of this agent using the provider app's signer.
   */
  async requestAuth(params: FeedbackAuthIssueParams): Promise<{
    feedbackAuth: `0x${string}`;
    agentId: string;
    clientAddress: `0x${string}`;
    skill: string;
  }> {
    const providerApp = await getProviderApp();
    if (!providerApp) {
      throw new Error('provider app not initialized');
    }

    const clientAddress = params.clientAddress;
    if (
      !clientAddress ||
      typeof clientAddress !== 'string' ||
      !clientAddress.startsWith('0x')
    ) {
      throw new Error('clientAddress must be a 0x-prefixed address');
    }

    const agentId = params.agentId
      ? BigInt(params.agentId)
      : this.data.agentId
        ? BigInt(this.data.agentId)
        : providerApp.agentId;

    const feedbackAuth = await this.client.createFeedbackAuth({
      publicClient: providerApp.publicClient,
      agentId,
      clientAddress,
      signer: providerApp.agentAccount,
      walletClient: providerApp.walletClient as any,
      expirySeconds: params.expirySeconds,
    });

    return {
      feedbackAuth,
      agentId: agentId.toString(),
      clientAddress,
      skill: params.skillId || 'agent.feedback.requestAuth',
    };
  }

  /**
   * Submit client feedback to the reputation contract.
   */
  async giveFeedback(params: GiveFeedbackInput): Promise<{ txHash: string }> {
    const { getClientApp } = await import('../userApps/clientApp');

    const reputationClient = await getReputationClient();
    const clientApp = await getClientApp();

    const agentId =
      params.agentId ?? (this.data.agentId ? this.data.agentId.toString() : undefined);
    if (!agentId) {
      throw new Error(
        'agentId is required. Provide it in params or ensure agent has agentId in data.',
      );
    }

    const chainId =
      (this.data as any)?.chainId && Number.isFinite((this.data as any).chainId)
        ? Number((this.data as any).chainId)
        : DEFAULT_CHAIN_ID;

    let agentRegistry = '';
    try {
      const identityRegistry = requireChainEnvVar(
        'AGENTIC_TRUST_IDENTITY_REGISTRY',
        chainId,
      );
      agentRegistry = `eip155:${chainId}:${identityRegistry}`;
    } catch (error) {
      console.warn(
        '[Agent.giveFeedback] Failed to resolve AGENTIC_TRUST_IDENTITY_REGISTRY; feedbackFile.agentRegistry will be empty:',
        error,
      );
    }

    const clientAddressHex: `0x${string}` | undefined =
      params.clientAddress ?? (clientApp?.address as `0x${string}` | undefined);
    const clientAddressCaip =
      clientAddressHex && typeof chainId === 'number'
        ? `eip155:${chainId}:${clientAddressHex}`
        : '';

    const feedbackFile: FeedbackFile = {
      agentRegistry,
      agentId: Number.parseInt(agentId, 10) || 0,
      clientAddress: clientAddressCaip || clientAddressHex || '',
      createdAt: new Date().toISOString(),
      feedbackAuth: params.feedbackAuth || '',
      score: params.score,
    };

    if (params.tag1) feedbackFile.tag1 = params.tag1;
    if (params.tag2) feedbackFile.tag2 = params.tag2;
    if (params.skill) (feedbackFile as any).skill = params.skill;
    if (params.context) (feedbackFile as any).context = params.context;
    if (params.capability) (feedbackFile as any).capability = params.capability;

    let feedbackUriFromIpfs: string | undefined;
    let feedbackHashFromIpfs: `0x${string}` | undefined;
    try {
      const ipfs = getIPFSStorage();
      const serialized = JSON.stringify(feedbackFile);
      const uploadResult = await ipfs.upload(serialized, 'feedback.json');
      feedbackUriFromIpfs = uploadResult.tokenUri;
      feedbackHashFromIpfs = ethers.keccak256(
        ethers.toUtf8Bytes(serialized),
      ) as `0x${string}`;
    } catch (error) {
      console.warn(
        '[Agent.giveFeedback] Failed to upload FeedbackFile to IPFS; continuing without feedbackUri/feedbackHash:',
        error,
      );
    }

    const {
      clientAddress: _clientAddress,
      skill: _skill,
      context: _context,
      capability: _capability,
      ...rest
    } = params as any;

    const feedbackParams: GiveFeedbackParams = {
      ...(rest as GiveFeedbackParams),
      agent: agentId,
      agentId,
      ...(feedbackUriFromIpfs && { feedbackUri: feedbackUriFromIpfs }),
      ...(feedbackHashFromIpfs && { feedbackHash: feedbackHashFromIpfs }),
    };

    return await reputationClient.giveClientFeedback(feedbackParams);
  }

}

/**
 * Load a detailed Agent view using a provided AgenticTrustClient.
 * This is the core implementation used by admin and other services.
 */
export async function loadAgentDetail(
  client: AgenticTrustClient,
  agentIdentifier: AgentIdentifier,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<AgentDetail> {
  const isDid =
    typeof agentIdentifier === 'string' && agentIdentifier.trim().startsWith('did:8004:');

  let resolvedChainId = chainId;
  let agentId: string;
  let agentIdBigInt: bigint;
  let did8004: string | undefined;

  if (isDid) {
    did8004 = decodeURIComponent((agentIdentifier as string).trim());
    const parsed = parseDid8004(did8004);
    resolvedChainId = parsed.chainId;
    agentId = parsed.agentId;
    try {
      agentIdBigInt = BigInt(agentId);
    } catch {
      throw new Error(`Invalid agentId in did:8004 identifier: ${did8004}`);
    }
  } else {
    const agentIdInput = agentIdentifier;
    agentIdBigInt =
      typeof agentIdInput === 'bigint'
        ? agentIdInput
        : (() => {
            try {
              return BigInt(agentIdInput);
            } catch {
              throw new Error(`Invalid agentId: ${agentIdInput}`);
            }
          })();
    agentId = agentIdBigInt.toString();
  }

  const identityClient = await getIdentityClient(resolvedChainId);

  const tokenUri = await identityClient.getTokenURI(agentIdBigInt);
  console.info("----------> tokenUri inside agent.ts -----> ", tokenUri);

  const METADATA_KEYS = ['agentName', 'agentAccount'] as const;
  type MetadataKeys = (typeof METADATA_KEYS)[number];
  const metadata: Record<MetadataKeys, string> = {} as Record<MetadataKeys, string>;
  for (const key of METADATA_KEYS) {
    try {
      const value = await identityClient.getMetadata(agentIdBigInt, key);
      if (value) {
        metadata[key] = value;
      }
    } catch (error) {
      console.warn(`Failed to get metadata key ${key}:`, error);
    }
  }

  const identityMetadata = {
    tokenUri,
    metadata,
  };

  let identityRegistration: {
    tokenUri: string;
    registration: Record<string, unknown> | null;
  } | null =
    null;
  if (tokenUri) {
    try {
      const ipfsStorage = getIPFSStorage();
      const registration = (await ipfsStorage.getJson(tokenUri)) as Record<string, unknown> | null;
      identityRegistration = {
        tokenUri,
        registration,
      };
      console.info("----------> identityRegistration inside agent.ts -----> ", identityRegistration);
    } catch (error) {
      console.warn('Failed to get IPFS registration:', error);
      identityRegistration = {
        tokenUri,
        registration: null,
      };
    }
  }

  let discovery: Record<string, unknown> | null = null;
  try {
    const agentsApi = client.agents as any;
    if (did8004 && typeof agentsApi.getAgentFromDiscoveryByDid === 'function') {
      discovery = (await agentsApi.getAgentFromDiscoveryByDid(
        did8004,
      )) as unknown as Record<string, unknown> | null;
    } else if (typeof agentsApi.getAgentFromDiscovery === 'function') {
      discovery = (await agentsApi.getAgentFromDiscovery(
        resolvedChainId,
        agentId,
      )) as unknown as Record<string, unknown> | null;
    } else {
      discovery = null;
    }
  } catch (error) {
    console.warn('Failed to get GraphQL agent data:', error);
    discovery = null;
  }

  const flattened: Record<string, unknown> = {};

  // Priority 1: Data from tokenUri/IPFS registration (highest priority - on-chain source of truth)
  if (
    identityRegistration?.registration &&
    typeof identityRegistration.registration === 'object'
  ) {
    const reg = identityRegistration.registration as Record<string, unknown>;
    if (typeof reg.name === 'string') flattened.name = reg.name;
    if (typeof reg.description === 'string') flattened.description = reg.description;
    if (typeof reg.image === 'string') flattened.image = reg.image;
    if (typeof reg.agentAccount === 'string') flattened.agentAccount = reg.agentAccount;
    if (reg.endpoints) flattened.endpoints = reg.endpoints;
    if (reg.supportedTrust) flattened.supportedTrust = reg.supportedTrust;
    if (typeof reg.createdAt !== 'undefined') flattened.createdAt = reg.createdAt;
    if (typeof reg.updatedAt !== 'undefined') flattened.updatedAt = reg.updatedAt;
    
    // Extract a2aEndpoint from registration
    // Priority: 1) direct a2aEndpoint field, 2) from endpoints array (name: 'A2A'), 3) from agentUrl
    if (typeof reg.a2aEndpoint === 'string') {
      flattened.a2aEndpoint = reg.a2aEndpoint;
    } else if (Array.isArray(reg.endpoints)) {
      // Find A2A endpoint in endpoints array
      const a2aEndpointEntry = reg.endpoints.find(
        (ep: unknown) =>
          typeof ep === 'object' &&
          ep !== null &&
          'name' in ep &&
          (ep as { name: string }).name === 'A2A' &&
          'endpoint' in ep &&
          typeof (ep as { endpoint: unknown }).endpoint === 'string'
      ) as { endpoint: string } | undefined;
      if (a2aEndpointEntry) {
        flattened.a2aEndpoint = a2aEndpointEntry.endpoint;
      }
    }
    // If agentUrl exists and a2aEndpoint not found, construct it
    if (!flattened.a2aEndpoint && typeof reg.agentUrl === 'string') {
      const baseUrl = (reg.agentUrl as string).replace(/\/$/, '');
      flattened.a2aEndpoint = `${baseUrl}/.well-known/agent-card.json`;
    }
    // Also check external_url as fallback
    if (!flattened.a2aEndpoint && typeof reg.external_url === 'string') {
      const baseUrl = (reg.external_url as string).replace(/\/$/, '');
      flattened.a2aEndpoint = `${baseUrl}/.well-known/agent-card.json`;
    }
  }

  // Priority 2: On-chain metadata (only fill if not already set from registration)
  if (metadata.agentName && !flattened.name) flattened.name = metadata.agentName;
  if (metadata.agentName && !flattened.agentName) flattened.agentName = metadata.agentName;
  if (metadata.agentAccount && !flattened.agentAccount) flattened.agentAccount = metadata.agentAccount;

  // Priority 3: Discovery data (GraphQL indexer) - only as fallback when not available from on-chain sources
  const discoveryRecord = (discovery as Record<string, unknown>) || {};
  if (discovery && typeof discovery === 'object') {

    // Only use discovery data if not already set from tokenUri/metadata
    const agentNameFromDiscovery =
      typeof discoveryRecord.agentName === 'string'
        ? (discoveryRecord.agentName as string)
        : undefined;
    if (agentNameFromDiscovery && !flattened.name) flattened.name = agentNameFromDiscovery;
    if (agentNameFromDiscovery && !flattened.agentName) flattened.agentName = agentNameFromDiscovery;

    // a2aEndpoint from discovery only if not in registration
    const a2aEndpointFromDiscovery =
      typeof discoveryRecord.a2aEndpoint === 'string'
        ? (discoveryRecord.a2aEndpoint as string)
        : undefined;
    if (a2aEndpointFromDiscovery && !flattened.a2aEndpoint) {
      flattened.a2aEndpoint = a2aEndpointFromDiscovery;
    }

    // Timestamps from discovery only if not in registration
    const createdAtTimeFromDiscovery =
      typeof discoveryRecord.createdAtTime !== 'undefined'
        ? discoveryRecord.createdAtTime
        : undefined;
    if (createdAtTimeFromDiscovery !== undefined && flattened.createdAtTime === undefined) {
      flattened.createdAtTime = createdAtTimeFromDiscovery;
    }

    const updatedAtTimeFromDiscovery =
      typeof discoveryRecord.updatedAtTime !== 'undefined'
        ? discoveryRecord.updatedAtTime
        : undefined;
    if (updatedAtTimeFromDiscovery !== undefined && flattened.updatedAtTime === undefined) {
      flattened.updatedAtTime = updatedAtTimeFromDiscovery;
    }

    // Fill in any other discovery fields that aren't already set
    // Exclude tokenUri and rawJson - these should come from on-chain sources only
    Object.keys(discoveryRecord).forEach((key) => {
      if (key !== 'agentId' && key !== 'tokenUri' && key !== 'rawJson' && flattened[key] === undefined) {
        flattened[key] = discoveryRecord[key];
      }
    });
  }

  // Prioritize: flattened (from tokenUri/IPFS/metadata) > discoveryRecord
  const agentNameValue =
    (flattened.agentName as string | undefined) ??
    (flattened.name as string | undefined) ??
    (discoveryRecord.agentName as string | undefined) ??
    '';

  const agentAccountValue =
    (flattened.agentAccount as string | undefined) ??
    (discoveryRecord.agentAccount as string | undefined) ??
    '';

  const agentOwnerValue =
    (discoveryRecord.agentOwner as string | undefined) ?? '';

  const detail: AgentDetail = {
    // AgentInfo fields
    agentId,
    agentName: agentNameValue,
    chainId: resolvedChainId,
    agentAccount: agentAccountValue,
    agentOwner: agentOwnerValue,
    didIdentity: (discoveryRecord.didIdentity as string | null | undefined) ?? null,
    didAccount: (discoveryRecord.didAccount as string | null | undefined) ?? null,
    didName: (discoveryRecord.didName as string | null | undefined) ?? null,
    // tokenUri and rawJson will be set after the spread to ensure they're not overwritten
    createdAtBlock:
      typeof discoveryRecord.createdAtBlock === 'number' ? discoveryRecord.createdAtBlock : 0,
    createdAtTime:
      typeof discoveryRecord.createdAtTime === 'number'
        ? discoveryRecord.createdAtTime
        : (flattened.createdAtTime as number | undefined) ?? 0,
    updatedAtTime:
      typeof discoveryRecord.updatedAtTime === 'number'
        ? discoveryRecord.updatedAtTime
        : (flattened.updatedAtTime as number | undefined) ?? null,
    type: (discoveryRecord.type as string | null | undefined) ?? null,
    // Prioritize: flattened (from tokenUri/IPFS) > discoveryRecord
    description:
      (flattened.description as string | undefined) ??
      (discoveryRecord.description as string | undefined) ??
      null,
    image:
      (flattened.image as string | undefined) ??
      (discoveryRecord.image as string | undefined) ??
      null,
    a2aEndpoint:
      (flattened.a2aEndpoint as string | undefined) ??
      (discoveryRecord.a2aEndpoint as string | undefined) ??
      null,
    ensEndpoint: (discoveryRecord.ensEndpoint as string | null | undefined) ?? null,
    agentAccountEndpoint:
      (discoveryRecord.agentAccountEndpoint as string | null | undefined) ?? null,
    // Prioritize: flattened (from tokenUri/IPFS) > discoveryRecord
    supportedTrust:
      (flattened.supportedTrust as string | undefined) ??
      (discoveryRecord.supportedTrust as string | undefined) ??
      null,
    did: (discoveryRecord.did as string | null | undefined) ?? null,
    mcp:
      typeof discoveryRecord.mcp === 'boolean'
        ? discoveryRecord.mcp
        : (discoveryRecord.mcp as boolean | null | undefined) ?? null,
    x402support:
      typeof discoveryRecord.x402support === 'boolean'
        ? discoveryRecord.x402support
        : (discoveryRecord.x402support as boolean | null | undefined) ?? null,
    active:
      typeof discoveryRecord.active === 'boolean'
        ? discoveryRecord.active
        : (discoveryRecord.active as boolean | null | undefined) ?? null,

    // AgentDetail-specific fields
    success: true,
    identityMetadata,
    identityRegistration,
    discovery,

    // Flattened extra fields
    ...flattened,
  };

  // Set tokenUri and rawJson AFTER spread to ensure on-chain values take precedence
  // Use on-chain tokenUri as primary source (from contract), fallback to discovery only if on-chain is null/undefined
  // Use identityMetadata.tokenUri to ensure we're using the value retrieved from contract
  detail.tokenUri = (identityMetadata.tokenUri !== null && identityMetadata.tokenUri !== undefined) 
    ? identityMetadata.tokenUri 
    : ((discoveryRecord.tokenUri as string | null | undefined) ?? null);
  
  // Use registration JSON from tokenUri/IPFS as primary source, fallback to discovery
  detail.rawJson = identityRegistration?.registration
    ? JSON.stringify(identityRegistration.registration, null, 2)
    : ((discoveryRecord.rawJson as string | null | undefined) ?? null);

  console.info("----------> detail inside agent.ts -----> ", detail);

  return detail;
}

/**
 * @deprecated Use loadAgentDetail instead.
 */
export const buildAgentDetail = loadAgentDetail;

