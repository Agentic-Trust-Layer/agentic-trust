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
  [key: string]: unknown; // Allow for additional fields
}

/**
 * Fetch agent-card.json from a URL
 * Supports both direct URLs and base URLs (will append /.well-known/agent-card.json)
 */
export async function fetchAgentCard(cardUrl: string): Promise<AgentCard | null> {
  try {
    // Ensure URL is absolute or resolve relative URLs
    let url = cardUrl.startsWith('http') 
      ? cardUrl 
      : new URL(cardUrl, typeof window !== 'undefined' ? window.location.origin : '').toString();

    // If URL doesn't end with agent-card.json or .well-known, append the standard path
    if (!url.includes('agent-card.json')) {
      // Remove trailing slash and append the standard path
      url = `${url.replace(/\/$/, '')}/.well-known/agent-card.json`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch agent card: ${response.status} ${response.statusText}`);
    }

    const card: AgentCard = await response.json();
    return card;
  } catch (error) {
    console.error('Error fetching agent card:', error);
    return null;
  }
}

