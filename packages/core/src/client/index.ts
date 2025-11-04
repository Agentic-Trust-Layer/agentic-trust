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
    this.config = { ...config };
    
    // Construct GraphQL endpoint URL
    if (!config.graphQLUrl) {
      throw new Error('graphQLUrl is required in ApiClientConfig');
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
    console.log('🔧 initializeVeramoAgent: Starting...');
    
    if (config.veramoAgent) {
      console.log('✅ initializeVeramoAgent: Using provided agent');
      // Use provided agent
      this.veramo.connect(config.veramoAgent);
    } else {
      console.log('🏭 initializeVeramoAgent: Creating agent internally...');
      // Import the factory function
      const { createVeramoAgentForClient } = await import('./veramoFactory');
      console.log('✅ initializeVeramoAgent: Factory imported: ', config.rpcUrl, ', privateKey: ', config.privateKey);
      
      // Create agent internally
      const agent = await createVeramoAgentForClient(
        config.privateKey,
        config.rpcUrl
      );
      console.log('✅ initializeVeramoAgent: Agent created, connecting...');
      this.veramo.connect(agent);
      console.log('✅ initializeVeramoAgent: Complete');
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
    console.log('📋 AgenticTrustClient.create: Step 2 - Checking reputation configuration...');
    if (config.sessionPackage) {
      console.log('📋 AgenticTrustClient.create: Initializing reputation from sessionPackage...');
      await client.initializeReputationFromSessionPackage(config.sessionPackage as { filePath?: string; package?: import('./sessionPackage').SessionPackage; ensRegistry: `0x${string}` });
      console.log('✅ AgenticTrustClient.create: Reputation initialized from sessionPackage');
    } else if (config.identityRegistry && config.reputationRegistry) {
      console.log('📋 AgenticTrustClient.create: Initializing reputation from top-level config (identityRegistry + reputationRegistry)...');
      // Initialize reputation from top-level config (identityRegistry and reputationRegistry)
      // Uses the EOA derived from privateKey (same as VeramoAgent)
      console.log('📋 AgenticTrustClient.create: Initializing reputation from top-level config (identityRegistry + reputationRegistry)...');
      await client.initializeReputationFromConfig(config);
      console.log('✅ AgenticTrustClient.create: Reputation initialized from top-level config');
    } else {
      console.log('⚠️ AgenticTrustClient.create: Reputation client not initialized (missing identityRegistry or reputationRegistry)');
    }
    
    // Summary: Both VeramoAgent and ReputationClient are now configured
    const veramoConfigured = client.veramo.isConnected();
    const reputationConfigured = client.reputation.isInitialized();
    console.log('📊 AgenticTrustClient.create: Summary', {
      veramoConfigured,
      reputationConfigured,
      bothConfigured: veramoConfigured && reputationConfigured,
    });
    
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

    /*
    const rpcUrl = this.config.rpcUrl;
    if (!rpcUrl) {
      throw new Error(
        'rpcUrl is required. Set NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL environment variable.'
      );
    }
      */

    const reputationRegistry = this.config.reputationRegistry;
    if (!reputationRegistry) {
      throw new Error(
        'reputationRegistry is required. Set NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY environment variable.'
      );
    }

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
      reputationRegistry,
      ensRegistry: config.ensRegistry,
    });
  }

  /**
   * Initialize reputation client from top-level config (identityRegistry and reputationRegistry)
   * Uses the EOA (Externally Owned Account) derived from the private key
   * @internal
   */
  private async initializeReputationFromConfig(config: ApiClientConfig): Promise<void> {
    console.log('🔧 initializeReputationFromConfig: Starting...');
    
    const identityRegistry = config.identityRegistry;
    const reputationRegistry = config.reputationRegistry;
    
    if (!identityRegistry || !reputationRegistry) {
      throw new Error(
        'identityRegistry and reputationRegistry are required. Set NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY and NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY environment variables.'
      );
    }


    const rpcUrl = config.rpcUrl;
    if (!rpcUrl) {
      throw new Error(
        'RPC URL is required. Set NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL environment variable.'
      );
    }

    // Get ENS registry (optional, but recommended)
    const ensRegistry = config.sessionPackage?.ensRegistry || 
      (process.env.AGENTIC_TRUST_ENS_REGISTRY || process.env.NEXT_PUBLIC_AGENTIC_TRUST_ENS_REGISTRY) as `0x${string}` | undefined;
    
    if (!ensRegistry) {
      console.log('⚠️ ENS registry not provided. which might be ok.');
    }

    // Get private key from config - required for reputation client
    if (!config.privateKey) {
      throw new Error('privateKey is required to initialize reputation client. Set AGENTIC_TRUST_PRIVATE_KEY or NEXT_PUBLIC_AGENTIC_TRUST_PRIVATE_KEY environment variable.');
    }

    // Normalize private key (same logic as veramoFactory)
    let cleanedKey = config.privateKey.trim().replace(/\s+/g, '');
    if (cleanedKey.startsWith('0x')) {
      cleanedKey = cleanedKey.slice(2);
    }
    if (!/^[0-9a-fA-F]{64}$/.test(cleanedKey)) {
      throw new Error('Invalid private key format');
    }
    const normalizedKey = `0x${cleanedKey}` as `0x${string}`;

    // Create account from private key - this gives us the EOA address
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(normalizedKey);
    
    // Use the EOA address derived from the private key
    const eoaAddress = account.address as `0x${string}`;
    console.log('🔧 initializeReputationFromConfig: Using EOA from private key', eoaAddress);

    // Create public and wallet clients
    const { createPublicClient, createWalletClient, http: httpTransport } = await import('viem');
    const { sepolia } = await import('viem/chains');

    // Create public client
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: httpTransport(rpcUrl),
    });

    // Create wallet client with the account
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: httpTransport(rpcUrl),
    });

    // Use the EOA address for both client and agent
    // Both VeramoAgent and ReputationClient will use the same private key and thus the same EOA
    const clientAccount: `0x${string}` = eoaAddress;
    const agentAccount: `0x${string}` = eoaAddress;

    console.log('🔧 initializeReputationFromConfig: Initializing reputation client with EOA...');

    await this.reputation.initialize({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      clientAccount,
      agentAccount,
      identityRegistry,
      reputationRegistry,
      ensRegistry: ensRegistry || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as `0x${string}`, // Default ENS registry on Sepolia
    });

    console.log('✅ initializeReputationFromConfig: Complete - Reputation client initialized with EOA:', eoaAddress);
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

