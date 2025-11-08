/**
 * ENS Client Singleton
 *
 * Manages a singleton instance of AIAgentENSClient
 * Initialized from environment variables using AccountProvider
 */
import { AIAgentENSClient } from '@erc8004/agentic-trust-sdk';
import { ViemAccountProvider } from '@erc8004/sdk';
import { sepolia } from 'viem/chains';
import { createPublicClient, http } from 'viem';
import { getAdminApp } from '../userApps/adminApp';
import { getClientApp } from '../userApps/clientApp';
import { getProviderApp } from '../userApps/providerApp';
import { privateKeyToAccount } from 'viem/accounts';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';
import { createBundlerClient } from 'viem/account-abstraction';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
// Singleton instance
let ensClientInstance = null;
let initializationPromise = null;
/**
 * Get or create the AIAgentENSClient singleton
 * Initializes from environment variables using AccountProvider from AdminApp, ClientApp, or ProviderApp
 */
export async function getENSClient() {
    // If already initialized, return immediately
    if (ensClientInstance) {
        return ensClientInstance;
    }
    // If initialization is in progress, wait for it
    if (initializationPromise) {
        return initializationPromise;
    }
    // Start initialization
    initializationPromise = (async () => {
        try {
            // Get RPC URL from environment
            const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL || '';
            // Get ENS registry addresses from environment
            const ensRegistry = (process.env.AGENTIC_TRUST_ENS_REGISTRY || '');
            const ensResolver = (process.env.AGENTIC_TRUST_ENS_RESOLVER || '');
            const identityRegistry = (process.env.AGENTIC_TRUST_IDENTITY_REGISTRY ||
                '0x0000000000000000000000000000000000000000');
            // Try to get AccountProvider from AdminApp, ClientApp, or ProviderApp
            let accountProvider = null;
            // Try AdminApp first (for admin operations)
            const isAdminApp = process.env.AGENTIC_TRUST_IS_ADMIN_APP === 'true' || process.env.AGENTIC_TRUST_IS_ADMIN_APP === '1';
            if (isAdminApp) {
                try {
                    const adminApp = await getAdminApp();
                    if (adminApp?.accountProvider) {
                        accountProvider = adminApp.accountProvider;
                    }
                }
                catch (error) {
                    console.warn('AdminApp not available for ENS client, trying other options...');
                }
            }
            // Try ClientApp if AdminApp didn't work
            if (!accountProvider) {
                const isClientApp = process.env.AGENTIC_TRUST_IS_CLIENT_APP === 'true' || process.env.AGENTIC_TRUST_IS_CLIENT_APP === '1';
                if (isClientApp) {
                    try {
                        const clientApp = await getClientApp();
                        if (clientApp?.accountProvider) {
                            accountProvider = clientApp.accountProvider;
                        }
                    }
                    catch (error) {
                        console.warn('ClientApp not available for ENS client, trying ProviderApp...');
                    }
                }
            }
            // Try ProviderApp if ClientApp didn't work
            if (!accountProvider) {
                const isProviderApp = process.env.AGENTIC_TRUST_IS_PROVIDER_APP === 'true' || process.env.AGENTIC_TRUST_IS_PROVIDER_APP === '1';
                if (isProviderApp) {
                    try {
                        const providerApp = await getProviderApp();
                        if (providerApp?.accountProvider) {
                            accountProvider = providerApp.accountProvider;
                        }
                    }
                    catch (error) {
                        console.warn('ProviderApp not available for ENS client, creating read-only client...');
                    }
                }
            }
            // Fallback: Create a read-only AccountProvider if no app is available
            if (!accountProvider) {
                const publicClient = createPublicClient({
                    chain: sepolia,
                    transport: http(rpcUrl),
                });
                accountProvider = new ViemAccountProvider({
                    publicClient,
                    walletClient: null,
                    account: undefined,
                    chainConfig: {
                        id: sepolia.id,
                        rpcUrl,
                        name: sepolia.name,
                        chain: sepolia,
                    },
                });
            }
            // Create ENS client
            ensClientInstance = new AIAgentENSClient(sepolia, rpcUrl, accountProvider, ensRegistry, ensResolver, identityRegistry);
            return ensClientInstance;
        }
        catch (error) {
            console.error('❌ Failed to initialize ENS client singleton:', error);
            initializationPromise = null; // Reset on error so it can be retried
            throw error;
        }
    })();
    return initializationPromise;
}
/**
 * Check if ENS client is initialized
 */
export function isENSClientInitialized() {
    return ensClientInstance !== null;
}
/**
 * Reset the ENS client instance (useful for testing)
 */
export function resetENSClient() {
    ensClientInstance = null;
    initializationPromise = null;
}
/**
 * Check if an ENS name is available
 *
 * @param agentName - The agent name (e.g., "my-agent")
 * @param orgName - The organization name (e.g., "8004-agent" or "8004-agent.eth")
 * @returns true if the ENS name is available, false if it's taken, null if check failed
 */
export async function isENSAvailable(agentName, orgName) {
    try {
        const ensClient = await getENSClient();
        // Format: agentName.orgName.eth
        const agentNameLabel = agentName.toLowerCase().replace(/\s+/g, '-');
        const orgNameClean = orgName.toLowerCase().replace(/\.eth$/, '');
        const fullName = `${agentNameLabel}.${orgNameClean}.eth`;
        // Check if agent name is available
        const existingAccount = await ensClient.getAgentAccountByName(fullName);
        const isAvailable = !existingAccount || existingAccount === '0x0000000000000000000000000000000000000000';
        return isAvailable;
    }
    catch (error) {
        console.error('Error checking ENS availability:', error);
        return null;
    }
}
export async function sendSponsoredUserOperation(params) {
    const { bundlerUrl, chain, accountClient, calls } = params;
    const pimlicoClient = createPimlicoClient({ transport: http(bundlerUrl) });
    const bundlerClient = createBundlerClient({
        transport: http(bundlerUrl),
        paymaster: true,
        chain: chain,
        paymasterContext: { mode: 'SPONSORED' }
    });
    const { fast: fee } = await pimlicoClient.getUserOperationGasPrice();
    const userOpHash = await bundlerClient.sendUserOperation({
        account: accountClient,
        calls,
        ...fee
    });
    return userOpHash;
}
export async function addAgentNameToOrgUsingEnsKey(params) {
    const { agentName, orgName, agentAddress, agentUrl } = params;
    if (!agentName || !orgName || !agentAddress) {
        throw new Error('agentName, orgName, and agentAddress are required to add an agent name to an org');
    }
    const bundlerUrl = process.env.AGENTIC_TRUST_BUNDLER_URL;
    const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL;
    const ensPrivateKey = process.env.AGENTIC_TRUST_ENS_PRIVATE_KEY;
    if (!bundlerUrl) {
        throw new Error('AGENTIC_TRUST_BUNDLER_URL environment variable is required to add ENS records');
    }
    if (!rpcUrl) {
        throw new Error('AGENTIC_TRUST_RPC_URL environment variable is required to add ENS records');
    }
    if (!ensPrivateKey) {
        throw new Error('AGENTIC_TRUST_ENS_PRIVATE_KEY environment variable is required to add ENS records');
    }
    const ensClient = await getENSClient();
    const agentNameLabel = agentName.toLowerCase().replace(/\s+/g, '-');
    const orgNameClean = orgName.toLowerCase().replace(/\.eth$/, '');
    const fullOrgName = `${orgNameClean}.eth`;
    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
    });
    const orgOwnerEOA = privateKeyToAccount(ensPrivateKey);
    const bundlerClient = createBundlerClient({
        transport: http(bundlerUrl),
        paymaster: true,
        chain: sepolia,
        paymasterContext: { mode: 'SPONSORED' },
    });
    const orgAccountClient = await toMetaMaskSmartAccount({
        address: orgOwnerEOA.address,
        client: publicClient,
        implementation: Implementation.Hybrid,
        signatory: { account: orgOwnerEOA },
    });
    const { calls } = await ensClient.prepareAddAgentNameToOrgCalls({
        orgName: fullOrgName,
        agentName: agentNameLabel,
        agentAddress,
        agentUrl: agentUrl || '',
    });
    const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain: sepolia,
        accountClient: orgAccountClient,
        calls,
    });
    const { receipt } = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return {
        userOpHash,
        receipt,
    };
}
export async function prepareAgentNameInfoCalls(params) {
    const { agentName, orgName, agentAddress, agentUrl, agentDescription } = params;
    if (!agentName || !orgName || !agentAddress) {
        throw new Error('agentName, orgName, and agentAddress are required to prepare ENS agent info calls');
    }
    const ensClient = await getENSClient();
    const orgNameClean = orgName.replace(/\.eth$/i, '').toLowerCase();
    const orgNamePattern = orgNameClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const agentNameTrimmed = agentName
        .replace(new RegExp(`^${orgNamePattern}\\.`, 'i'), '')
        .replace(/\.eth$/i, '')
        .trim();
    const agentNameLabel = agentNameTrimmed.toLowerCase().replace(/\s+/g, '-');
    const { calls } = await ensClient.prepareSetAgentNameInfoCalls({
        orgName: orgNameClean,
        agentName: agentNameLabel,
        agentAddress,
        agentUrl: agentUrl || '',
        agentDescription: agentDescription || '',
    });
    return {
        calls,
    };
}
//# sourceMappingURL=ensClient.js.map