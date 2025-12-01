/**
 * A2A Protocol Provider API for AgenticTrust Client
 * Handles Agent-to-Agent (A2A) interactions
 */

import type { GraphQLClient } from 'graphql-request';
import { fetchA2AAgentCard } from './a2aAgentCard';
import type { A2AAgentCard } from '../models/a2aAgentCardInfo';
import type { VeramoAgent } from './veramo';

export interface AgentProvider {
  id?: string;
  agentName?: string;
  providerId?: string;
  endpoint?: string;
  [key: string]: unknown;
}

export interface A2ARequest {
  fromAgentId: string;
  toAgentId: string;
  message?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  skillId?: string; // Optional skill ID to target a specific skill
}

export interface AuthenticatedA2ARequest extends A2ARequest {
  /** Authentication challenge and signature */
  auth?: {
    did: string;
    kid: string;
    algorithm: string;
    challenge: string;
    signature: string;
  };
}

export interface A2AResponse {
  success: boolean;
  messageId?: string;
  response?: Record<string, unknown>;
  error?: string;
}

export interface ProviderEndpoint {
  providerId: string;
  endpoint: string;
  method?: string;
}

/**
 * A2A Protocol Provider API for GraphQL operations
 * Used by AgenticTrustClient for backend queries
 */
export class A2AProtocolProviderAPI {
  constructor(private graphQLClient: GraphQLClient) {}

  /**
   * Get agent provider endpoint for A2A communication via GraphQL
   */
  async getAgentProvider(agentId: string): Promise<AgentProvider | null> {
    const query = `
      query GetAgentProvider($agentId: String!) {
        agentProvider(agentId: $agentId) {
          providerId
          endpoint
          agentName
        }
      }
    `;

    try {
      const data = await this.graphQLClient.request<{ agentProvider: AgentProvider | null }>(
        query,
        { agentId }
      );
      return data.agentProvider;
    } catch (error) {
      // If the query fails, return null
      console.warn('Failed to get agent provider from GraphQL:', error);
      return null;
    }
  }

  /**
   * Send an Agent-to-Agent (A2A) message via GraphQL
   */
  async sendA2AMessage(request: A2ARequest): Promise<A2AResponse> {
    const mutation = `
      mutation SendA2AMessage(
        $fromAgentId: String!
        $toAgentId: String!
        $message: String
        $payload: String
        $metadata: String
      ) {
        sendA2AMessage(
          fromAgentId: $fromAgentId
          toAgentId: $toAgentId
          message: $message
          payload: $payload
          metadata: $metadata
        ) {
          success
          messageId
          response
          error
        }
      }
    `;

    try {
      const data = await this.graphQLClient.request<{ sendA2AMessage: A2AResponse }>(mutation, {
        fromAgentId: request.fromAgentId,
        toAgentId: request.toAgentId,
        message: request.message,
        payload: request.payload ? JSON.stringify(request.payload) : undefined,
        metadata: request.metadata ? JSON.stringify(request.metadata) : undefined,
      });

      return data.sendA2AMessage;
    } catch (error) {
      // If mutation fails, return error response
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send A2A message',
      };
    }
  }

  /**
   * List available agent providers via GraphQL
   */
  async listProviders(): Promise<AgentProvider[]> {
    const query = `
      query ListProviders {
        providers {
          id
          providerId
          agentName
          endpoint
        }
      }
    `;

    const data = await this.graphQLClient.request<{ providers: AgentProvider[] }>(query);
    return data.providers || [];
  }
}

/**
 * A2A Protocol Provider for a specific agent
 * Handles direct A2A communication with an agent provider
 */
export class A2AProtocolProvider {
  private providerUrl: string;
  private agentCard: A2AAgentCard | null = null;
  private a2aEndpoint: string | null = null;
  private veramoAgent: VeramoAgent | null = null;
  private authenticated: boolean = false;
  private clientDid: string | null = null;
  private clientKid: string | null = null;

  /**
   * Check if an endpoint URL is a placeholder/example URL
   * Note: localhost URLs are allowed for development, only actual placeholder/example domains are flagged
   */
  private static isPlaceholderUrl(url: string): boolean {
    const placeholderPatterns = [
      // Match example.com and its subdomains (actual placeholder domain)
      /^https?:\/\/(www\.)?example\.com/i,
      // Match other example domains (example.org, example.net, etc.)
      /^https?:\/\/example\.(com|org|net|edu|gov)/i,
      // Match URLs containing "placeholder" (but not localhost)
      /placeholder/i,
      // Match URLs containing "example" but NOT localhost (to avoid false positives)
      // This will catch things like "example.com" but not "localhost:3001"
      /example/i,
    ];
    
    // Don't flag localhost URLs - they're valid for development
    if (/^https?:\/\/localhost/i.test(url) || /^https?:\/\/127\.0\.0\.1/i.test(url)) {
      return false;
    }
    
    return placeholderPatterns.some(pattern => pattern.test(url));
  }

  /**
   * Construct an A2A Protocol Provider for a specific agent
   * @param a2aEndpoint - The base URL from the agent's a2aEndpoint field (must be absolute)
   * @param veramoAgent - Veramo agent for authentication
   */
  constructor(a2aEndpoint: string, veramoAgent: VeramoAgent) {
    // Verify a2aEndpoint is an absolute URL
    if (!a2aEndpoint.startsWith('http://') && !a2aEndpoint.startsWith('https://')) {
      //console.log(`Warning: a2aEndpoint should be an absolute URL (starting with http:// or https://), got: ${a2aEndpoint}`);
    }
    
    // Check if endpoint is a placeholder/example URL
    if (A2AProtocolProvider.isPlaceholderUrl(a2aEndpoint)) {
      //console.warn(`Warning: A2A endpoint appears to be a placeholder URL: ${a2aEndpoint}. This endpoint will not work for actual A2A communication.`);
    }
    
    this.providerUrl = a2aEndpoint.replace(/\/$/, ''); // Remove trailing slash
    this.veramoAgent = veramoAgent;
  }

  /**
   * Fetch and cache the agent card from /.well-known/agent-card.json
   */
  async fetchAgentCard(): Promise<A2AAgentCard | null> {
    try {
      console.log(`Fetching agent card from: ${this.providerUrl}`);
      const card = await fetchA2AAgentCard(this.providerUrl);
      console.log(`Agent card: ${JSON.stringify(card)}`);
      if (card) {
        this.agentCard = card;
        // Extract A2A endpoint from agent card
        const cardUrl = card.provider?.url;

        if (!cardUrl) { 
          console.log(`Warning: Agent card URL is not available`);
          return null;
        }
        // Verify card.provider?.url is absolute
        if (!cardUrl || (!cardUrl.startsWith('http://') && !cardUrl.startsWith('https://'))) {
          console.log(`Warning: Agent card URL should be an absolute URL (starting with http:// or https://), got: ${cardUrl}`);
        }
        
        this.a2aEndpoint = cardUrl.endsWith('/api/a2a') 
          ? cardUrl 
          : `${cardUrl.replace(/\/$/, '')}/api/a2a`;
          
        // Verify the constructed a2aEndpoint is absolute
        if (!this.a2aEndpoint.startsWith('http://') && !this.a2aEndpoint.startsWith('https://')) {
          console.log(`Warning: A2A endpoint should be an absolute URL (starting with http:// or https://), got: ${this.a2aEndpoint}`);
        }
      }
      return card;
    } catch (error) {
      console.error('Failed to fetch agent card:', error);
      return null;
    }
  }

  /**
   * Get the cached agent card (call fetchAgentCard first)
   */
  getAgentCard(): A2AAgentCard | null {
    return this.agentCard;
  }

  /**
   * Get the A2A endpoint URL
   * This will fetch the agent card if not already cached
   */
  async getA2AEndpoint(): Promise<ProviderEndpoint | null> {
    // Lazy load agent card if not already fetched
    if (!this.agentCard) {
      await this.fetchAgentCard();
    }

    if (!this.a2aEndpoint || !this.agentCard) {
      return null;
    }

    // Verify endpoint is absolute before returning
    if (
      !this.a2aEndpoint ||
      (!this.a2aEndpoint.startsWith('http://') && !this.a2aEndpoint.startsWith('https://'))
    ) {
      console.log(`Warning: A2A endpoint should be an absolute URL (starting with http:// or https://), got: ${this.a2aEndpoint}`);
    }

    return {
      providerId: this.agentCard.name || 'unknown',
      endpoint: this.a2aEndpoint,
      method: 'POST',
    };
  }

  /**
   * Check if the agent supports A2A protocol
   */
  async supportsA2A(): Promise<boolean> {
    const card = await this.fetchAgentCard();
    return card !== null && 
           card.skills !== undefined && 
           card.skills.length > 0 && 
           card.provider?.url !== undefined;
  }

  /**
   * Get available skills from the agent card
   */
  async getSkills() {
    const card = await this.fetchAgentCard();
    return card?.skills || [];
  }

  /**
   * Get agent capabilities
   */
  async getCapabilities(): Promise<Record<string, unknown> | null> {
    const card = await this.fetchAgentCard();
    return card?.capabilities || null;
  }

  /**
   * Create and sign an authentication challenge
   */
  private async createSignedChallenge(audience: string): Promise<{
    did: string;
    kid: string;
    algorithm: string;
    challenge: string;
    signature: string;
    ethereumAddress?: string; // For direct verification without DID resolution
  } | null> {
    const agent = this.veramoAgent;
    if (!agent) {
      console.warn('No Veramo agent available for authentication');
      return null;
    }

    try {
      // Get the client's DID
      const identifiers = await agent.didManagerFind();
      if (!identifiers || identifiers.length === 0) {
        // Create a default DID if none exists
        // Use ethr provider for client DIDs (simpler than agent DIDs)
        const identifier = await agent.didManagerCreate({
          alias: 'default',
          provider: 'did:ethr',
        });
        this.clientDid = identifier.did;
      } else {
        const firstIdentifier = identifiers[0];
        this.clientDid = firstIdentifier?.did || null;
      }

      if (!this.clientDid) {
        throw new Error('Could not get or create client DID');
      }

      // Get the identifier to access its keys
      const identifier = await agent.didManagerGet({ did: this.clientDid });
      if (!identifier || !identifier.keys || identifier.keys.length === 0) {
        throw new Error('No keys available for signing in identifier');
      }

      // Use the first available key from the identifier
      const key = identifier.keys[0];
      if (!key) {
        throw new Error('No key available');
      }
      this.clientKid = key.kid;

      // Generate nonce
      const nonce = crypto.randomUUID();

      // Create canonical challenge
      const iat = Date.now();
      const challenge = [
        'orgtrust-challenge',
        `iss=${this.clientDid}`,
        `aud=${audience}`,
        `nonce=${nonce}`,
        `iat=${iat}`,
      ].join('\n');

      // For ethr DIDs, use eth_signMessage algorithm
      // Extract Ethereum address from the key for direct verification (no DID resolution needed)
      const isEthrDid = this.clientDid.startsWith('did:ethr:');
      let algorithm = 'ES256K'; // Default
      let ethereumAddress: string | undefined = undefined;
      
      if (isEthrDid) {
        // Use eth_signMessage for ethr DIDs - this is what the provider expects
        algorithm = 'eth_signMessage';
        
        // Extract Ethereum address from the key's metadata or derive from public key
        // For ethr DIDs, the address is in the key's meta.ethereumAddress or can be derived
        if (key.meta?.ethereumAddress) {
          ethereumAddress = key.meta.ethereumAddress;
        } else if (key.publicKeyHex) {
          // Derive address from public key if not in metadata
          // This is a simplified approach - in production, use proper key derivation
          try {
            const { computeAddress } = await import('ethers');
            const publicKeyBytes = Buffer.from(key.publicKeyHex.replace(/^0x/, ''), 'hex');
            // For uncompressed public key (65 bytes), skip first byte
            const pubKey = publicKeyBytes.length === 65 ? publicKeyBytes.slice(1) : publicKeyBytes;
            ethereumAddress = computeAddress(`0x${pubKey.toString('hex')}`);
          } catch (error) {
            console.warn('Could not derive Ethereum address from public key:', error);
          }
        }
      } else if (key.type === 'Ed25519') {
        algorithm = 'EdDSA';
      } else if (key.type === 'Secp256k1') {
        algorithm = 'ES256K';
      }

      const signature = await agent.keyManagerSign({
        keyRef: key.kid,
        algorithm: algorithm as any,
        data: challenge,
        encoding: 'utf-8',
      });

      // For ethr DIDs, use the DID itself as the kid (or a standard fragment)
      // Include Ethereum address for direct verification without DID resolution
      const kid = isEthrDid ? `${this.clientDid}#controllerKey` : key.kid;

      return {
        did: this.clientDid,
        kid,
        algorithm,
        challenge,
        signature,
        ...(ethereumAddress && { ethereumAddress }), // Include address for direct verification
      };
    } catch (error) {
      console.error('Failed to create signed challenge:', error);
      return null;
    }
  }

  /**
   * Send an A2A message to the agent
   */
  async sendMessage(request: A2ARequest): Promise<A2AResponse> {
    // Ensure we have the endpoint
    const endpointInfo = await this.getA2AEndpoint();
    if (!endpointInfo) {
      throw new Error('A2A endpoint not available. Fetch agent card first.');
    }

    // Validate endpoint is not a placeholder
    if (A2AProtocolProvider.isPlaceholderUrl(endpointInfo.endpoint)) {
      throw new Error(
        `Invalid A2A endpoint: The agent's A2A endpoint appears to be a placeholder URL (${endpointInfo.endpoint}). ` +
        `Please update the agent's endpoint to a valid, accessible URL. ` +
        `The endpoint should point to a real agent provider that can handle A2A protocol messages.`
      );
    }

    // Authenticate on first message if Veramo agent is available
    let authChallenge: any = null;
    if (this.veramoAgent && !this.authenticated) {
      // Use the A2A endpoint as the audience (the exact URL we're sending the request to)
      // This should match what the agent expects for authentication
      const endpointInfo = await this.getA2AEndpoint();
      if (!endpointInfo?.endpoint) {
        throw new Error('A2A endpoint is required for authentication');
      }
      const aud = endpointInfo.endpoint;
      console.log('[A2A] Using audience for authentication:', aud);
      authChallenge = await this.createSignedChallenge(aud);
      if (authChallenge) {
        this.authenticated = true;
      }
    }

    // Build request with authentication
    const authenticatedRequest: AuthenticatedA2ARequest = {
      ...request,
      ...(authChallenge && { auth: authChallenge }),
    };

    try {
      const response = await fetch(endpointInfo.endpoint, {
        method: endpointInfo.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(authenticatedRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`A2A request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data: A2AResponse = await response.json();
      
      // If authentication failed, reset and throw
      if (data.success === false && data.error?.includes('authentication')) {
        this.authenticated = false;
        throw new Error(data.error || 'Authentication failed');
      }

      return data;
    } catch (error) {
      console.error('Failed to send A2A message:', error);
      throw error;
    }
  }

}
