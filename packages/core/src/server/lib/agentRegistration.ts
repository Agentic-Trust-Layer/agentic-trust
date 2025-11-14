/**
 * ERC-8004 Agent Registration JSON
 * 
 * Standard JSON structure for agent registration metadata
 * Stored on IPFS and referenced via Identity Token tokenURI
 */

import { getIPFSStorage, type IPFSStorage } from '../../storage/ipfs';
import type { AgentRegistrationInfo } from '../models/agentRegistrationInfo';

/**
 * Upload agent registration JSON to IPFS
 * @param registration - Registration JSON data
 * @param storage - Optional IPFS storage instance (uses singleton if not provided)
 * @returns Upload result with CID and URL
 */
export async function uploadRegistration(
  registration: AgentRegistrationInfo,
  storage?: IPFSStorage
): Promise<{ cid: string; url: string; tokenURI: string }> {
  const ipfsStorage = storage || getIPFSStorage();
  
  // Ensure ERC-8004 type is set
  const registrationWithType: AgentRegistrationInfo = {
    ...registration,
    type: registration.type || 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    // Set timestamps for legacy fields if not provided
    createdAt: registration.createdAt || new Date().toISOString(),
    updatedAt: registration.updatedAt || new Date().toISOString(),
  };
  
  // Convert to JSON string
  const jsonString = JSON.stringify(registrationWithType, null, 2);
  
  // Upload to IPFS
  const result = await ipfsStorage.upload(jsonString, 'registration.json');
  
  // Return with tokenURI format (ipfs://CID)
  const tokenURI = `ipfs://${result.cid}`;
  
  return {
    cid: result.cid,
    url: result.url,
    tokenURI,
  };
}

/**
 * Retrieve agent registration JSON from IPFS
 * @param cidOrTokenURI - CID, tokenURI (ipfs://CID format), or full gateway URL
 * @param storage - Optional IPFS storage instance (uses singleton if not provided)
 * @returns Registration JSON data
 */
export async function getRegistration(
  cidOrTokenURI: string,
  storage?: IPFSStorage
): Promise<AgentRegistrationInfo> {
  const ipfsStorage = storage || getIPFSStorage();
  
  // Use the new getJson method which handles all URI formats and gateway fallbacks
  const registration = await ipfsStorage.getJson(cidOrTokenURI);
  
  if (!registration) {
    throw new Error(`Failed to retrieve registration from IPFS: ${cidOrTokenURI}`);
  }
  
  return registration as AgentRegistrationInfo;
}

/**
 * Create registration JSON from agent data
 * Helper function to build ERC-8004 compliant registration JSON
 */
export function createRegistrationJSON(params: {
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
  // Legacy fields
  metadata?: Record<string, string>;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
}): AgentRegistrationInfo {
  const endpoints: Array<{
    name: string;
    endpoint: string;
    version?: string;
    capabilities?: Record<string, any>;
  }> = params.endpoints || [];
  
  // If agentUrl is provided, automatically create A2A and MCP endpoints
  if (params.agentUrl) {
    const baseUrl = params.agentUrl.replace(/\/$/, ''); // Remove trailing slash
    
    // Add A2A endpoint if not already present
    if (!endpoints.find(e => e.name === 'A2A')) {
      endpoints.push({
        name: 'A2A',
        endpoint: `${baseUrl}/.well-known/agent-card.json`,
        version: '0.3.0',
      });
    }
    
    // Add MCP endpoint if not already present
    if (!endpoints.find(e => e.name === 'MCP')) {
      endpoints.push({
        name: 'MCP',
        endpoint: `${baseUrl}/`,
        version: '2025-06-18',
      });
    }
  }
  
  // Build registrations array if chainId and identityRegistry are provided
  const registrations: Array<{
    agentId: string | number;
    agentRegistry: string;
  }> = [];
  
  if (params.chainId && params.identityRegistry && params.agentId) {
    // Ensure identityRegistry is a string
    const identityRegistryStr = String(params.identityRegistry);
    registrations.push({
      agentId: params.agentId,
      agentRegistry: `eip155:${params.chainId}:${identityRegistryStr}`,
    });
  }
  
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: params.name,
    description: params.description,
    image: params.image,
    endpoints: endpoints.length > 0 ? endpoints : undefined,
    registrations: registrations.length > 0 ? registrations : undefined,
    supportedTrust: params.supportedTrust,
    agentAccount: params.agentAccount,
    // Legacy fields
    metadata: params.metadata,
    external_url: params.external_url,
    attributes: params.attributes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

