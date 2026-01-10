/**
 * Association Client Singleton
 *
 * Manages a singleton instance of AssociationsStoreClient
 * Initialized from environment variables and domain AccountProvider
 */
import { AIAgentAssociationClient } from '@agentic-trust/8004-ext-sdk';
import { ethers } from 'ethers';
import { requireChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';
import { DomainClient } from './domainClient';
import { resolveDomainUserApps, resolveValidationAccountProvider, // Reuse validation account provider pattern
 } from './domainAccountProviders';
// Associations proxy address - defaults from env or hardcoded
function getAssociationsProxyAddress() {
    const addr = process.env.ASSOCIATIONS_STORE_PROXY ||
        process.env.ASSOCIATIONS_PROXY_ADDRESS ||
        '0xaF7428906D31918dDA2986D1405E2Ded06561E59'; // Default Sepolia deployment
    if (!addr.startsWith('0x') || addr.length !== 42) {
        throw new Error(`Invalid ASSOCIATIONS_STORE_PROXY: ${addr}`);
    }
    // Accept non-checksummed mixed-case env values by normalizing.
    try {
        return ethers.getAddress(addr);
    }
    catch {
        return ethers.getAddress(addr.toLowerCase());
    }
}
class AssociationDomainClient extends DomainClient {
    constructor() {
        super('association');
    }
    async buildClient(targetChainId, initArg) {
        // Get associations proxy address (defaults to Sepolia deployment)
        const associationsProxyAddress = getAssociationsProxyAddress();
        const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);
        // Create AccountProvider for associations (similar to validation)
        const init = (initArg || {});
        const userApps = init.userApps ?? (await resolveDomainUserApps());
        const accountProvider = await resolveValidationAccountProvider(targetChainId, rpcUrl, userApps);
        const associationClient = await AIAgentAssociationClient.create(accountProvider, associationsProxyAddress);
        return associationClient;
    }
}
const associationDomainClient = new AssociationDomainClient();
export async function getAssociationsClient(chainId) {
    const targetChainId = chainId || DEFAULT_CHAIN_ID;
    return associationDomainClient.get(targetChainId);
}
export function isAssociationsClientInitialized(chainId) {
    const targetChainId = chainId || DEFAULT_CHAIN_ID;
    return associationDomainClient.isInitialized(targetChainId);
}
export function resetAssociationsClient(chainId) {
    const targetChainId = chainId || DEFAULT_CHAIN_ID;
    associationDomainClient.reset(targetChainId);
}
//# sourceMappingURL=associationClient.js.map