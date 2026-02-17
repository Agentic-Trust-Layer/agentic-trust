/**
 * ERC-8004 Agent Registration JSON
 * 
 * Standard JSON structure for agent registration metadata
 * Stored on IPFS and referenced via Identity Token tokenUri
 */

import { getIPFSStorage, type IPFSStorage } from './ipfs';
import type { AgentRegistrationInfo } from '../models/agentRegistrationInfo';
import { getChainContractAddress } from './chainConfig';

/**
 * Upload agent registration JSON to IPFS
 * @param registration - Registration JSON data
 * @param storage - Optional IPFS storage instance (uses singleton if not provided)
 * @returns Upload result with CID and URL
 */
export async function uploadRegistration(
  registration: AgentRegistrationInfo,
  storage?: IPFSStorage
): Promise<{ cid: string; url: string; tokenUri: string }> {
  const ipfsStorage = storage || getIPFSStorage();
  
  // Canonicalize registration JSON: always emit `services`, never `endpoints`.
  // This protects "update registration" flows that might send legacy `endpoints`.
  const canonicalRegistration: AgentRegistrationInfo = (() => {
    const input: any = { ...registration };

    const services: Array<{
      type?: string;
      name?: string;
      endpoint: string;
      version?: string;
      capabilities?: string[];
      a2aSkills?: string[];
      a2aDomains?: string[];
      mcpTools?: string[];
      mcpPrompts?: string[];
      skills?: string[];
      domains?: string[];
    }> = [];

    if (Array.isArray(input.services)) {
      for (const s of input.services) {
        const rawType =
          typeof s?.type === 'string'
            ? s.type.trim()
            : typeof s?.name === 'string'
              ? s.name.trim()
              : '';
        const endpoint = typeof s?.endpoint === 'string' ? s.endpoint.trim() : '';
        if (!rawType || !endpoint) continue;
        const type = rawType.toLowerCase();
        services.push({
          // Preserve both keys: `type` for canonical use, `name` for legacy/display JSON.
          type,
          name: typeof s?.name === 'string' && s.name.trim() ? s.name.trim() : rawType,
          endpoint,
          version: typeof s.version === 'string' ? s.version : undefined,
          capabilities: Array.isArray(s.capabilities)
            ? s.capabilities.map((c: any) => String(c)).filter(Boolean)
            : undefined,
          a2aSkills: Array.isArray(s.a2aSkills) ? s.a2aSkills.map((v: any) => String(v)).filter(Boolean) : undefined,
          a2aDomains: Array.isArray(s.a2aDomains) ? s.a2aDomains.map((v: any) => String(v)).filter(Boolean) : undefined,
          mcpTools: Array.isArray(s.mcpTools) ? s.mcpTools.map((v: any) => String(v)).filter(Boolean) : undefined,
          mcpPrompts: Array.isArray(s.mcpPrompts) ? s.mcpPrompts.map((v: any) => String(v)).filter(Boolean) : undefined,
          skills: Array.isArray(s.skills) ? s.skills.map((v: any) => String(v)).filter(Boolean) : undefined,
          domains: Array.isArray(s.domains) ? s.domains.map((v: any) => String(v)).filter(Boolean) : undefined,
        });
      }
    }

    if (services.length === 0 && Array.isArray(input.endpoints)) {
      for (const e of input.endpoints) {
        const name = typeof e?.name === 'string' ? e.name.trim() : '';
        const endpoint = typeof e?.endpoint === 'string' ? e.endpoint.trim() : '';
        if (!name || !endpoint) continue;
        const type = name.toLowerCase();
        const capsFromRecord =
          e.capabilities && typeof e.capabilities === 'object' && !Array.isArray(e.capabilities)
            ? Object.keys(e.capabilities as Record<string, unknown>)
            : [];
        const caps: string[] = [];
        const addCaps = (arr: unknown): void => {
          if (!Array.isArray(arr)) return;
          for (const item of arr) {
            const v = String(item ?? '').trim();
            if (v) caps.push(v);
          }
        };
        addCaps(e.a2aSkills);
        addCaps(e.mcpSkills);
        addCaps(e.a2aDomains);
        addCaps(e.mcpDomains);
        addCaps(e.mcpTools);
        addCaps(e.mcpPrompts);
        addCaps(e.skills);
        addCaps(e.domains);
        addCaps(capsFromRecord);

        const capabilities: string[] | undefined = caps.length > 0 ? Array.from(new Set(caps)) : undefined;
        services.push({
          type,
          name,
          endpoint,
          version: typeof e.version === 'string' ? e.version : undefined,
          capabilities,
          a2aSkills: Array.isArray(e.a2aSkills) ? e.a2aSkills.map((v: any) => String(v)).filter(Boolean) : undefined,
          a2aDomains: Array.isArray(e.a2aDomains) ? e.a2aDomains.map((v: any) => String(v)).filter(Boolean) : undefined,
          mcpTools: Array.isArray(e.mcpTools) ? e.mcpTools.map((v: any) => String(v)).filter(Boolean) : undefined,
          mcpPrompts: Array.isArray(e.mcpPrompts) ? e.mcpPrompts.map((v: any) => String(v)).filter(Boolean) : undefined,
          skills: Array.isArray(e.skills) ? e.skills.map((v: any) => String(v)).filter(Boolean) : undefined,
          domains: Array.isArray(e.domains) ? e.domains.map((v: any) => String(v)).filter(Boolean) : undefined,
        });
      }
    }

    // If agentUrl is provided, ensure A2A service aligns to it.
    const agentUrl = typeof input.agentUrl === 'string' ? input.agentUrl.trim() : '';
    if (agentUrl) {
      const baseUrl = agentUrl.replace(/\/$/, '');
      const a2aEndpoint = `${baseUrl}/.well-known/agent-card.json`;
      const existingA2A = services.find((s) => (s.type || '').toLowerCase() === 'a2a' || (s.name || '').toLowerCase() === 'a2a');
      if (existingA2A) {
        existingA2A.endpoint = a2aEndpoint;
        existingA2A.version = existingA2A.version || '0.3.0';
        existingA2A.type = existingA2A.type || 'a2a';
        existingA2A.name = existingA2A.name || 'A2A';
      } else {
        services.push({
          type: 'a2a',
          name: 'A2A',
          endpoint: a2aEndpoint,
          version: '0.3.0',
        });
      }
    }

    // Drop legacy endpoints.
    delete input.endpoints;
    input.services = services.length > 0 ? services : undefined;
    return input as AgentRegistrationInfo;
  })();

  // Ensure ERC-8004 type is set
  const registrationWithType: AgentRegistrationInfo = {
    ...canonicalRegistration,
    type:
      canonicalRegistration.type ||
      'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    // Set timestamps for legacy fields if not provided
    createdAt: canonicalRegistration.createdAt || new Date().toISOString(),
    updatedAt: canonicalRegistration.updatedAt || new Date().toISOString(),
  };
  
  console.log('[uploadRegistration] registration.supportedTrust:', canonicalRegistration.supportedTrust);
  console.log('[uploadRegistration] registrationWithType.supportedTrust:', registrationWithType.supportedTrust);
  
  // Convert to JSON string
  const jsonString = JSON.stringify(registrationWithType, null, 2);
  
  console.log('[uploadRegistration] JSON string includes supportedTrust:', jsonString.includes('supportedTrust'));
  
  // Upload to IPFS
  const result = await ipfsStorage.upload(jsonString, 'registration.json');
  
  // Return with tokenUri format (ipfs://CID)
  const tokenUri = `ipfs://${result.cid}`;
  
  return {
    cid: result.cid,
    url: result.url,
    tokenUri,
  };
}

/**
 * Retrieve agent registration JSON from IPFS
 * @param cidOrTokenUri - CID, tokenUri (ipfs://CID format), or full gateway URL
 * @param storage - Optional IPFS storage instance (uses singleton if not provided)
 * @returns Registration JSON data
 */
export async function getRegistration(
  cidOrTokenUri: string,
  storage?: IPFSStorage
): Promise<AgentRegistrationInfo> {
  const ipfsStorage = storage || getIPFSStorage();
  
  // Use the new getJson method which handles all URI formats and gateway fallbacks
  const registration = await ipfsStorage.getJson(cidOrTokenUri);
  
  if (!registration) {
    throw new Error(`Failed to retrieve registration from IPFS: ${cidOrTokenUri}`);
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
  active?: boolean;
  description?: string;
  image?: string;
  agentUrl?: string;
  chainId?: number;
  identityRegistry?: `0x${string}`;
  supportedTrust?: string[];
  services?: Array<{
    type?: string;
    name?: string;
    endpoint: string;
    version?: string;
    capabilities?: string[];
    a2aSkills?: string[];
    a2aDomains?: string[];
    mcpTools?: string[];
    mcpPrompts?: string[];
    skills?: string[];
    domains?: string[];
  }>;
  endpoints?: Array<{
    name: string;
    endpoint: string;
    version?: string;
    capabilities?: Record<string, any>;
    a2aSkills?: string[];
    a2aDomains?: string[];
    mcpSkills?: string[];
    mcpDomains?: string[];
    mcpTools?: string[];
    mcpPrompts?: string[];
    skills?: string[];
    domains?: string[];
  }>;
  uaid?: string;
  // Legacy fields
  metadata?: Record<string, string>;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
}): AgentRegistrationInfo {
  // Normalize caller-provided services/endpoints into a single `services` array.
  // New registrations should emit `services` (not `endpoints`).
  const services: Array<{
    type?: string;
    name?: string;
    endpoint: string;
    version?: string;
    capabilities?: string[];
    a2aSkills?: string[];
    a2aDomains?: string[];
    mcpTools?: string[];
    mcpPrompts?: string[];
    skills?: string[];
    domains?: string[];
  }> = [];

  if (Array.isArray(params.services)) {
    for (const s of params.services) {
      const rawType =
        typeof s?.type === 'string'
          ? s.type.trim()
          : typeof (s as any)?.name === 'string'
            ? String((s as any).name).trim()
            : '';
      const endpoint = typeof s?.endpoint === 'string' ? s.endpoint.trim() : '';
      if (!rawType || !endpoint) continue;
      const type = rawType.toLowerCase();
      services.push({
        type,
        name: typeof (s as any)?.name === 'string' && String((s as any).name).trim() ? String((s as any).name).trim() : rawType,
        endpoint,
        version: typeof s.version === 'string' ? s.version : undefined,
        capabilities: Array.isArray(s.capabilities) ? s.capabilities.map((c) => String(c)) : undefined,
        a2aSkills: Array.isArray((s as any).a2aSkills) ? (s as any).a2aSkills.map((v: any) => String(v)).filter(Boolean) : undefined,
        a2aDomains: Array.isArray((s as any).a2aDomains) ? (s as any).a2aDomains.map((v: any) => String(v)).filter(Boolean) : undefined,
        mcpTools: Array.isArray((s as any).mcpTools) ? (s as any).mcpTools.map((v: any) => String(v)).filter(Boolean) : undefined,
        mcpPrompts: Array.isArray((s as any).mcpPrompts) ? (s as any).mcpPrompts.map((v: any) => String(v)).filter(Boolean) : undefined,
        skills: Array.isArray((s as any).skills) ? (s as any).skills.map((v: any) => String(v)).filter(Boolean) : undefined,
        domains: Array.isArray((s as any).domains) ? (s as any).domains.map((v: any) => String(v)).filter(Boolean) : undefined,
      });
    }
  }

  if (Array.isArray(params.endpoints)) {
    for (const e of params.endpoints) {
      const name = typeof e?.name === 'string' ? e.name.trim() : '';
      const endpoint = typeof e?.endpoint === 'string' ? e.endpoint.trim() : '';
      if (!name || !endpoint) continue;
      const type = name.toLowerCase();
      const capsFromRecord =
        e.capabilities && typeof e.capabilities === 'object' && !Array.isArray(e.capabilities)
          ? Object.keys(e.capabilities as Record<string, unknown>)
          : [];
      const caps: string[] = [];
      const addCaps = (arr: unknown): void => {
        if (!Array.isArray(arr)) return;
        for (const item of arr) {
          const v = String(item ?? '').trim();
          if (v) caps.push(v);
        }
      };
      addCaps(e.a2aSkills);
      addCaps(e.mcpSkills);
      addCaps(e.a2aDomains);
      addCaps(e.mcpDomains);
      addCaps(e.mcpTools);
      addCaps(e.mcpPrompts);
      addCaps(e.skills);
      addCaps(e.domains);
      addCaps(capsFromRecord);
      const capabilities: string[] | undefined = caps.length > 0 ? Array.from(new Set(caps)) : undefined;
      services.push({
        type,
        name,
        endpoint,
        version: typeof e.version === 'string' ? e.version : undefined,
        capabilities,
        a2aSkills: Array.isArray(e.a2aSkills) ? e.a2aSkills.map((v: any) => String(v)).filter(Boolean) : undefined,
        a2aDomains: Array.isArray(e.a2aDomains) ? e.a2aDomains.map((v: any) => String(v)).filter(Boolean) : undefined,
        mcpTools: Array.isArray(e.mcpTools) ? e.mcpTools.map((v: any) => String(v)).filter(Boolean) : undefined,
        mcpPrompts: Array.isArray(e.mcpPrompts) ? e.mcpPrompts.map((v: any) => String(v)).filter(Boolean) : undefined,
        skills: Array.isArray(e.skills) ? e.skills.map((v: any) => String(v)).filter(Boolean) : undefined,
        domains: Array.isArray(e.domains) ? e.domains.map((v: any) => String(v)).filter(Boolean) : undefined,
      });
    }
  }
  
  // If agentUrl is provided, automatically create an A2A endpoint
  if (params.agentUrl) {
    const baseUrl = params.agentUrl.replace(/\/$/, ''); // Remove trailing slash
    
    // Upsert A2A endpoint (always align to agentUrl so provider base URLs or other defaults
    // don't accidentally become the registered A2A endpoint).
    // Default to the canonical A2A agent card location (agent-card.json).
    const a2aEndpoint = `${baseUrl}/.well-known/agent-card.json`;
    const existingA2A = services.find((s) => (s.type || '').toLowerCase() === 'a2a' || (s.name || '').toLowerCase() === 'a2a');
    if (existingA2A) {
      if (existingA2A.endpoint !== a2aEndpoint) {
        console.warn('[createRegistrationJSON] Overriding A2A endpoint to match agentUrl:', {
          agentUrl: baseUrl,
          previous: existingA2A.endpoint,
          next: a2aEndpoint,
        });
      }
      existingA2A.endpoint = a2aEndpoint;
      existingA2A.version = existingA2A.version || '0.3.0';
      existingA2A.type = existingA2A.type || 'a2a';
      existingA2A.name = existingA2A.name || 'A2A';
    } else {
      services.push({
        type: 'a2a',
        name: 'A2A',
        endpoint: a2aEndpoint,
        version: '0.3.0',
      });
    }
  }
  
  // Build registrations array.
  // If agentId is known (post-create update), populate it; otherwise leave null.
  const registrations: Array<{
    agentId: string | number | null;
    agentRegistry: string;
    registeredAt: string;
  }> = [];

  const registryAddress =
    params.identityRegistry ??
    (params.chainId ? getChainContractAddress('AGENTIC_TRUST_IDENTITY_REGISTRY', params.chainId) : undefined);

  if (params.chainId && registryAddress) {
    registrations.push({
      agentId: params.agentId ?? null,
      agentRegistry: `eip155:${params.chainId}:${String(registryAddress)}`,
      registeredAt: new Date().toISOString(),
    });
  }
  
  const registration: AgentRegistrationInfo = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: params.name,
    description: params.description,
    agentUrl: params.agentUrl,
    image: params.image,
    active: typeof params.active === 'boolean' ? params.active : true,
    services: services.length > 0 ? services : undefined,
    registrations: registrations.length > 0 ? registrations : undefined,
    agentAccount: params.agentAccount,
    // Registry metadata fields
    registeredBy: 'agentic-trust',
    registryNamespace: 'erc-8004',
    uaid: params.uaid,
    // Legacy fields
    metadata: params.metadata,
    external_url: params.external_url,
    attributes: params.attributes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Explicitly include supportedTrust if it's an array (even if empty)
  // JSON.stringify will omit undefined properties, but will include arrays
  if (Array.isArray(params.supportedTrust)) {
    registration.supportedTrust = params.supportedTrust;
  }

  console.log('[createRegistrationJSON] supportedTrust:', params.supportedTrust);
  console.log('[createRegistrationJSON] registration.supportedTrust:', registration.supportedTrust);

  return registration;
}

