/**
 * Agent class
 * 
 * Represents a discovered agent with protocol support (A2A, MCP, etc.)
 * Abstracts protocol details so clients can interact with agents without
 * knowing the underlying protocol implementation.
 */

import type { AgenticTrustClient } from './index';
import { A2AProtocolProvider } from './a2aProtocolProvider';
import type { AgentCard, AgentSkill, AgentCapabilities } from './agentCard';

// Re-export types
export type { AgentCard, AgentSkill, AgentCapabilities } from './agentCard';

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
export interface AgentData {
  agentId?: number;
  agentName?: string;
  createdAtTime?: string;
  updatedAtTime?: string;
  a2aEndpoint?: string;
  [key: string]: unknown;
}

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
    return this.data.agentId;
  }

  /**
   * Get agent name
   */
  get agentName(): string | undefined {
    return this.data.agentName;
  }

  /**
   * Get A2A endpoint URL
   */
  get a2aEndpoint(): string | undefined {
    return this.data.a2aEndpoint;
  }

  /**
   * Initialize the agent with protocol support
   * Uses the client's Veramo agent to set up authentication
   * Called automatically during construction if agent has a2aEndpoint
   * 
   * NOTE: This only sets up the protocol provider - it does NOT fetch the agent card.
   * The agent card is fetched lazily when fetchCard() is called.
   */
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

  /**
   * Check if agent has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Fetch the agent card (discover capabilities)
   * This is lazily loaded - the card is only fetched when this method is called,
   * not during agent construction or listing.
   */
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

  /**
   * Get the agent card (cached)
   */
  getCard(): AgentCard | null {
    return this.agentCard;
  }

  /**
   * Get available skills
   * This will lazily fetch the agent card if not already cached
   */
  async getSkills(): Promise<AgentSkill[]> {
    const card = await this.fetchCard(); // Lazy load
    return card?.skills || [];
  }

  /**
   * Get agent capabilities
   * This will lazily fetch the agent card if not already cached
   */
  async getCapabilities(): Promise<AgentCapabilities | null> {
    const card = await this.fetchCard(); // Lazy load
    return card?.capabilities || null;
  }

  /**
   * Check if agent supports the protocol
   */
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

  /**
   * Get the endpoint information
   */
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
   * Get the agent's base URL
   */
  getBaseUrl(): string | undefined {
    return this.data.a2aEndpoint;
  }
}

