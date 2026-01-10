/**
 * Association Client Singleton
 *
 * Manages a singleton instance of AssociationsStoreClient
 * Initialized from environment variables and domain AccountProvider
 */
import { AIAgentAssociationClient } from '@agentic-trust/8004-ext-sdk';
export declare function getAssociationsClient(chainId?: number): Promise<AIAgentAssociationClient>;
export declare function isAssociationsClientInitialized(chainId?: number): boolean;
export declare function resetAssociationsClient(chainId?: number): void;
//# sourceMappingURL=associationClient.d.ts.map