/**
 * AgenticTrust API Client
 * 
 * Client for interacting with the AgenticTrust GraphQL API
 */

import { GraphQLClient } from 'graphql-request';
import type { ApiClientConfig } from './types';
import { AgentsAPI } from './agents';
import { A2AProtocolProviderAPI } from './a2aProtocolProvider';
import { VeramoAPI } from './veramo';
import { VerificationAPI } from './verification';
import { ReputationAPI } from './reputation';
import { createVeramoAgentForClient } from './veramoFactory';

export type { ApiClientConfig } from './types';
export type { AgentData } from './agents';
export type { ListAgentsResponse } from './agents';
export { Agent } from './agent';
export type { 
  MessageRequest, 
  MessageResponse, 
  AgentCard, 
  AgentSkill, 
  AgentCapabilities 
} from './agent';
export type {
  AgentProvider,
  A2ARequest,
  A2AResponse,
  ProviderEndpoint,
} from './a2aProtocolProvider';
export { A2AProtocolProvider } from './a2aProtocolProvider';
export type {
  AgentRegistration,
} from './agentCard';
export type { VeramoAgent } from './veramo';
export { createVeramoAgentForClient } from './veramoFactory';
export type {
  Challenge,
  ChallengeRequest,
  SignedChallenge,
  VerificationRequest,
  VerificationResult,
} from './verification';
export type { SessionPackage, DelegationSetup } from './sessionPackage';
export {
  loadSessionPackage,
  validateSessionPackage,
  buildDelegationSetup,
  buildAgentAccountFromSession,
} from './sessionPackage';

export class AgenticTrustClient {
  private graphQLClient: GraphQLClient;
  private config: ApiClientConfig;
  public agents: AgentsAPI;
  public a2aProtocolProvider: A2AProtocolProviderAPI;
  public veramo: VeramoAPI;
  public verification: VerificationAPI;
  public reputation: ReputationAPI;

  private constructor(config: ApiClientConfig) {
    // Set default baseUrl if not provided
    const baseUrl = config.baseUrl || '';
    this.config = { ...config, baseUrl };
    
    // Construct GraphQL endpoint URL
    const endpoint = baseUrl.endsWith('/graphql')
      ? baseUrl
      : `${baseUrl.replace(/\/$/, '')}/graphql`;

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

    // Initialize API namespaces
    this.agents = new AgentsAPI(this.graphQLClient, this);
    this.a2aProtocolProvider = new A2AProtocolProviderAPI(this.graphQLClient);
    this.veramo = new VeramoAPI();
    this.reputation = new ReputationAPI();

    // Initialize verification API (will be connected after agent is ready)
    this.verification = new VerificationAPI(() => this.veramo.getAgent());
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
        config.ethereumRpcUrl,
        config.sepoliaRpcUrl
      );
      this.veramo.connect(agent);
    }
  }

  /**
   * Create a new AgenticTrust client instance
   */
  static async create(config: ApiClientConfig): Promise<AgenticTrustClient> {
    const client = new AgenticTrustClient(config);
    // Initialize Veramo agent if not provided
    await client.initializeVeramoAgent(config);
    
    // Initialize reputation client if configured
    // Priority: sessionPackage > reputation config
    if (config.sessionPackage) {
      await client.initializeReputationFromSessionPackage(config.sessionPackage);
    } else if (config.reputation) {
      const identityRegistry = config.reputation.identityRegistry || config.identityRegistry;
      if (!identityRegistry) {
        throw new Error(
          'identityRegistry is required. Provide it in reputation config or set NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY environment variable.'
        );
      }
      await client.reputation.initialize({
        ...config.reputation,
        identityRegistry,
      });
    }
    
    return client;
  }

  /**
   * Initialize reputation client from session package
   * Uses environment variables only (no overrides allowed)
   * @internal
   */
  private async initializeReputationFromSessionPackage(config: {
    filePath?: string;
    package?: import('./sessionPackage').SessionPackage;
    ensRegistry: `0x${string}`;
  }): Promise<void> {
    const { loadSessionPackage, buildDelegationSetup, buildAgentAccountFromSession } = await import('./sessionPackage');
    
    // Load session package
    const sessionPackage = config.package || loadSessionPackage(config.filePath);
    // buildDelegationSetup uses env vars only (no overrides)
    const delegationSetup = buildDelegationSetup(sessionPackage);
    
    // Build agent account from session
    const agentAccount = await buildAgentAccountFromSession(sessionPackage);
    
    // Create wallet client
    const { createWalletClient, http: httpTransport } = await import('viem');
    const walletClient = createWalletClient({
      account: agentAccount,
      chain: delegationSetup.chain,
      transport: httpTransport(delegationSetup.rpcUrl),
    });

    // Get client account (session key address)
    const clientAccount = sessionPackage.sessionKey.address as `0x${string}`;

    // Initialize reputation client with session package data
    // Use reputationRegistry from delegationSetup (which includes env var overrides)
    const identityRegistry = this.config.identityRegistry;
    if (!identityRegistry) {
      throw new Error(
        'identityRegistry is required. Set NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY environment variable.'
      );
    }
    await this.reputation.initialize({
      publicClient: delegationSetup.publicClient,
      walletClient: walletClient as any,
      clientAccount,
      agentAccount: agentAccount.address as `0x${string}`,
      identityRegistry,
      reputationRegistry: delegationSetup.reputationRegistry,
      ensRegistry: config.ensRegistry,
    });
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
    
    // Get baseUrl (should always be set from constructor)
    const baseUrl = this.config.baseUrl || '';
    
    // Recreate client with new API key
    const endpoint = baseUrl.endsWith('/graphql')
      ? baseUrl
      : `${baseUrl.replace(/\/$/, '')}/graphql`;

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
    this.agents = new AgentsAPI(this.graphQLClient, this);
    this.a2aProtocolProvider = new A2AProtocolProviderAPI(this.graphQLClient);
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<ApiClientConfig> {
    return { ...this.config };
  }
}

