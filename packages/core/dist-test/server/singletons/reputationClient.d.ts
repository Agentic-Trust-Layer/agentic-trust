/**
 * Reputation Client Singleton
 *
 * Manages a singleton instance of AIAgentReputationClient
 * Initialized from session package or environment variables
 */
import { AIAgentReputationClient } from '@erc8004/agentic-trust-sdk';
/**
 * Get or create the AIAgentReputationClient singleton
 * Initializes from session package if available, otherwise uses environment variables
 */
export declare function getReputationClient(): Promise<AIAgentReputationClient>;
/**
 * Check if reputation client is initialized
 */
export declare function isReputationClientInitialized(): boolean;
/**
 * Reset the singleton (useful for testing)
 */
export declare function resetReputationClient(): void;
//# sourceMappingURL=reputationClient.d.ts.map