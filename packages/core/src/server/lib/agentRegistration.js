/**
 * ERC-8004 Agent Registration JSON
 *
 * Standard JSON structure for agent registration metadata
 * Stored on IPFS and referenced via Identity Token tokenUri
 */
import { getIPFSStorage } from './ipfs';
import { getChainContractAddress } from './chainConfig';
/**
 * Upload agent registration JSON to IPFS
 * @param registration - Registration JSON data
 * @param storage - Optional IPFS storage instance (uses singleton if not provided)
 * @returns Upload result with CID and URL
 */
export async function uploadRegistration(registration, storage) {
    const ipfsStorage = storage || getIPFSStorage();
    // Ensure ERC-8004 type is set
    const registrationWithType = {
        ...registration,
        type: registration.type || 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        // Set timestamps for legacy fields if not provided
        createdAt: registration.createdAt || new Date().toISOString(),
        updatedAt: registration.updatedAt || new Date().toISOString(),
    };
    console.log('[uploadRegistration] registration.supportedTrust:', registration.supportedTrust);
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
export async function getRegistration(cidOrTokenUri, storage) {
    const ipfsStorage = storage || getIPFSStorage();
    // Use the new getJson method which handles all URI formats and gateway fallbacks
    const registration = await ipfsStorage.getJson(cidOrTokenUri);
    if (!registration) {
        throw new Error(`Failed to retrieve registration from IPFS: ${cidOrTokenUri}`);
    }
    return registration;
}
/**
 * Create registration JSON from agent data
 * Helper function to build ERC-8004 compliant registration JSON
 */
export function createRegistrationJSON(params) {
    const endpoints = (params.endpoints ? params.endpoints.map(e => ({ ...e })) : [])
        // Never include MCP endpoint entries in registration JSON.
        .filter(e => e.name !== 'MCP');
    // If agentUrl is provided, automatically create an A2A endpoint
    if (params.agentUrl) {
        const baseUrl = params.agentUrl.replace(/\/$/, ''); // Remove trailing slash
        // Upsert A2A endpoint (always align to agentUrl so provider base URLs or other defaults
        // don't accidentally become the registered A2A endpoint).
        // Default to the canonical A2A agent card location (agent-card.json).
        const a2aEndpoint = `${baseUrl}/.well-known/agent-card.json`;
        const existingA2A = endpoints.find(e => e.name === 'A2A');
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
            // Preserve a2aSkills if already set
        }
        else {
            endpoints.push({
                name: 'A2A',
                endpoint: a2aEndpoint,
                version: '0.3.0',
            });
        }
    }
    // Build registrations array.
    // If agentId is known (post-create update), populate it; otherwise leave null.
    const registrations = [];
    const registryAddress = params.identityRegistry ??
        (params.chainId ? getChainContractAddress('AGENTIC_TRUST_IDENTITY_REGISTRY', params.chainId) : undefined);
    if (params.chainId && registryAddress) {
        registrations.push({
            agentId: params.agentId ?? null,
            agentRegistry: `eip155:${params.chainId}:${String(registryAddress)}`,
            registeredAt: new Date().toISOString(),
        });
    }
    const registration = {
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: params.name,
        description: params.description,
        image: params.image,
        active: typeof params.active === 'boolean' ? params.active : true,
        endpoints: endpoints.length > 0 ? endpoints : undefined,
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
//# sourceMappingURL=agentRegistration.js.map