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
import { createFeedbackAuth, type RequestAuthParams } from './agentFeedback';
import type {
  AgentData as DiscoveryAgentData,
  GiveFeedbackParams,
} from '@agentic-trust/8004-ext-sdk';
import { parse8004Did } from '@agentic-trust/8004-ext-sdk';
import { getProviderApp } from '../userApps/providerApp';
import { getReputationClient } from '../singletons/reputationClient';
import { getIPFSStorage } from '../../storage/ipfs';
import { getIdentityClient } from '../singletons/identityClient';
import { DEFAULT_CHAIN_ID } from './chainConfig';
import type { AgentDetail, AgentIdentifier } from '../models/agentDetail';

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
   * Feedback API
   */
  feedback = {

    requestAuth: async (params: {
      clientAddress: `0x${string}`;
      agentId?: bigint | string;
      skillId?: string;
      expirySeconds?: number;
    }): Promise<{ 
      feedbackAuth: `0x${string}`; 
      agentId: string;
      clientAddress: `0x${string}`;
      skill: string;
    }> => {

      const providerApp = await getProviderApp();
      if (!providerApp) {
        throw new Error('provider app not initialized');
      }


      const clientAddress = params.clientAddress;
      console.info("----------> clientAddress inside agent.ts -----> ", clientAddress);


      
      // Use agentId from params, stored agentId, or provider app
      const agentId = params.agentId 
        ? BigInt(params.agentId)
        : (this.data.agentId ? BigInt(this.data.agentId) : providerApp.agentId);
      
      // Get reputation client singleton
      
      const reputationClient = await getReputationClient();
      
      // Create feedback auth using provider app's wallet client
      const feedbackAuth = await createFeedbackAuth(
        {
          publicClient: providerApp.publicClient,
          agentId,
          clientAddress,
          signer: providerApp.agentAccount,
          walletClient: providerApp.walletClient as any,
          expirySeconds: params.expirySeconds
        },
        reputationClient
      );
      
      return {
        feedbackAuth,
        agentId: agentId.toString(),
        clientAddress,
        skill: params.skillId || 'agent.feedback.requestAuth',
      };
    },

    /**
     * Submit client feedback to the reputation contract
     * @param params - Feedback parameters including score, feedback, feedbackAuth, etc.
     * @returns Transaction result with txHash
     * @throws Error if reputation client is not initialized
     */
    giveFeedback: async (params: Omit<GiveFeedbackParams, 'agent' | 'agentId'> & { agentId?: string, clientAddress?: `0x${string}` }): Promise<{ txHash: string }> => {

      const { getClientApp } = await import('../userApps/clientApp');
      
      const reputationClient = await getReputationClient();
      const clientApp = await getClientApp();

      // Use the agentId from the agent data if not provided
      const agentId = params.agentId ?? (this.data.agentId ? this.data.agentId.toString() : undefined);
      if (!agentId) {
        throw new Error('agentId is required. Provide it in params or ensure agent has agentId in data.');
      }


      // Build the full feedback params (without clientAddress as it's not in the type)
      const feedbackParams: GiveFeedbackParams = {
        ...params,
        agent: agentId,
        agentId,
      };

      return await reputationClient.giveClientFeedback(feedbackParams);
    },
  };
}

/**
 * Build a detailed Agent view using a provided AgenticTrustClient.
 * This is the core implementation used by admin and other services.
 */
export async function buildAgentDetail(
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
    const parsed = parse8004Did(did8004);
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

  const tokenURI = await identityClient.getTokenURI(agentIdBigInt);

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
    tokenURI,
    metadata,
  };

  let identityRegistration: {
    tokenURI: string;
    registration: Record<string, unknown> | null;
  } | null =
    null;
  if (tokenURI) {
    try {
      const ipfsStorage = getIPFSStorage();
      const registration = (await ipfsStorage.getJson(tokenURI)) as Record<string, unknown> | null;
      identityRegistration = {
        tokenURI,
        registration,
      };
    } catch (error) {
      console.warn('Failed to get IPFS registration:', error);
      identityRegistration = {
        tokenURI,
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
  }

  if (metadata.agentName && !flattened.name) flattened.name = metadata.agentName;
  if (metadata.agentName) flattened.agentName = metadata.agentName;
  if (metadata.agentAccount) flattened.agentAccount = metadata.agentAccount;

  if (discovery && typeof discovery === 'object') {
    const discoveryRecord = discovery as Record<string, unknown>;

    const agentNameFromDiscovery =
      typeof discoveryRecord.agentName === 'string'
        ? (discoveryRecord.agentName as string)
        : undefined;
    if (agentNameFromDiscovery && !flattened.name) flattened.name = agentNameFromDiscovery;
    if (agentNameFromDiscovery && !flattened.agentName) flattened.agentName = agentNameFromDiscovery;

    const a2aEndpointFromDiscovery =
      typeof discoveryRecord.a2aEndpoint === 'string'
        ? (discoveryRecord.a2aEndpoint as string)
        : undefined;
    if (a2aEndpointFromDiscovery) flattened.a2aEndpoint = a2aEndpointFromDiscovery;

    const createdAtTimeFromDiscovery =
      typeof discoveryRecord.createdAtTime !== 'undefined'
        ? discoveryRecord.createdAtTime
        : undefined;
    if (createdAtTimeFromDiscovery !== undefined) flattened.createdAtTime = createdAtTimeFromDiscovery;

    const updatedAtTimeFromDiscovery =
      typeof discoveryRecord.updatedAtTime !== 'undefined'
        ? discoveryRecord.updatedAtTime
        : undefined;
    if (updatedAtTimeFromDiscovery !== undefined) flattened.updatedAtTime = updatedAtTimeFromDiscovery;

    Object.keys(discoveryRecord).forEach((key) => {
      if (key !== 'agentId' && flattened[key] === undefined) {
        flattened[key] = discoveryRecord[key];
      }
    });
  }

  const discoveryRecord = (discovery as Record<string, unknown>) || {};

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
    metadataURI: (discoveryRecord.metadataURI as string | null | undefined) ?? null,
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
    supportedTrust:
      (flattened.supportedTrust as string | undefined) ??
      (discoveryRecord.supportedTrust as string | undefined) ??
      null,
    rawJson: (discoveryRecord.rawJson as string | null | undefined) ?? null,
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

  return detail;
}

