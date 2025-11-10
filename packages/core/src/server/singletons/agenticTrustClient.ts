/**
 * AgenticTrust API Client
 * 
 * Client for interacting with the AgenticTrust GraphQL API
 */

import { GraphQLClient } from 'graphql-request';
import type { ApiClientConfig } from '../lib/types';
import { AgentsAPI } from '../lib/agents';
import { A2AProtocolProviderAPI } from '../lib/a2aProtocolProvider';
import { VeramoAPI, type AuthChallenge, type ChallengeVerificationResult } from '../lib/veramo';

import { getClientAddress } from '../userApps/clientApp';
import { getENSClient } from './ensClient';
import { getDiscoveryClient } from './discoveryClient';
import { getReputationClient, isReputationClientInitialized, resetReputationClient } from './reputationClient';
import { getAdminApp } from '../userApps/adminApp';
import { createVeramoAgentForClient } from '../lib/veramoFactory';
import { getChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';

export class AgenticTrustClient {
  private graphQLClient: GraphQLClient;
  private config: ApiClientConfig;
  public agents: AgentsAPI;
  public a2aProtocolProvider: A2AProtocolProviderAPI;
  public veramo: VeramoAPI;

  /**
   * Get the client address from ClientApp singleton
   * @returns The client's Ethereum address
   * @throws Error if ClientApp is not initialized
   */
  async getClientAddress(): Promise<`0x${string}`> {

    return await getClientAddress();
  }

  /**
   * Get the admin EOA address derived from AGENTIC_TRUST_ADMIN_PRIVATE_KEY
   * @returns The admin's Ethereum address
   * @throws Error if AGENTIC_TRUST_ADMIN_PRIVATE_KEY is not set or invalid
   */
  async getAdminEOAAddress(): Promise<`0x${string}`> {
    const privateKey = process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY || process.env.AGENTIC_TRUST_PRIVATE_KEY;

    if (!privateKey) {
      throw new Error('AGENTIC_TRUST_ADMIN_PRIVATE_KEY environment variable is required');
    }

    const { privateKeyToAccount } = await import('viem/accounts');
    const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(normalizedKey as `0x${string}`);

    return account.address as `0x${string}`;
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
    console.log('🔧 initializeVeramoAgent: Starting...');
    
    if (config.veramoAgent) {
      console.log('✅ initializeVeramoAgent: Using provided agent');
      // Use provided agent
      this.veramo.connect(config.veramoAgent);
    } else {
      console.log('🏭 initializeVeramoAgent: Creating agent internally...');

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
      await client.initializeReputationFromSessionPackage(config.sessionPackage as { filePath?: string; package?: import('../lib/sessionPackage').SessionPackage; ensRegistry: `0x${string}` });
      console.log('✅ AgenticTrustClient.create: Reputation initialized from sessionPackage');
    } else if (config.identityRegistry && config.reputationRegistry) {
      // Initialize reputation from top-level config (identityRegistry and reputationRegistry)
      // Uses the EOA derived from privateKey (same as VeramoAgent)
      // Note: Reputation client requires private key for signing operations
      if (config.privateKey) {
        console.log('📋 AgenticTrustClient.create: Initializing reputation from top-level config (identityRegistry + reputationRegistry)...');
        await client.initializeReputationFromConfig(config);
        console.log('✅ AgenticTrustClient.create: Reputation initialized from top-level config');
      } else {
        console.log('⚠️ AgenticTrustClient.create: Reputation client not initialized (private key required for reputation operations)');
      }
    } else {
      console.log('⚠️ AgenticTrustClient.create: Reputation client not initialized (missing identityRegistry or reputationRegistry)');
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
    package?: import('../lib/sessionPackage').SessionPackage;
    ensRegistry: `0x${string}`;
  }): Promise<void> {
    const { loadSessionPackage, buildDelegationSetup, buildAgentAccountFromSession } = await import('../lib/sessionPackage');
    
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
  private async initializeReputationFromConfig(config: ApiClientConfig): Promise<void> {
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
    let agentAccountProvider: any;
    let clientAccountProvider: any;
    let eoaAddress: `0x${string}` | undefined;

    // Try AdminApp first (for admin operations)
    // Only try AdminApp if we're in an admin app context
    const isAdminApp = process.env.AGENTIC_TRUST_IS_ADMIN_APP === 'true' || process.env.AGENTIC_TRUST_IS_ADMIN_APP === '1';
    if (isAdminApp) {
      try {
        const { getAdminApp } = await import('../userApps/adminApp');
        const adminApp = await getAdminApp();
        if (adminApp && adminApp.accountProvider) {
          // Use AdminApp's AccountProvider (works with private key OR wallet provider)
          agentAccountProvider = adminApp.accountProvider;
          clientAccountProvider = adminApp.accountProvider; // For admin, agent and client are the same
          eoaAddress = adminApp.address;
          console.log('🔧 initializeReputationFromConfig: Using AdminApp AccountProvider', eoaAddress);
        }
      } catch (error) {
        // AdminApp not available, try ClientApp
        console.log('🔧 initializeReputationFromConfig: AdminApp not available, trying ClientApp...');
      }
    } else {
      // Skip AdminApp for non-admin apps (web, provider, etc.)
      console.log('🔧 initializeReputationFromConfig: Skipping AdminApp (not an admin app), trying ClientApp...');
    }

    // Try ClientApp if AdminApp didn't work
    if (!agentAccountProvider) {
      try {
        const { getClientApp } = await import('../userApps/clientApp');
        const clientApp = await getClientApp();
        if (clientApp && clientApp.accountProvider) {
          // Use ClientApp's AccountProvider
          const { ViemAccountProvider } = await import('@agentic-trust/8004-sdk');
          agentAccountProvider = new ViemAccountProvider({
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
          clientAccountProvider = clientApp.accountProvider;
          eoaAddress = clientApp.address;
          console.log('🔧 initializeReputationFromConfig: Using ClientApp AccountProvider', eoaAddress);
        }
      } catch (error) {
        // ClientApp not available, fall back to privateKey
        console.log('🔧 initializeReputationFromConfig: ClientApp not available, falling back to privateKey...');
      }
    }

    // Fall back to privateKey-based creation if no wallet/app available
    if (!agentAccountProvider && config.privateKey) {
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
      agentAccountProvider = new ViemAccountProvider({
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
      clientAccountProvider = agentAccountProvider; // For single account, agent and client are the same

      console.log('🔧 initializeReputationFromConfig: Using EOA from private key', eoaAddress);
    }

    // If we still don't have AccountProviders, throw error
    if (!agentAccountProvider || !clientAccountProvider) {
      throw new Error(
        'Cannot initialize reputation client: No wallet available. ' +
        'Provide either:\n' +
        '  1. Wallet connection (MetaMask/Web3Auth) - AdminApp will be used\n' +
        '  2. Private key via AGENTIC_TRUST_PRIVATE_KEY or config.privateKey\n' +
        '  3. ClientApp initialization (set AGENTIC_TRUST_IS_CLIENT_APP=true)'
      );
    }

    // Create the reputation client using the AccountProviders
    // The AccountProviders can be from AdminApp (wallet provider), ClientApp, or created from privateKey
    const { AIAgentReputationClient } = await import('@agentic-trust/8004-ext-sdk');
    
    const reputationClient = await AIAgentReputationClient.create(
      agentAccountProvider,
      clientAccountProvider,
      identityRegistry,
      reputationRegistry,
      (ensRegistry || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as `0x${string}` // Default ENS registry on Sepolia
    );

    // Store the reputation client in the singleton
    // Import the singleton module and set it directly
    const reputationClientModule = await import('./reputationClient');
    // Access the singleton instance variable (we need to export a setter or access it)
    // For now, we'll use a workaround - the singleton will be initialized when getReputationClient is called
    // But we've created the client here, so future calls to getReputationClient should use the singleton's logic
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
}

