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
export declare class AgenticTrustClient {
    private graphQLClient;
    private config;
    agents: AgentsAPI;
    a2aProtocolProvider: A2AProtocolProviderAPI;
    veramo: VeramoAPI;
    /**
     * Get the client address from ClientApp singleton
     * @returns The client's Ethereum address
     * @throws Error if ClientApp is not initialized
     */
    getClientAddress(): Promise<`0x${string}`>;
    /**
     * Get the ENS client singleton
     * @returns The ENS client instance
     */
    getENSClient(): Promise<any>;
    getDiscoveryClient(): Promise<any>;
    /**
     * Verify a signed challenge
     * Handles all Veramo agent logic internally - no Veramo exposure at app level
     *
     * @param auth - The authentication challenge with signature
     * @param expectedAudience - Expected audience (provider URL) for validation
     * @returns Verification result with client address if valid
     */
    verifyChallenge(auth: AuthChallenge, expectedAudience: string): Promise<ChallengeVerificationResult>;
    private constructor();
    /**
     * Initialize the Veramo agent (internal method)
     * Called automatically during create() if not provided in config
     */
    private initializeVeramoAgent;
    /**
     * Create a new AgenticTrust client instance
     */
    static create(config: ApiClientConfig): Promise<AgenticTrustClient>;
    /**
     * Initialize reputation client from session package
     * Uses environment variables only (no overrides allowed)
     * @internal
     */
    private initializeReputationFromSessionPackage;
    /**
     * Initialize reputation client from top-level config (identityRegistry and reputationRegistry)
     * Uses the EOA (Externally Owned Account) derived from the private key
     * @internal
     */
    private initializeReputationFromConfig;
    /**
     * Execute a GraphQL query
     */
    query<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
    /**
     * Execute a GraphQL mutation
     */
    mutate<T = unknown>(mutation: string, variables?: Record<string, unknown>): Promise<T>;
    /**
     * Get the underlying GraphQL client (for advanced usage)
     */
    getGraphQLClient(): GraphQLClient;
    /**
     * Update the API key and recreate the client
     */
    setApiKey(apiKey: string): void;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<ApiClientConfig>;
}
//# sourceMappingURL=agenticTrustClient.d.ts.map