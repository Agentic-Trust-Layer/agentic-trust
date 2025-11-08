/**
 * ERC-8004 Agent Registration JSON
 *
 * Standard JSON structure for agent registration metadata
 * Stored on IPFS and referenced via Identity Token tokenURI
 */
import { type IPFSStorage } from '../../storage/ipfs';
/**
 * ERC-8004 Agent Registration JSON structure
 * Based on ERC-8004 specification for agent identity metadata
 * https://eips.ethereum.org/EIPS/eip-8004
 */
export interface AgentRegistrationJSON {
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
     * Agent image URL
     */
    image?: string;
    /**
     * Agent endpoints (A2A, MCP, etc.)
     */
    endpoints?: Array<{
        name: string;
        endpoint: string;
        version?: string;
        capabilities?: Record<string, any>;
    }>;
    /**
     * Agent registrations across chains
     */
    registrations?: Array<{
        agentId: string | number;
        agentRegistry: string;
    }>;
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
/**
 * Upload agent registration JSON to IPFS
 * @param registration - Registration JSON data
 * @param storage - Optional IPFS storage instance (uses singleton if not provided)
 * @returns Upload result with CID and URL
 */
export declare function uploadRegistration(registration: AgentRegistrationJSON, storage?: IPFSStorage): Promise<{
    cid: string;
    url: string;
    tokenURI: string;
}>;
/**
 * Retrieve agent registration JSON from IPFS
 * @param cidOrTokenURI - CID, tokenURI (ipfs://CID format), or full gateway URL
 * @param storage - Optional IPFS storage instance (uses singleton if not provided)
 * @returns Registration JSON data
 */
export declare function getRegistration(cidOrTokenURI: string, storage?: IPFSStorage): Promise<AgentRegistrationJSON>;
/**
 * Create registration JSON from agent data
 * Helper function to build ERC-8004 compliant registration JSON
 */
export declare function createRegistrationJSON(params: {
    name: string;
    agentAccount: `0x${string}`;
    agentId?: string | number;
    description?: string;
    image?: string;
    agentUrl?: string;
    chainId?: number;
    identityRegistry?: `0x${string}`;
    supportedTrust?: string[];
    endpoints?: Array<{
        name: string;
        endpoint: string;
        version?: string;
        capabilities?: Record<string, any>;
    }>;
    metadata?: Record<string, string>;
    external_url?: string;
    attributes?: Array<{
        trait_type: string;
        value: string | number;
    }>;
}): AgentRegistrationJSON;
//# sourceMappingURL=registration.d.ts.map