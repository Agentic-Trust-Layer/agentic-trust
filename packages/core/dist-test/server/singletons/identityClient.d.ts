/**
 * Identity Client Singleton
 *
 * Manages a singleton instance of AIAgentIdentityClient
 * Initialized from environment variables using AccountProvider
 */
import { AIAgentIdentityClient } from '@erc8004/agentic-trust-sdk';
/**
 * Get or create the AIAgentIdentityClient singleton
 * Initializes from environment variables using AccountProvider
 */
export declare function getIdentityClient(): Promise<AIAgentIdentityClient>;
/**
 * Check if identity client is initialized
 */
export declare function isIdentityClientInitialized(): boolean;
/**
 * Reset the singleton (useful for testing)
 */
export declare function resetIdentityClient(): void;
//# sourceMappingURL=identityClient.d.ts.map