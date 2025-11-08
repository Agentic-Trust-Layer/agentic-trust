export type AgentAccountResolution = {
    account: `0x${string}` | null;
    method: 'ens-identity' | 'ens-direct' | 'discovery' | 'deterministic' | null;
};
export declare function extractAgentAccountFromDiscovery(agent: unknown): `0x${string}` | null;
/**
 * Resolve the agent account address using ENS. Falls back to deterministic indication when not found.
 */
export declare function getAgentAccountByAgentName(agentName: string): Promise<AgentAccountResolution>;
//# sourceMappingURL=agentAccount.d.ts.map