/**
 * Reputation Client Singleton
 *
 * Manages a singleton instance of AIAgentReputationClient
 * Initialized from session package or environment variables
 */
import { AIAgentReputationClient } from '@erc8004/agentic-trust-sdk';
import { ViemAccountProvider } from '@erc8004/sdk';
import { getClientApp } from '../userApps/clientApp';
import { getProviderApp } from '../userApps/providerApp';
import { getAdminApp } from '../userApps/adminApp';
// Singleton instance
let reputationClientInstance = null;
let initializationPromise = null;
/**
 * Get or create the AIAgentReputationClient singleton
 * Initializes from session package if available, otherwise uses environment variables
 */
export async function getReputationClient() {
    // If already initialized, return immediately
    if (reputationClientInstance) {
        return reputationClientInstance;
    }
    // If initialization is in progress, wait for it
    if (initializationPromise) {
        return initializationPromise;
    }
    // Start initialization
    initializationPromise = (async () => {
        try {
            const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
            const reputationRegistry = process.env.AGENTIC_TRUST_REPUTATION_REGISTRY;
            const ensRegistry = process.env.AGENTIC_TRUST_ENS_REGISTRY;
            const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;
            if (!identityRegistry || !reputationRegistry) {
                throw new Error('Missing required environment variables: AGENTIC_TRUST_IDENTITY_REGISTRY and AGENTIC_TRUST_REPUTATION_REGISTRY');
            }
            if (!rpcUrl) {
                throw new Error('Missing required environment variable: AGENTIC_TRUST_RPC_URL');
            }
            // Determine if this is a client app, provider app, or admin app
            const isClientApp = process.env.AGENTIC_TRUST_IS_CLIENT_APP === '1' ||
                process.env.AGENTIC_TRUST_IS_CLIENT_APP?.trim() === 'true';
            const isProviderApp = process.env.AGENTIC_TRUST_IS_PROVIDER_APP === '1' ||
                process.env.AGENTIC_TRUST_IS_PROVIDER_APP?.trim() === 'true';
            const isAdminApp = process.env.AGENTIC_TRUST_IS_ADMIN_APP === '1' ||
                process.env.AGENTIC_TRUST_IS_ADMIN_APP?.trim() === 'true';
            let agentAccountProvider;
            let clientAccountProvider;
            if (isAdminApp) {
                // Admin app: use AdminApp AccountProvider (supports wallet providers and private key)
                const adminApp = await getAdminApp();
                if (adminApp && adminApp.accountProvider) {
                    agentAccountProvider = adminApp.accountProvider;
                    clientAccountProvider = adminApp.accountProvider; // For admin, agent and client are the same
                }
                else {
                    throw new Error('AdminApp not initialized. Connect wallet or set AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
                }
            }
            else if (isProviderApp) {
                // Provider app: use ProviderApp for agent, try ClientApp for client, or create from session package
                const providerApp = await getProviderApp();
                if (providerApp) {
                    agentAccountProvider = providerApp.accountProvider;
                    // Try to get ClientApp for client operations
                    try {
                        const { getClientApp } = await import('../userApps/clientApp');
                        const clientApp = await getClientApp();
                        if (clientApp && clientApp.accountProvider) {
                            clientAccountProvider = clientApp.accountProvider;
                        }
                    }
                    catch (error) {
                        // ClientApp not available, create read-only clientAccountProvider from session package
                        // The client is the session key owner (EOA that controls the smart account)
                        const sessionKeyAddress = providerApp.sessionPackage.sessionKey.address;
                        const { createPublicClient, http } = await import('viem');
                        const { sepolia } = await import('viem/chains');
                        const clientPublicClient = createPublicClient({
                            chain: sepolia,
                            transport: http(rpcUrl),
                        });
                        // Create read-only AccountProvider for client (no wallet client, no signing)
                        // For provider apps, client operations that require signing should be handled differently
                        clientAccountProvider = new ViemAccountProvider({
                            publicClient: clientPublicClient,
                            walletClient: null,
                            account: sessionKeyAddress, // Use address as account for read-only operations
                            chainConfig: {
                                id: sepolia.id,
                                rpcUrl,
                                name: sepolia.name,
                                chain: sepolia,
                            },
                        });
                    }
                }
            }
            else if (isClientApp) {
                // Client app: use ClientApp for both agent and client (same account)
                const clientApp = await getClientApp();
                if (clientApp) {
                    clientAccountProvider = clientApp.accountProvider;
                    // Create AccountProvider for agent (same as client)
                    agentAccountProvider = new ViemAccountProvider({
                        publicClient: clientApp.publicClient,
                        walletClient: clientApp.walletClient,
                        account: clientApp.account,
                        chainConfig: {
                            id: clientApp.publicClient.chain?.id || 11155111,
                            rpcUrl: clientApp.publicClient.transport?.url || '',
                            name: clientApp.publicClient.chain?.name || 'Unknown',
                            chain: clientApp.publicClient.chain || undefined,
                        },
                    });
                }
            }
            else {
                throw new Error('Cannot initialize reputation client: Set AGENTIC_TRUST_IS_CLIENT_APP, AGENTIC_TRUST_IS_PROVIDER_APP, or AGENTIC_TRUST_IS_ADMIN_APP to true/1');
            }
            if (!agentAccountProvider || !clientAccountProvider) {
                throw new Error('Failed to initialize AccountProviders for reputation client');
            }
            reputationClientInstance = await AIAgentReputationClient.create(agentAccountProvider, clientAccountProvider, identityRegistry, reputationRegistry, (ensRegistry || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') // Default ENS registry on Sepolia
            );
            return reputationClientInstance;
        }
        catch (error) {
            console.error('❌ Failed to initialize reputation client singleton:', error);
            initializationPromise = null; // Reset on error so it can be retried
            throw error;
        }
    })();
    return initializationPromise;
}
/**
 * Check if reputation client is initialized
 */
export function isReputationClientInitialized() {
    return reputationClientInstance !== null;
}
/**
 * Reset the singleton (useful for testing)
 */
export function resetReputationClient() {
    reputationClientInstance = null;
    initializationPromise = null;
}
//# sourceMappingURL=reputationClient.js.map