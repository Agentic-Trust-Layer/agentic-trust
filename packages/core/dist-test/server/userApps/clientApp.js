/**
 * Client App Singleton
 *
 * Manages a singleton instance for client-side operations using private key
 * Provides access to client account, wallet client, and client address
 */
import { ViemAccountProvider } from '@erc8004/sdk';
// Singleton instance
let clientAppInstance = null;
let initializationPromise = null;
/**
 * Get or create the ClientApp singleton
 * Initializes from private key in environment variables
 */
export async function getClientApp() {
    // If already initialized, return immediately
    if (clientAppInstance) {
        return clientAppInstance;
    }
    // If initialization is in progress, wait for it
    if (initializationPromise) {
        return initializationPromise;
    }
    // Start initialization
    initializationPromise = (async () => {
        try {
            const privateKey = process.env.AGENTIC_TRUST_PRIVATE_KEY;
            const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;
            if (!privateKey) {
                throw new Error('Missing required environment variable: AGENTIC_TRUST_PRIVATE_KEY');
            }
            if (!rpcUrl) {
                throw new Error('Missing required environment variable: AGENTIC_TRUST_RPC_URL');
            }
            const { privateKeyToAccount } = await import('viem/accounts');
            const { createPublicClient, createWalletClient, http: httpTransport } = await import('viem');
            const { sepolia } = await import('viem/chains');
            // Normalize private key
            const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
            const account = privateKeyToAccount(normalizedKey);
            const address = account.address;
            // Create public and wallet clients
            const publicClient = createPublicClient({
                chain: sepolia,
                transport: httpTransport(rpcUrl),
            });
            const walletClient = createWalletClient({
                account,
                chain: sepolia,
                transport: httpTransport(rpcUrl),
            });
            // Create AccountProvider
            const accountProvider = new ViemAccountProvider({
                publicClient,
                walletClient,
                account,
                chainConfig: {
                    id: sepolia.id,
                    rpcUrl,
                    name: sepolia.name,
                    chain: sepolia,
                },
            });
            clientAppInstance = {
                account,
                publicClient: publicClient,
                walletClient: walletClient,
                accountProvider,
                address,
            };
            console.log('✅ ClientApp singleton initialized with address:', address);
            return clientAppInstance;
        }
        catch (error) {
            console.error('❌ Failed to initialize ClientApp singleton:', error);
            initializationPromise = null; // Reset on error so it can be retried
            throw error;
        }
    })();
    // Check if this is a client app (environment variable can be 'true', '1', or truthy)
    const isClientApp = process.env.AGENTIC_TRUST_IS_CLIENT_APP === '1' ||
        process.env.AGENTIC_TRUST_IS_CLIENT_APP?.trim() === 'true' ||
        !!process.env.AGENTIC_TRUST_IS_CLIENT_APP;
    if (!isClientApp) {
        return undefined;
    }
    return initializationPromise;
}
/**
 * Get the client address (convenience method)
 */
export async function getClientAddress() {
    const clientApp = await getClientApp();
    return clientApp?.address ?? '0x';
}
/**
 * Check if client app is initialized
 */
export function isClientAppInitialized() {
    return clientAppInstance !== null;
}
/**
 * Reset the singleton (useful for testing)
 */
export function resetClientApp() {
    clientAppInstance = null;
    initializationPromise = null;
}
//# sourceMappingURL=clientApp.js.map