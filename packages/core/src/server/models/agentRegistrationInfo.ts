/**
 * ERC-8004 Agent Registration JSON structure
 * Based on ERC-8004 specification for agent identity metadata
 * https://eips.ethereum.org/EIPS/eip-8004
 */
export interface AgentRegistrationInfo {
  /**
   * ERC-8004 registration type identifier
   */
  type: string;

  /**
   * Agent name
   */
  name: string;

  /**
   * Agent description
   */
  description?: string;

  /**
   * Agent base URL (non-standard but used by our implementation)
   */
  agentUrl?: string;

  /**
   * Agent image URL
   */
  image?: string;

  /**
   * Agent services (A2A, MCP, APIs, etc.)
   */
  services?: Array<{
    type: string;
    endpoint: string;
    version?: string;
    capabilities?: string[];
  }>;

  /**
   * @deprecated Legacy field. New registrations should use `services`.
   */
  endpoints?: Array<{
    name: string;
    endpoint: string;
    version?: string;
    capabilities?: Record<string, any>;
    a2aSkills?: string[];
    a2aDomains?: string[];
    mcpSkills?: string[];
    mcpDomains?: string[];
  }>;

  /**
   * Agent registrations across chains
   */
  registrations?: Array<{
    agentId: string | number | null;
    agentRegistry: string;
    registeredAt?: string;
  }>;

  /**
   * Whether this agent is currently active.
   * Not in ERC-8004 spec but used by our discovery layer.
   */
  active?: boolean;

  /**
   * Supported trust models
   */
  supportedTrust?: string[];

  /**
   * Agent account address (EOA or smart account)
   * Not in ERC-8004 spec but useful for our implementation
   */
  agentAccount?: `0x${string}`;

  /**
   * Optional agent category.
   * Not in ERC-8004 spec but used by our discovery/indexer.
   */
  agentCategory?: string;

  /**
   * Registry metadata fields
   */
  registeredBy?: string;
  registryNamespace?: string;
  uaid?: string;

  /**
   * Legacy fields for backward compatibility
   */
  version?: string;
  metadata?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  external_url?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
}


