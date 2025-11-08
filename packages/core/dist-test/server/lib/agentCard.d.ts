/**
 * Agent Card (agent-card.json) types and fetching
 */
export interface AgentSkill {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    examples?: string[];
    inputModes?: string[];
    outputModes?: string[];
}
export interface AgentRegistration {
    agentId: number;
    agentAddress: string;
    signature: string;
}
export interface AgentProvider {
    organization: string;
    url: string;
}
export interface AgentCapabilities {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
    [key: string]: unknown;
}
export interface AgentCard {
    name: string;
    description?: string;
    url: string;
    provider?: AgentProvider;
    version?: string;
    capabilities?: AgentCapabilities;
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    skills?: AgentSkill[];
    registrations?: AgentRegistration[];
    trustModels?: string[];
    supportsAuthenticatedExtendedCard?: boolean;
    feedbackDataURI?: string;
    [key: string]: unknown;
}
/**
 * Fetch agent-card.json from a URL
 * Supports both direct URLs and base URLs (will append /.well-known/agent-card.json)
 */
export declare function fetchAgentCard(cardUrl: string): Promise<AgentCard | null>;
//# sourceMappingURL=agentCard.d.ts.map