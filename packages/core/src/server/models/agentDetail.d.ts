import type { AgentInfo } from './agentInfo';
/**
 * Detailed Agent view combining AgentInfo (discovery),
 * on-chain identity, IPFS registration, and extra flattened fields.
 */
export interface AgentDetail extends AgentInfo {
    success: true;
    identityMetadata: {
        tokenUri: string | null;
        metadata: Record<string, string>;
    };
    identityRegistration: {
        tokenUri: string;
        registration: Record<string, unknown> | null;
    } | null;
    [key: string]: unknown;
}
export type AgentIdentifier = string | bigint;
//# sourceMappingURL=agentDetail.d.ts.map