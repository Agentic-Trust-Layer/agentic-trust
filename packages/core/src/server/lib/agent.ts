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
import { getReputationRegistryClient } from '../singletons/reputationClient';
import { getIPFSStorage } from './ipfs';
import { getIdentityRegistryClient } from '../singletons/identityClient';
import { getDiscoveryClient } from '../singletons/discoveryClient';
import { DEFAULT_CHAIN_ID, requireChainEnvVar } from './chainConfig';
import { ethers } from 'ethers';
import type { AgentDetail, AgentIdentifier } from '../models/agentDetail';
import type { FeedbackFile } from '@agentic-trust/8004-sdk';
import type { PreparedTransaction } from '../../client/walletSigning';
import type { SessionPackage } from '../../shared/sessionPackage';

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
  /**
   * Optional client-constructed ERC-8092 SAR payload to be forwarded to the provider
   * as part of `governance_and_trust/trust/trust_feedback_authorization`.
   */
  delegationSar?: unknown;
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
  existingAssociationId?: `0x${string}`; // If provided, use this existing on-chain association instead of creating a new one
}

export type GiveFeedbackInput = Omit<GiveFeedbackParams, 'agent' | 'agentId'> & {
  agentId?: string;
  clientAddress?: `0x${string}`;
  skill?: string;
  context?: string;
  capability?: string;
  feedbackAuth?: string;
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
  private endpoint: { providerId: string; url: string; method?: string } | null = null;
  private initialized: boolean = false;
  private sessionPackage: SessionPackage | null = null;

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
   * Get agent identity owner account (stored as "{chainId}:{0x...}")
   */
  get agentIdentityOwnerAccount(): string | undefined {
    const owner = (this.data as Record<string, unknown>).agentIdentityOwnerAccount;
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
   * Get validation pending count
   */
  get validationPendingCount(): number | undefined {
    const value = this.data.validationPendingCount;
    if (typeof value === 'number') {
      return value;
    }
    return undefined;
  }

  /**
   * Get validation completed count
   */
  get validationCompletedCount(): number | undefined {
    const value = this.data.validationCompletedCount;
    if (typeof value === 'number') {
      return value;
    }
    return undefined;
  }

  /**
   * Get validation requested count
   */
  get validationRequestedCount(): number | undefined {
    const value = this.data.validationRequestedCount;
    if (typeof value === 'number') {
      return value;
    }
    return undefined;
  }

  /**
   * Get feedback count
   */
  get feedbackCount(): number | undefined {
    const value = this.data.feedbackCount;
    if (typeof value === 'number') {
      return value;
    }
    return undefined;
  }

  /**
   * Get feedback average score
   */
  get feedbackAverageScore(): number | undefined {
    const value = this.data.feedbackAverageScore;
    if (typeof value === 'number') {
      return value;
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

    // Use the explicitly-defined A2A endpoint (no hostname/path rewriting).
    const a2aEndpointUrl = this.data.a2aEndpoint;

    // Create A2A Protocol Provider for this agent
    // This does NOT fetch the agent card - card is fetched lazily when needed
    this.a2aProvider = new A2AProtocolProvider(a2aEndpointUrl, veramoAgent);

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


  async getEndpoint(): Promise<{ providerId: string; url: string; method?: string } | null> {
    if (!this.a2aProvider) {
      throw new Error('Agent not initialized. Call initialize(client) first.');
    }

    if (!this.endpoint) {
      const endpointInfo = await this.a2aProvider.getA2AEndpoint();
      if (endpointInfo) {
        this.endpoint = {
          providerId: endpointInfo.providerId,
          url: endpointInfo.url,
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
    console.log('[Agent.sendMessage] Starting sendMessage');
    console.log('[Agent.sendMessage] Agent data:', {
      agentId: this.data.agentId,
      chainId: this.data.chainId,
      agentName: this.data.agentName,
      a2aEndpoint: this.data.a2aEndpoint,
      initialized: this.initialized,
      hasA2aProvider: !!this.a2aProvider,
    });
    
    if (!this.a2aProvider) {
      console.error('[Agent.sendMessage] A2A provider not initialized');
      throw new Error('Agent not initialized. Call initialize(client) first.');
    }

    // Check if agent has a valid A2A endpoint
    console.log('[Agent.sendMessage] Agent a2aEndpoint:', this.data.a2aEndpoint);
    if (!this.data.a2aEndpoint) {
      console.error('[Agent.sendMessage] Agent does not have an A2A endpoint configured');
      throw new Error(
        'Agent does not have an A2A endpoint configured. ' +
        'The agent must have a valid A2A endpoint URL to receive messages.'
      );
    }
    
    console.log('[Agent.sendMessage] Request:', JSON.stringify(request, null, 2));

    // Build A2A request format
    const endpointInfo = await this.getEndpoint();
    if (!endpointInfo) {
      throw new Error('Agent endpoint not available 1');
    }

    // Extract fromAgentId from metadata/payload if provided, otherwise fallback to payload.agentId, finally 'client'
    const payloadFromAgentId = (request.payload as any)?.fromAgentId;
    const fallbackAgentId = (request.payload as any)?.agentId;
    const fromAgentId =
      (request.metadata as any)?.fromAgentId ||
      payloadFromAgentId ||
      fallbackAgentId ||
      'client';
    
    const a2aRequest = {
      fromAgentId: fromAgentId,
      toAgentId: endpointInfo.providerId,
      message: request.message,
      payload: request.payload,
      metadata: request.metadata,
      skillId: request.skillId,
    };

    console.log('[Agent.sendMessage] Sending A2A request:', JSON.stringify(a2aRequest, null, 2));
    const response = await this.a2aProvider.sendMessage(a2aRequest);
    console.log('[Agent.sendMessage] Received A2A response:', JSON.stringify(response, null, 2));
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
        throw new Error('Agent endpoint not available 2');
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
    console.log('[Agent.getFeedbackAuth] Starting getFeedbackAuth');
    console.log('[Agent.getFeedbackAuth] Agent data:', {
      agentId: this.data.agentId,
      chainId: this.data.chainId,
      agentName: this.data.agentName,
      a2aEndpoint: this.data.a2aEndpoint,
      active: this.data.active,
    });
    console.log('[Agent.getFeedbackAuth] Params:', JSON.stringify(params, null, 2));
    
    // Check if agent is active before attempting to contact A2A endpoint
    // Only skip if explicitly false; undefined/null means active by default
    if (this.data.active === false) {
      console.warn('[Agent.getFeedbackAuth] Agent is not active, skipping A2A request');
      throw new Error('Agent is not active. Cannot request feedback authorization for inactive agents.');
    }
    
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

    console.log('[Agent.getFeedbackAuth] Resolved agentId:', resolvedAgentId);
    console.log('[Agent.getFeedbackAuth] Resolved chainId:', resolvedChainId);

    if (!resolvedAgentId) {
      throw new Error('Agent ID is required to request feedback auth.');
    }

    // Commented out verification - allow A2A endpoint to respond without verification
    // console.log('[Agent.getFeedbackAuth] Verifying agent...');
    // const verified = await this.verify();
    // console.log('[Agent.getFeedbackAuth] Agent verified:', verified);
    // if (!verified) {
    //   throw new Error('Agent verification failed before requesting feedback auth.');
    // }

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

    // Forward optional client-built delegation SAR payload (ERC-8092) to the provider.
    if (params.delegationSar && typeof params.delegationSar === 'object') {
      payload.delegationSar = params.delegationSar as Record<string, unknown>;
    }

    const skillId = params.skillId ?? 'governance_and_trust/trust/trust_feedback_authorization';
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

    // Some providers respond with payload fields at the top-level (e.g. { success, feedbackAuthId, ... })
    // rather than nesting under `response`. Support both shapes.
    const providerPayload = ((response as any).response || response || {}) as Record<string, unknown>;
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
   * Set SessionPackage for this agent instance.
   * This allows dynamically setting the SessionPackage based on request context
   * (e.g., subdomain-based routing in provider apps).
   * 
   * This is server-side only and specific to providerApp configuration.
   * 
   * @param sessionPackage - The SessionPackage to use for this agent instance
   */
  setSessionPackage(sessionPackage: SessionPackage): void {
    this.sessionPackage = sessionPackage;
  }

  /**
   * Build a providerApp-like structure from a SessionPackage.
   * This is used when a SessionPackage is set on the agent instance.
   */
  private async buildProviderAppFromSessionPackage(
    sessionPackage: SessionPackage
  ): Promise<{
    sessionPackage: SessionPackage;
    agentAccount: any;
    publicClient: any;
    walletClient: any;
    agentId: bigint;
  }> {
    const { buildDelegationSetup, buildAgentAccountFromSession } = await import('./sessionPackage');
    const delegationSetup = buildDelegationSetup(sessionPackage);
    const agentAccount = await buildAgentAccountFromSession(sessionPackage);

    // Create wallet client for agent
    const { createWalletClient, http: httpTransport } = await import('viem');
    const walletClient = createWalletClient({
      account: agentAccount,
      chain: delegationSetup.chain,
      transport: httpTransport(delegationSetup.rpcUrl),
    });

    return {
      sessionPackage,
      agentAccount,
      publicClient: delegationSetup.publicClient as any,
      walletClient: walletClient as any,
      agentId: BigInt(sessionPackage.agentId),
    };
  }

  /**
   * Issue a feedback authorization on behalf of this agent using the provider app's signer.
   * If a SessionPackage is set on this agent instance, it will be used instead of the
   * singleton providerApp. This allows dynamic SessionPackage selection based on request context.
   */
  async requestAuth(params: FeedbackAuthIssueParams): Promise<{
    feedbackAuth: `0x${string}`;
    agentId: string;
    clientAddress: `0x${string}`;
    skill: string;
    delegationAssociation?: unknown;
  }> {
    // Use SessionPackage from agent instance if set, otherwise use singleton providerApp
    let providerApp: {
      agentAccount: any;
      publicClient: any;
      walletClient: any;
      agentId: bigint;
    };

    if (this.sessionPackage) {
      // Build providerApp from the SessionPackage set on this agent instance
      providerApp = await this.buildProviderAppFromSessionPackage(this.sessionPackage);
    } else {
      // Fall back to singleton providerApp
      const singletonApp = await getProviderApp();
      if (!singletonApp) {
        throw new Error('provider app not initialized. Either set a SessionPackage on the agent instance or configure AGENTIC_TRUST_SESSION_PACKAGE_PATH environment variable.');
      }
      providerApp = singletonApp;
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

    const issued = await this.client.createFeedbackAuthWithDelegation({
      publicClient: providerApp.publicClient,
      agentId,
      clientAddress,
      signer: providerApp.agentAccount,
      walletClient: providerApp.walletClient as any,
      expirySeconds: params.expirySeconds,
      existingAssociationId: params.existingAssociationId,
    });

    return {
      feedbackAuth: issued.feedbackAuth,
      delegationAssociation: (issued as any).delegationAssociation,
      agentId: agentId.toString(),
      clientAddress,
      skill: params.skillId || 'governance_and_trust/trust/trust_feedback_authorization',
    };
  }

  private async buildFeedbackSubmission(
    params: GiveFeedbackInput,
  ): Promise<{
    chainId: number;
    giveParams: GiveFeedbackParams;
  }> {
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

    const score = Number(params.score ?? 0);
    if (!Number.isFinite(score)) {
      throw new Error('score must be a valid number between 0 and 100');
    }
    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));

    // feedbackAuth is OPTIONAL in the "no-auth" flow.
    // Keep it around for backward compatibility with older off-chain schemas,
    // but do not require it for on-chain submission.
    const feedbackAuth = (params.feedbackAuth && String(params.feedbackAuth).trim()) || '0x';

    // Prefer an explicit clientAddress from params (e.g. browser wallet / Web3Auth).
    // Only fall back to ClientApp (server-side private key) when clientAddress is not provided.
    let clientAddressHex: `0x${string}` | undefined =
      params.clientAddress as `0x${string}` | undefined;

    if (!clientAddressHex) {
      const { getClientApp } = await import('../userApps/clientApp');
      const clientApp = await getClientApp();
      clientAddressHex = clientApp?.address as `0x${string}` | undefined;
    }

    if (!clientAddressHex) {
      throw new Error('clientAddress is required to submit feedback');
    }

    let agentRegistry = '';
    try {
      const identityRegistry = requireChainEnvVar(
        'AGENTIC_TRUST_IDENTITY_REGISTRY',
        chainId,
      );
      agentRegistry = `eip155:${chainId}:${identityRegistry}`;
    } catch (error) {
      console.warn(
        '[Agent.buildFeedbackSubmission] Failed to resolve AGENTIC_TRUST_IDENTITY_REGISTRY; feedbackFile.agentRegistry will be empty:',
        error,
      );
    }

    const clientAddressCaip = `eip155:${chainId}:${clientAddressHex}`;

    const feedbackFile: FeedbackFile = {
      agentRegistry,
      agentId: Number.parseInt(agentId, 10) || 0,
      clientAddress: clientAddressCaip || clientAddressHex,
      createdAt: new Date().toISOString(),
      feedbackAuth,
      score: normalizedScore,
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
        '[Agent.buildFeedbackSubmission] Failed to upload FeedbackFile to IPFS; continuing without feedbackUri/feedbackHash:',
        error,
      );
    }

    const giveParams: GiveFeedbackParams = {
      agent: agentId,
      score: normalizedScore,
      feedback: params.feedback ?? 'Feedback submitted via Agentic Trust admin app.',
      tag1: params.tag1,
      tag2: params.tag2,
      // Updated reputation ABI includes an `endpoint` string.
      // IMPORTANT: Keep this short and stable. Some deployed registries are strict (and will revert)
      // on unexpected long URLs or values here. Prefer the agent's A2A endpoint; otherwise fall back
      // to a best-effort origin (no path/query) from any URL-like value we have.
      endpoint: (() => {
        const a2a = typeof (this.data as any)?.a2aEndpoint === 'string' ? String((this.data as any).a2aEndpoint) : '';
        if (a2a.trim()) return a2a.trim();
        const raw = typeof (this as any)?.endpoint?.url === 'string' ? String((this as any).endpoint.url) : '';
        if (!raw.trim()) return '';
        try {
          const u = new URL(raw.trim());
          return `${u.protocol}//${u.host}`;
        } catch {
          return '';
        }
      })(),
      feedbackUri: feedbackUriFromIpfs,
      feedbackHash: feedbackHashFromIpfs,
      agentId,
      feedbackAuth,
    };

    return {
      chainId,
      giveParams,
    };
  }

  /**
   * Submit client feedback to the reputation contract.
   */
  async giveFeedback(params: GiveFeedbackInput): Promise<{ txHash: string }> {
    const { chainId, giveParams } = await this.buildFeedbackSubmission(params);
    const reputationClient = await getReputationRegistryClient(chainId);
    return reputationClient.giveClientFeedback(giveParams);
  }

  /**
   * Prepare a giveFeedback transaction for client-side signing.
   */
  async prepareGiveFeedback(
    params: GiveFeedbackInput,
  ): Promise<{ chainId: number; transaction: PreparedTransaction }> {
    const { chainId, giveParams } = await this.buildFeedbackSubmission(params);
    const reputationClient = await getReputationRegistryClient(chainId);
    const txRequest = await reputationClient.prepareGiveFeedbackTx(giveParams);

    const toHex = (value?: bigint): `0x${string}` | undefined =>
      typeof value === 'bigint' ? (`0x${value.toString(16)}` as `0x${string}`) : undefined;

    const transaction: PreparedTransaction = {
      to: txRequest.to as `0x${string}`,
      data: txRequest.data as `0x${string}`,
      value: toHex(txRequest.value) ?? ('0x0' as `0x${string}`),
      gas: toHex(txRequest.gas),
      gasPrice: toHex(txRequest.gasPrice),
      maxFeePerGas: toHex(txRequest.maxFeePerGas),
      maxPriorityFeePerGas: toHex(txRequest.maxPriorityFeePerGas),
      nonce: txRequest.nonce,
      chainId,
    };

    return {
      chainId,
      transaction,
    };
  }

  /**
   * Get the approved NFT operator address for this agent
   * Returns the address approved to operate on the agent's NFT token, or null if no operator is set
   * 
   * @param chainId - Optional chain ID (defaults to the agent's chainId from data, or DEFAULT_CHAIN_ID)
   * @returns The approved operator address, or null if no operator is set
   */
  async getNFTOperator(chainId?: number): Promise<`0x${string}` | null> {
    const agentId = this.agentId;
    if (!agentId) {
      throw new Error('Agent ID is required to get NFT operator');
    }

    const resolvedChainId = chainId ?? 
      (Number.isFinite((this.data as any)?.chainId) ? Number((this.data as any).chainId) : DEFAULT_CHAIN_ID);

    return this.client.agents.getNFTOperator(agentId, resolvedChainId);
  }

}

/**
 * Load a detailed Agent view using a provided AgenticTrustClient.
 * This is the core implementation used by admin and other services.
 * 
 * IMPORTANT: This function fetches on-chain NFT metadata (via getAllMetadata),
 * which makes multiple RPC calls. It should ONLY be used for detailed agent views,
 * NOT for list queries. List queries should use searchAgents/listAgents which
 * only fetch data from the GraphQL discovery indexer.
 */
function firstNonEmptyString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
      continue;
    }
    const asString = String(value).trim();
    if (asString.length > 0) {
      return asString;
    }
  }
  return undefined;
}

export async function loadAgentDetail(
  client: AgenticTrustClient,
  uaid: string,
  options?: {
    /**
     * If true, allow fetching the registration JSON from IPFS/tokenUri.
     * Defaults to false to avoid UI hangs and unintended gateway dependency.
     */
    includeRegistration?: boolean;
  },
): Promise<AgentDetail> {
  const trimmedUaid = String(uaid ?? '').trim();
  if (!trimmedUaid || !trimmedUaid.startsWith('uaid:')) {
    throw new Error(`loadAgentDetail requires a valid UAID (got: ${trimmedUaid})`);
  }

  // Parse UAID to extract chainId/agentId/did8004 for on-chain operations.
  const { parseHcs14UaidDidTarget } = await import('../lib/uaid');
  const parsed = parseHcs14UaidDidTarget(trimmedUaid);
  const targetDid = parsed.targetDid;

  let resolvedChainId: number;
  let agentId: string;
  let agentIdBigInt: bigint;
  let did8004: string | undefined;

  if (targetDid.startsWith('did:8004:')) {
    did8004 = targetDid;
    const parsedDid = parseDid8004(did8004);
    resolvedChainId = parsedDid.chainId;
    agentId = parsedDid.agentId;
    try {
      agentIdBigInt = BigInt(agentId);
    } catch {
      throw new Error(`Invalid agentId in did:8004 from UAID: ${did8004}`);
    }
  } else {
    // Non-did:8004 UAID (e.g. did:ethr, did:web): no on-chain operations.
    // Use discovery-only; chainId/agentId might not be available.
    // For now throw - the user wants UAID-only, so we need a valid did:8004 target for on-chain.
    throw new Error(`loadAgentDetail requires UAID with did:8004 target for on-chain operations (got: ${targetDid})`);
  }

  const identityClient = await getIdentityRegistryClient(resolvedChainId);
  let discovery: Record<string, unknown> | null = null;
  try {
    const agentsApi = client.agents as any;
    if (typeof agentsApi.getAgentFromDiscoveryByUaid === 'function') {
      discovery = (await agentsApi.getAgentFromDiscoveryByUaid(uaid)) as unknown as Record<string, unknown> | null;
    }
  } catch (error) {
    // Check if this is an access code error and provide a clearer message
    const { rethrowDiscoveryError } = await import('./discoveryErrors');
    try {
      rethrowDiscoveryError(error, 'loadAgentDetail');
    } catch (friendlyError) {
      // If rethrowDiscoveryError determined it's an access code error, log the friendly message
      console.error(
        'Failed to get GraphQL agent data:',
        friendlyError instanceof Error ? friendlyError.message : friendlyError,
      );
      throw friendlyError; // Re-throw the friendly error
    }
    // If it's not an access code error, just log and continue
    console.warn('Failed to get GraphQL agent data:', error);
    discovery = null;
  }

  // On-chain source of truth is tokenURI (which is the agentUri).
  // If RPC fails, fall back to KB agentUri.
  const tokenUri = await (async (): Promise<string> => {
    try {
      return String(await identityClient.getTokenURI(agentIdBigInt));
    } catch {
      return (
        firstNonEmptyString(
          (discovery as any)?.agentUri,
          (discovery as any)?.tokenUri,
          (discovery as any)?.identityMetadata?.agentUri,
        ) ?? ''
      );
    }
  })();

  // Metadata: use discovery row (UAID-only) when present; else on-chain.
  let metadata: Record<string, string> = {};
  if (discovery && typeof (discovery as any).metadata === 'object' && Object.keys((discovery as any).metadata).length > 0) {
    metadata = (discovery as any).metadata as Record<string, string>;
  }
  if (Object.keys(metadata).length === 0) {
    try {
      const onChainMetadata = await (identityClient as any).getAllMetadata?.(agentIdBigInt);
      if (onChainMetadata && typeof onChainMetadata === 'object' && Object.keys(onChainMetadata).length > 0) {
        metadata = onChainMetadata as Record<string, string>;
      }
    } catch {
      // ignore
    }
  }

  // Ensure reserved agentWallet is displayed as a readable address.
  if (!metadata.agentWallet) {
    try {
      const agentWallet = await (identityClient as any).getAgentWallet?.(agentIdBigInt);
      if (agentWallet && typeof agentWallet === 'string' && agentWallet.startsWith('0x')) {
        metadata.agentWallet = agentWallet;
      }
    } catch {
      // best-effort only
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
  // Prefer cached registration JSON from discovery row (rawJson) instead of hitting IPFS.
  // This keeps "agent details" fast and avoids gateway dependency.
  const includeRegistration = options?.includeRegistration === true;
  if (tokenUri) {
    let registrationFromDiscovery: Record<string, unknown> | null = null;
    try {
      const rawJsonMaybe =
        discovery && typeof (discovery as any).rawJson === 'string'
          ? String((discovery as any).rawJson)
          : null;
      if (rawJsonMaybe && rawJsonMaybe.trim()) {
        const parsed = JSON.parse(rawJsonMaybe);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          registrationFromDiscovery = parsed as Record<string, unknown>;
        }
      }
    } catch {
      // ignore
    }

    if (registrationFromDiscovery) {
      identityRegistration = { tokenUri, registration: registrationFromDiscovery };
    } else if (includeRegistration) {
      // Explicit opt-in: fetch from IPFS/tokenUri.
      try {
        const ipfsStorage = getIPFSStorage();
        const registration = (await ipfsStorage.getJson(tokenUri)) as Record<string, unknown> | null;
        identityRegistration = {
          tokenUri,
          registration,
        };
      } catch (error) {
        console.warn('Failed to get IPFS registration:', error);
        identityRegistration = {
          tokenUri,
          registration: null,
        };
      }
    }
  }

  const flattened: Record<string, unknown> = {};

  // Priority 1: Data from tokenUri/IPFS registration (highest priority - on-chain source of truth)
  if (
    identityRegistration?.registration &&
    typeof identityRegistration.registration === 'object'
  ) {
    const reg = identityRegistration.registration as Record<string, unknown>;
    
    // Extract standard fields
    if (typeof reg.name === 'string') flattened.name = reg.name;
    if (typeof reg.description === 'string') flattened.description = reg.description;
    if (typeof reg.image === 'string') flattened.image = reg.image;
    if (typeof reg.agentAccount === 'string') flattened.agentAccount = reg.agentAccount;
    if ((reg as any).services) flattened.services = (reg as any).services;
    if (reg.endpoints) flattened.endpoints = reg.endpoints;
    if (reg.supportedTrust) flattened.supportedTrust = reg.supportedTrust;
    if (typeof reg.createdAt !== 'undefined') flattened.createdAt = reg.createdAt;
    if (typeof reg.updatedAt !== 'undefined') flattened.updatedAt = reg.updatedAt;
    
    // Extract all other metadata fields from registration JSON
    // This includes: tags, glbUrl, agentWallet, capabilities, role, version, rating, pricing, etc.
    Object.keys(reg).forEach((key) => {
      // Skip fields we've already handled explicitly
      if (
        key !== 'name' &&
        key !== 'description' &&
        key !== 'image' &&
        key !== 'agentAccount' &&
        key !== 'services' &&
        key !== 'endpoints' &&
        key !== 'supportedTrust' &&
        key !== 'createdAt' &&
        key !== 'updatedAt' &&
        key !== 'type' &&
        key !== 'agentUrl' &&
        key !== 'metadata' &&
        key !== 'attributes' &&
        key !== 'external_url' &&
        flattened[key] === undefined
      ) {
        flattened[key] = reg[key];
      }
    });
    
    // Extract a2aEndpoint from registration
    // Priority: 1) direct a2aEndpoint field, 2) from endpoints array (name: 'A2A'), 3) from agentUrl
    /*
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
    */

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
    //if (a2aEndpointFromDiscovery && !flattened.a2aEndpoint) {
    //  flattened.a2aEndpoint = a2aEndpointFromDiscovery;
    //}

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
    // Exclude agentUri and rawJson - these should come from on-chain sources only
    Object.keys(discoveryRecord).forEach((key) => {
      if (key !== 'agentId' && key !== 'agentUri' && key !== 'rawJson' && flattened[key] === undefined) {
        flattened[key] = discoveryRecord[key];
      }
    });
  }

  // Prioritize: flattened (from tokenUri/IPFS/metadata) > discoveryRecord, but treat
  // empty/whitespace strings as "missing" so we can safely fall back to discovery.
  const agentNameValue =
    firstNonEmptyString(
      flattened.agentName as string | undefined,
      flattened.name as string | undefined,
      discoveryRecord.agentName as string | undefined,
    ) ?? '';

  // Prevent later spread of `flattened` from overwriting the resolved agentName
  // with an empty string or less-preferred source.
  delete (flattened as Record<string, unknown>).agentName;
  delete (flattened as Record<string, unknown>).name;

  const agentAccountValue =
    (flattened.agentAccount as string | undefined) ??
    (discoveryRecord.agentAccount as string | undefined) ??
    '';

  const agentIdentityOwnerAccountValue =
    (discoveryRecord.agentIdentityOwnerAccount as string | undefined) ?? '';

  const detail: AgentDetail = {
    // AgentInfo fields
    agentId,
    agentName: agentNameValue,
    chainId: resolvedChainId,
    agentAccount: agentAccountValue,
    agentIdentityOwnerAccount: agentIdentityOwnerAccountValue,
    eoaAgentIdentityOwnerAccount:
      (discoveryRecord.eoaAgentIdentityOwnerAccount as string | null | undefined) ?? null,
    eoaAgentAccount: (discoveryRecord.eoaAgentAccount as string | null | undefined) ?? null,
    didIdentity: (discoveryRecord.didIdentity as string | null | undefined) ?? null,
    didAccount: (discoveryRecord.didAccount as string | null | undefined) ?? null,
    didName: (discoveryRecord.didName as string | null | undefined) ?? null,
    // agentUri and rawJson will be set after the spread to ensure they're not overwritten
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
    // Prioritize: flattened (from tokenUri/IPFS) > discoveryRecord
    supportedTrust:
      (flattened.supportedTrust as string | undefined) ??
      (discoveryRecord.supportedTrust as string | undefined) ??
      null,
    agentCardJson: (discoveryRecord.agentCardJson as string | null | undefined) ?? null,
    agentCardReadAt:
      typeof discoveryRecord.agentCardReadAt === 'number'
        ? discoveryRecord.agentCardReadAt
        : (discoveryRecord.agentCardReadAt as number | null | undefined) ?? null,
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

  // Set agentUri and rawJson AFTER spread to ensure on-chain values take precedence.
  // Use on-chain tokenUri as primary source (from contract); in the new discovery schema, this is exposed as `agentUri`.
  detail.agentUri =
    identityMetadata.tokenUri !== null && identityMetadata.tokenUri !== undefined
      ? identityMetadata.tokenUri
      : ((discoveryRecord.agentUri as string | null | undefined) ?? null);
  
  // Use registration JSON from tokenUri/IPFS as primary source, fallback to discovery
  detail.rawJson = identityRegistration?.registration
    ? JSON.stringify(identityRegistration.registration, null, 2)
    : ((discoveryRecord.rawJson as string | null | undefined) ?? null);


  return detail;
}

/**
 * @deprecated Use loadAgentDetail instead.
 */
export const buildAgentDetail = loadAgentDetail;

