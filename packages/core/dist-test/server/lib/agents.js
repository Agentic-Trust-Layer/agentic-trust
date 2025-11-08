/**
 * Agents API for AgenticTrust Client
 */
import { AIAgentIdentityClient, } from '@erc8004/agentic-trust-sdk';
import { ViemAccountProvider, BaseIdentityClient, } from '@erc8004/sdk';
import { Agent } from './agent';
import { getDiscoveryClient } from '../singletons/discoveryClient';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';
import { uploadRegistration, createRegistrationJSON } from './registration';
import { createPublicClient, http } from 'viem';
import { getAdminApp } from '../userApps/adminApp';
import IdentityRegistryABIJson from '@erc8004/agentic-trust-sdk/abis/IdentityRegistry.json';
const identityRegistryAbi = IdentityRegistryABIJson.default ?? IdentityRegistryABIJson;
export class AgentsAPI {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * List all agents
     * Query uses the actual schema fields from the API
     * Returns agents sorted by agentId in descending order
     * Fetches all agents using pagination if needed
     */
    async listAgents() {
        const graphQLClient = await getDiscoveryClient();
        const allAgents = await graphQLClient.listAgents();
        // Sort all agents by agentId in descending order
        const sortedAgents = allAgents.sort((a, b) => {
            // Sort by agentId in descending order (highest first)
            const idA = typeof a.agentId === 'number' ? a.agentId : Number(a.agentId) || 0;
            const idB = typeof b.agentId === 'number' ? b.agentId : Number(b.agentId) || 0;
            return idB - idA;
        });
        // Convert AgentData to Agent instances
        const agentInstances = sortedAgents.map((data) => new Agent(data, this.client));
        return {
            agents: agentInstances,
            total: agentInstances.length,
        };
    }
    /**
     * Get a single agent by ID
     * @param agentId - The agent ID as a string
     * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
     */
    async getAgent(agentId, chainId = 11155111) {
        const graphQLClient = await getDiscoveryClient();
        const agentData = await graphQLClient.getAgent(chainId, agentId);
        if (!agentData) {
            return null;
        }
        return new Agent(agentData, this.client);
    }
    /**
     * Get raw agent data from GraphQL (for internal use)
     * Returns the raw AgentData from the GraphQL indexer
     */
    async getAgentFromGraphQL(chainId, agentId) {
        const graphQLClient = await getDiscoveryClient();
        return await graphQLClient.getAgent(chainId, agentId);
    }
    /**
     * Refresh/Index an agent in the GraphQL indexer
     * Triggers the indexer to re-index the specified agent
     * @param agentId - Agent ID to refresh (required)
     * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
     */
    async refreshAgent(agentId, chainId = 11155111) {
        const graphQLClient = await getDiscoveryClient();
        return await graphQLClient.refreshAgent(agentId, chainId);
    }
    /**
     * Create a new agent
     * Requires AdminApp to be initialized (server-side)
     * @param params - Agent creation parameters
     * @returns Created agent ID and transaction hash, or prepared transaction for client-side signing
     */
    async createAgentForEOA(params) {
        const adminApp = await getAdminApp();
        if (!adminApp) {
            throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and provide either AGENTIC_TRUST_ADMIN_PRIVATE_KEY or connect via wallet');
        }
        const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
        if (!identityRegistry || typeof identityRegistry !== 'string') {
            throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
        }
        const identityRegistryHex = identityRegistry.startsWith('0x')
            ? identityRegistry
            : `0x${identityRegistry}`;
        // Create registration JSON and upload to IPFS
        let tokenURI = '';
        const sepoliaChain = sepolia;
        const chainId = sepoliaChain.id;
        try {
            const registrationJSON = createRegistrationJSON({
                name: params.agentName,
                agentAccount: params.agentAccount,
                description: params.description,
                image: params.image,
                agentUrl: params.agentUrl,
                chainId,
                identityRegistry: identityRegistryHex,
                supportedTrust: params.supportedTrust,
                endpoints: params.endpoints,
            });
            const uploadResult = await uploadRegistration(registrationJSON);
            tokenURI = uploadResult.tokenURI;
        }
        catch (error) {
            console.error('Failed to upload registration JSON to IPFS:', error);
            throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        // If no private key, prepare transaction for client-side signing
        if (!adminApp.hasPrivateKey) {
            // Prepare transaction for client-side signing
            // Build metadata array
            const metadata = [
                { key: 'agentName', value: params.agentName ? String(params.agentName) : '' },
                { key: 'agentAccount', value: params.agentAccount ? String(params.agentAccount) : '' },
            ].filter(m => m.value !== '');
            // Prepare transaction using AIAgentIdentityClient (all Ethereum logic server-side)
            // Get chain by ID
            let chain = sepoliaChain;
            const baseSepoliaChainId = 84532;
            const optimismSepoliaChainId = 11155420;
            if (chainId === baseSepoliaChainId) {
                chain = baseSepolia;
            }
            else if (chainId === optimismSepoliaChainId) {
                chain = optimismSepolia;
            }
            const publicClient = createPublicClient({
                chain: chain,
                transport: http(process.env.AGENTIC_TRUST_RPC_URL || ''),
            });
            const accountProvider = new ViemAccountProvider({
                publicClient: publicClient,
                walletClient: null, // Read-only for transaction preparation
                chainConfig: {
                    id: chainId,
                    rpcUrl: process.env.AGENTIC_TRUST_RPC_URL || '',
                    name: chain.name,
                    chain: chain,
                },
            });
            const aiIdentityClient = new AIAgentIdentityClient({
                accountProvider,
                identityRegistryAddress: identityRegistryHex,
            });
            // Prepare complete transaction (encoding, gas estimation, nonce, etc.)
            // AIAgentIdentityClient handles all Ethereum logic internally using its publicClient
            const transaction = await aiIdentityClient.prepareRegisterTransaction(tokenURI, metadata, adminApp.address // Only address needed - no publicClient passed
            );
            return {
                requiresClientSigning: true,
                transaction,
                tokenURI,
                metadata: metadata.map(m => ({ key: m.key, value: m.value })),
            };
        }
        // Check wallet balance before attempting transaction
        try {
            const balance = await adminApp.publicClient.getBalance({ address: adminApp.address });
            if (balance === 0n) {
                throw new Error(`Wallet ${adminApp.address} has zero balance. Please fund the wallet with Sepolia ETH to pay for gas.`);
            }
            console.log(`Wallet balance: ${balance.toString()} wei (${(Number(balance) / 1e18).toFixed(6)} ETH)`);
        }
        catch (balanceError) {
            if (balanceError.message.includes('zero balance')) {
                throw balanceError;
            }
            console.warn('Could not check wallet balance:', balanceError.message);
        }
        // Create write-capable IdentityClient using AdminApp AccountProvider
        const identityClient = new BaseIdentityClient(adminApp.accountProvider, identityRegistryHex);
        // Build metadata array
        // For agentAccount (address), we need to pass it as-is since it's already a hex string
        // IdentityClient.stringToBytes will encode strings as UTF-8, which is fine for agentName
        // but agentAccount should be treated as an address string (which will be encoded as UTF-8)
        // Note: The contract expects bytes, and encoding the address string as UTF-8 is acceptable
        // as long as it's consistently decoded on read
        const metadata = [
            { key: 'agentName', value: params.agentName ? String(params.agentName) : '' },
            { key: 'agentAccount', value: params.agentAccount ? String(params.agentAccount) : '' },
        ].filter(m => m.value !== ''); // Remove empty values
        // Use direct EOA transaction path (existing behavior)
        const result = await identityClient.registerWithMetadata(tokenURI, metadata);
        // Refresh the agent in the GraphQL indexer
        try {
            const graphQLClient = await getDiscoveryClient();
            // Use the same chainId that was used for registration
            await graphQLClient.refreshAgent(result.agentId.toString(), chainId);
            console.log(`✅ Refreshed agent ${result.agentId} in GraphQL indexer`);
        }
        catch (refreshError) {
            // Log error but don't fail agent creation if refresh fails
            console.warn(`⚠️ Failed to refresh agent ${result.agentId} in GraphQL indexer:`, refreshError);
        }
        return result;
    }
    async createAgentForAA(params) {
        const adminApp = await getAdminApp();
        if (!adminApp) {
            throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and provide either AGENTIC_TRUST_ADMIN_PRIVATE_KEY or connect via wallet');
        }
        const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
        if (!identityRegistry || typeof identityRegistry !== 'string') {
            throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
        }
        const identityRegistryHex = identityRegistry.startsWith('0x')
            ? identityRegistry
            : `0x${identityRegistry}`;
        // Create registration JSON and upload to IPFS
        let tokenURI = '';
        const sepoliaChain = sepolia;
        const chainId = sepoliaChain.id;
        try {
            const registrationJSON = createRegistrationJSON({
                name: params.agentName,
                agentAccount: params.agentAccount,
                description: params.description,
                image: params.image,
                agentUrl: params.agentUrl,
                chainId,
                identityRegistry: identityRegistryHex,
                supportedTrust: params.supportedTrust,
                endpoints: params.endpoints,
            });
            const uploadResult = await uploadRegistration(registrationJSON);
            tokenURI = uploadResult.tokenURI;
        }
        catch (error) {
            console.error('Failed to upload registration JSON to IPFS:', error);
            throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        const publicClient = createPublicClient({
            chain: sepolia,
            transport: http(process.env.AGENTIC_TRUST_RPC_URL || ''),
        });
        const accountProvider = new ViemAccountProvider({
            publicClient: publicClient,
            walletClient: null,
            chainConfig: {
                id: chainId,
                rpcUrl: process.env.AGENTIC_TRUST_RPC_URL || '',
                name: sepolia.name,
                chain: sepolia,
            },
        });
        const aiIdentityClient = new AIAgentIdentityClient({
            accountProvider,
            identityRegistryAddress: identityRegistryHex,
        });
        const { calls: registerCalls } = await aiIdentityClient.prepareRegisterCalls(params.agentName, params.agentAccount, tokenURI);
        const bundlerUrl = process.env.AGENTIC_TRUST_BUNDLER_URL || '';
        return {
            success: true,
            bundlerUrl,
            tokenURI,
            chainId,
            calls: registerCalls,
        };
    }
    async extractAgentIdFromReceipt(receipt, chainId = 11155111) {
        if (!receipt) {
            return null;
        }
        const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
        if (!identityRegistry || typeof identityRegistry !== 'string') {
            throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
        }
        const identityRegistryHex = identityRegistry.startsWith('0x')
            ? identityRegistry
            : `0x${identityRegistry}`;
        let chain = sepolia;
        if (chainId === baseSepolia.id) {
            chain = baseSepolia;
        }
        else if (chainId === optimismSepolia.id) {
            chain = optimismSepolia;
        }
        const aiIdentityClient = new AIAgentIdentityClient({
            accountProvider: {
                chainId: async () => chain.id,
            },
            identityRegistryAddress: identityRegistryHex,
        });
        try {
            const agentId = aiIdentityClient.extractAgentIdFromReceiptPublic(receipt);
            return agentId ? agentId.toString() : null;
        }
        catch (error) {
            console.warn('extractAgentIdFromReceipt failed:', error);
            return null;
        }
    }
    /**
     * Search agents by name
     * @param query - Search query string to match against agent names
     * Fetches all matching agents using pagination if needed
     */
    async searchAgents(query) {
        const graphQLClient = await getDiscoveryClient();
        const allAgents = await graphQLClient.searchAgents(query);
        // Sort all agents by agentId in descending order
        const sortedAgents = allAgents.sort((a, b) => {
            // Sort by agentId in descending order (highest first)
            const idA = typeof a.agentId === 'number' ? a.agentId : Number(a.agentId) || 0;
            const idB = typeof b.agentId === 'number' ? b.agentId : Number(b.agentId) || 0;
            return idB - idA;
        });
        // Debug: Log the response data
        if (typeof window !== 'undefined') {
            console.log('[searchAgents] total matching agents:', sortedAgents.length);
        }
        // Convert AgentData to Agent instances
        const agentInstances = sortedAgents.map((data) => new Agent(data, this.client));
        return {
            agents: agentInstances,
            total: agentInstances.length,
        };
    }
    /**
     * Admin API for agent management
     * These methods require AdminApp to be initialized
     * Note: createAgent is now available directly on agents (not agents.admin)
     */
    admin = {
        /**
         * Prepare a create agent transaction for client-side signing
         * Returns transaction data that can be signed and submitted by the client
         */
        prepareCreateAgentTransaction: async (params) => {
            const adminApp = await getAdminApp();
            if (!adminApp) {
                throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and connect via wallet');
            }
            if (adminApp.hasPrivateKey) {
                throw new Error('prepareCreateAgentTransaction should only be used when no private key is available');
            }
            const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
            if (!identityRegistry || typeof identityRegistry !== 'string') {
                throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
            }
            const identityRegistryHex = identityRegistry.startsWith('0x')
                ? identityRegistry
                : `0x${identityRegistry}`;
            // Create read-only IdentityClient using AdminApp's AccountProvider
            const identityClient = new BaseIdentityClient(adminApp.accountProvider, identityRegistryHex);
            // Build metadata array
            const metadata = [
                { key: 'agentName', value: params.agentName ? String(params.agentName) : '' },
                { key: 'agentAccount', value: params.agentAccount ? String(params.agentAccount) : '' },
            ].filter(m => m.value !== '');
            // Create registration JSON and upload to IPFS
            let tokenURI = '';
            const chainId = sepolia.id;
            try {
                const registrationJSON = createRegistrationJSON({
                    name: params.agentName,
                    agentAccount: params.agentAccount,
                    description: params.description,
                    image: params.image,
                    agentUrl: params.agentUrl,
                    chainId,
                    identityRegistry: identityRegistryHex,
                    supportedTrust: params.supportedTrust,
                    endpoints: params.endpoints,
                });
                const uploadResult = await uploadRegistration(registrationJSON);
                tokenURI = uploadResult.tokenURI;
            }
            catch (error) {
                console.error('Failed to upload registration JSON to IPFS:', error);
                throw new Error(`Failed to create registration JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            // Encode the transaction data
            const aiIdentityClient = new AIAgentIdentityClient({
                chainId,
                rpcUrl: process.env.AGENTIC_TRUST_RPC_URL || '',
                identityRegistryAddress: identityRegistryHex,
            });
            // Encode registerWithMetadata function call
            const encodedData = await aiIdentityClient.encodeRegisterWithMetadata(tokenURI, metadata);
            // Simulate transaction to get gas estimates
            let gasEstimate;
            let gasPrice;
            let maxFeePerGas;
            let maxPriorityFeePerGas;
            let nonce;
            try {
                // Get current gas prices
                const [gasPriceData, blockData] = await Promise.all([
                    adminApp.publicClient.getGasPrice(),
                    adminApp.publicClient.getBlock({ blockTag: 'latest' }),
                ]);
                gasPrice = gasPriceData;
                // Try EIP-1559 gas prices if available
                if (blockData && 'baseFeePerGas' in blockData && blockData.baseFeePerGas) {
                    maxFeePerGas = (blockData.baseFeePerGas * 2n) / 10n; // 2x base fee
                    maxPriorityFeePerGas = blockData.baseFeePerGas / 10n; // 10% of base fee
                }
                // Estimate gas
                gasEstimate = await adminApp.publicClient.estimateGas({
                    account: adminApp.address,
                    to: identityRegistryHex,
                    data: encodedData,
                });
                // Get nonce
                nonce = await adminApp.publicClient.getTransactionCount({
                    address: adminApp.address,
                    blockTag: 'pending',
                });
            }
            catch (error) {
                console.warn('Could not estimate gas or get transaction parameters:', error);
                // Continue without gas estimates - client can estimate
            }
            return {
                requiresClientSigning: true,
                transaction: {
                    to: identityRegistryHex,
                    data: encodedData,
                    value: '0',
                    gas: gasEstimate ? gasEstimate.toString() : undefined,
                    gasPrice: gasPrice ? gasPrice.toString() : undefined,
                    maxFeePerGas: maxFeePerGas ? maxFeePerGas.toString() : undefined,
                    maxPriorityFeePerGas: maxPriorityFeePerGas ? maxPriorityFeePerGas.toString() : undefined,
                    nonce,
                    chainId,
                },
                tokenURI,
                metadata: metadata.map(m => ({ key: m.key, value: m.value })),
            };
        },
        /**
         * Update an agent's token URI
         * @param agentId - The agent ID to update
         * @param tokenURI - New token URI
         * @returns Transaction hash
         */
        updateAgent: async (params) => {
            const adminApp = await getAdminApp();
            if (!adminApp) {
                throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
            }
            const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
            if (!identityRegistry) {
                throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
            }
            // Create write-capable IdentityClient using AdminApp AccountProvider
            const identityClient = new BaseIdentityClient(adminApp.accountProvider, identityRegistry);
            const agentId = BigInt(params.agentId);
            const results = [];
            // Update token URI if provided
            if (params.tokenURI !== undefined) {
                const uriResult = await identityClient.setAgentUri(agentId, params.tokenURI);
                results.push(uriResult);
            }
            // Update metadata if provided
            if (params.metadata && params.metadata.length > 0) {
                for (const entry of params.metadata) {
                    const metadataResult = await identityClient.setMetadata(agentId, entry.key, entry.value);
                    results.push(metadataResult);
                }
            }
            if (results.length === 0) {
                throw new Error('No updates provided. Specify tokenURI and/or metadata.');
            }
            // Return the last transaction hash (most recent update)
            const lastResult = results[results.length - 1];
            if (!lastResult) {
                throw new Error('Failed to get transaction hash from update operation');
            }
            return { txHash: lastResult.txHash };
        },
        /**
         * Delete an agent by transferring it to the zero address (burn)
         * Note: This requires the contract to support transfers to address(0)
         * @param agentId - The agent ID to delete
         * @returns Transaction hash
         */
        deleteAgent: async (params) => {
            const adminApp = await getAdminApp();
            if (!adminApp) {
                throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
            }
            const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
            if (!identityRegistry) {
                throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
            }
            // Import IdentityRegistry ABI for transferFrom
            const IdentityRegistryABI = identityRegistryAbi;
            const agentId = BigInt(params.agentId);
            const from = adminApp.address;
            const to = '0x0000000000000000000000000000000000000000';
            // Transfer to zero address (burn)
            const data = await adminApp.accountProvider.encodeFunctionData({
                abi: IdentityRegistryABI,
                functionName: 'transferFrom',
                args: [from, to, agentId],
            });
            const result = await adminApp.accountProvider.send({
                to: identityRegistry,
                data,
                value: 0n,
            });
            return { txHash: result.hash };
        },
        /**
         * Transfer an agent to a new owner
         * @param agentId - The agent ID to transfer
         * @param to - The new owner address
         * @returns Transaction hash
         */
        transferAgent: async (params) => {
            const adminApp = await getAdminApp();
            if (!adminApp) {
                throw new Error('AdminApp not initialized. Set AGENTIC_TRUST_IS_ADMIN_APP=true and AGENTIC_TRUST_ADMIN_PRIVATE_KEY');
            }
            const identityRegistry = process.env.AGENTIC_TRUST_IDENTITY_REGISTRY;
            if (!identityRegistry) {
                throw new Error('Missing required environment variable: AGENTIC_TRUST_IDENTITY_REGISTRY');
            }
            // Import IdentityRegistry ABI for transferFrom
            const IdentityRegistryABI = identityRegistryAbi;
            const agentId = BigInt(params.agentId);
            const from = adminApp.address;
            // Transfer to new owner
            const data = await adminApp.accountProvider.encodeFunctionData({
                abi: IdentityRegistryABI,
                functionName: 'transferFrom',
                args: [from, params.to, agentId],
            });
            const result = await adminApp.accountProvider.send({
                to: identityRegistry,
                data,
                value: 0n,
            });
            return { txHash: result.hash };
        },
    };
}
//# sourceMappingURL=agents.js.map