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

export class AgenticTrustClient {
  private graphQLClient: GraphQLClient;
  private config: ApiClientConfig;
  public agents: AgentsAPI;
  public a2aProtocolProvider: A2AProtocolProviderAPI;
  public veramo: VeramoAPI;
  public verification: VerificationAPI;

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
    return client;
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

