/**
 * Client-side wallet signing utilities
 *
 * Handles MetaMask/EIP-1193 wallet integration for signing and sending transactions
 * All Ethereum logic is handled server-side, client only needs to sign and send
 */
import { createWalletClient, custom, createPublicClient, } from 'viem';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';
import { getDeployedAccountClientByAgentName } from './aaClient';
import { sendSponsoredUserOperation, waitForUserOperationReceipt, } from './bundlerUtils';
import { env } from 'process';
/**
 * Sign and send a transaction using MetaMask/EIP-1193 wallet
 *
 * @param options - Signing options including transaction, account, chain, and provider
 * @returns Transaction hash, receipt, and optionally extracted agentId
 */
export async function signAndSendTransaction(options) {
    const { transaction, account, chain, ethereumProvider, onStatusUpdate, extractAgentId = false, } = options;
    // Get wallet provider
    const provider = ethereumProvider || (typeof window !== 'undefined' ? window.ethereum : null);
    if (!provider) {
        throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
    }
    // Update status
    onStatusUpdate?.('Connecting to wallet...');
    // Create wallet client
    const walletClient = createWalletClient({
        account,
        chain,
        transport: custom(provider),
    });
    // Update status
    onStatusUpdate?.('Transaction prepared. Please confirm in your wallet...');
    // Convert hex strings to bigint for Viem (Viem accepts both, but TypeScript is strict)
    const txParams = {
        ...transaction,
        value: BigInt(transaction.value),
    };
    if (transaction.gas) {
        txParams.gas = BigInt(transaction.gas);
    }
    if (transaction.gasPrice) {
        txParams.gasPrice = BigInt(transaction.gasPrice);
    }
    if (transaction.maxFeePerGas) {
        txParams.maxFeePerGas = BigInt(transaction.maxFeePerGas);
    }
    if (transaction.maxPriorityFeePerGas) {
        txParams.maxPriorityFeePerGas = BigInt(transaction.maxPriorityFeePerGas);
    }
    // Sign and send transaction
    const hash = await walletClient.sendTransaction(txParams);
    // Update status
    onStatusUpdate?.(`Transaction submitted! Hash: ${hash}. Waiting for confirmation...`);
    // Wait for transaction receipt
    const publicClient = createPublicClient({
        chain,
        transport: custom(ethereumProvider),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    // Extract agentId if requested (for agent creation transactions)
    let agentId;
    if (receipt && Array.isArray(receipt.logs)) {
        const zeroTopic = '0x0000000000000000000000000000000000000000000000000000000000000000';
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const mintLog = receipt.logs.find((log) => log?.topics?.[0] === transferTopic &&
            (log?.topics?.[1] === zeroTopic || log?.topics?.[1] === undefined));
        if (mintLog) {
            const tokenTopic = mintLog.topics?.[3];
            const tokenData = mintLog.data;
            const tokenHex = tokenTopic ?? tokenData;
            if (tokenHex) {
                try {
                    agentId = BigInt(tokenHex).toString();
                }
                catch (error) {
                    console.warn('Unable to parse agentId from mint log:', error);
                }
            }
        }
    }
    if (extractAgentId) {
        try {
            agentId = extractAgentIdFromReceipt(receipt);
        }
        catch (error) {
            console.warn('Could not extract agentId from receipt:', error);
        }
    }
    return {
        hash,
        receipt,
        agentId,
    };
}
/**
 * Extract agentId from a transaction receipt (for agent creation)
 * Looks for ERC-721 Transfer event from zero address
 *
 * @param receipt - Transaction receipt
 * @returns Extracted agentId as string, or undefined if not found
 */
export function extractAgentIdFromReceipt(receipt) {
    try {
        // ERC-721 Transfer event signature
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        // Zero address topic (from address)
        const zeroAddress = '0x0000000000000000000000000000000000000000000000000000000000000000';
        if (!receipt.logs || !Array.isArray(receipt.logs)) {
            return undefined;
        }
        for (const log of receipt.logs) {
            if (log.topics && log.topics[0] === transferTopic && log.topics[1] === zeroAddress) {
                // Extract tokenId (agentId) from topics[3]
                if (log.topics[3]) {
                    return BigInt(log.topics[3]).toString();
                }
            }
        }
        return undefined;
    }
    catch (error) {
        console.warn('Error extracting agentId from receipt:', error);
        return undefined;
    }
}
/**
 * Refresh agent in GraphQL indexer
 *
 * @param agentId - Agent ID to refresh
 * @param refreshEndpoint - Optional custom refresh endpoint (defaults to `/api/agents/${agentId}/refresh`)
 * @returns Promise that resolves when refresh is complete
 */
export async function refreshAgentInIndexer(agentId, refreshEndpoint) {
    const endpoint = refreshEndpoint || `/api/agents/${agentId}/refresh`;
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}), // Send empty body to avoid JSON parsing errors
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.warn(`Failed to refresh agent ${agentId} in GraphQL indexer: ${response.status} ${response.statusText}`, errorText);
            return;
        }
        // Try to parse response, but don't fail if it's empty
        try {
            const data = await response.json();
            console.log(`✅ Refreshed agent ${agentId} in GraphQL indexer`, data);
        }
        catch (parseError) {
            // Response might be empty, that's okay
            console.log(`✅ Refreshed agent ${agentId} in GraphQL indexer`);
        }
    }
    catch (error) {
        console.warn(`Error refreshing agent ${agentId} in GraphQL indexer:`, error);
    }
}
/**
 * Check if wallet provider is available
 *
 * @param ethereumProvider - Optional provider (defaults to window.ethereum)
 * @returns true if provider is available
 */
export function isWalletProviderAvailable(ethereumProvider) {
    if (ethereumProvider) {
        return true;
    }
    if (typeof window === 'undefined') {
        return false;
    }
    return !!window.ethereum;
}
/**
 * Get the connected wallet address from provider
 *
 * @param ethereumProvider - Optional provider (defaults to window.ethereum)
 * @returns Connected wallet address, or null if not connected
 */
export async function getWalletAddress(ethereumProvider) {
    const provider = ethereumProvider || (typeof window !== 'undefined' ? window.ethereum : null);
    if (!provider) {
        return null;
    }
    try {
        const accounts = await provider.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
            return accounts[0];
        }
        return null;
    }
    catch (error) {
        console.warn('Error getting wallet address:', error);
        return null;
    }
}
/**
 * Create an agent with automatic wallet signing if needed
 *
 * This method handles the entire flow:
 * 1. Calls the API to create agent (endpoint: /api/agents/create-for-eoa)
 * 2. If client-side signing is required, signs and sends transaction
 * 3. Waits for receipt and extracts agentId
 * 4. Refreshes GraphQL indexer
 *
 * Only agentData is required - account, chain, and provider are auto-detected
 *
 * @param options - Creation options (only agentData required)
 * @returns Agent creation result
 */
export async function createAgentWithWalletForEOA(options) {
    const { agentData, account: providedAccount, ethereumProvider: providedProvider, rpcUrl: providedRpcUrl, onStatusUpdate, } = options;
    // Get wallet provider (default to window.ethereum)
    const ethereumProvider = providedProvider || (typeof window !== 'undefined' ? window.ethereum : null);
    if (!ethereumProvider) {
        throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
    }
    // Get account from provider if not provided
    let account;
    if (providedAccount) {
        account = providedAccount;
    }
    else {
        const accounts = await ethereumProvider.request({ method: 'eth_accounts' });
        if (!accounts || accounts.length === 0) {
            throw new Error('Wallet not connected. Please connect your wallet first.');
        }
        account = accounts[0];
    }
    // Step 1: Call API to create agent
    onStatusUpdate?.('Creating agent...');
    // Prepare request body with AA parameters if needed
    const requestBody = {
        ...agentData,
    };
    const response = await fetch('/api/agents/create-for-eoa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to create agent');
    }
    const data = await response.json();
    // Step 2: Check if client-side signing is required (regular EOA transaction)
    if (data.requiresClientSigning && data.transaction) {
        // Get chain from transaction chainId
        const chainId = data.transaction.chainId;
        let chain;
        // Map chainId to chain
        switch (chainId) {
            case 11155111: // ETH Sepolia
                chain = sepolia;
                break;
            case 84532: // Base Sepolia
                chain = baseSepolia;
                break;
            case 11155420: // Optimism Sepolia
                chain = optimismSepolia;
                break;
            default:
                // Fallback to sepolia if chain not found
                chain = sepolia;
                console.warn(`Unknown chainId ${chainId}, defaulting to Sepolia`);
        }
        // Sign and send transaction
        const result = await signAndSendTransaction({
            transaction: data.transaction,
            account,
            chain,
            ethereumProvider,
            onStatusUpdate,
            extractAgentId: true, // Extract agentId for agent creation
        });
        // Step 3: Refresh GraphQL indexer if agentId was extracted
        if (result.agentId) {
            await refreshAgentInIndexer(result.agentId);
        }
        return {
            agentId: result.agentId,
            txHash: result.hash,
            requiresClientSigning: true,
        };
    }
    else {
        // Server-side signed transaction
        // Ensure we have the required fields
        if (!data.agentId || !data.txHash) {
            throw new Error(`Invalid response from create agent API. Expected agentId and txHash, got: ${JSON.stringify(data)}`);
        }
        const agentIdStr = data.agentId.toString();
        // Refresh GraphQL indexer for server-side signed transactions too
        if (agentIdStr) {
            try {
                await refreshAgentInIndexer(agentIdStr);
            }
            catch (error) {
                // Don't fail the whole operation if refresh fails
                console.warn('Failed to refresh agent in indexer:', error);
            }
        }
        return {
            agentId: agentIdStr,
            txHash: data.txHash,
            requiresClientSigning: false,
        };
    }
}
export async function createAgentWithWalletForAA(options) {
    const { agentData, account: providedAccount, ethereumProvider: providedProvider, rpcUrl: providedRpcUrl, onStatusUpdate, } = options;
    // Get wallet provider (default to window.ethereum)
    const ethereumProvider = providedProvider || (typeof window !== 'undefined' ? window.ethereum : null);
    if (!ethereumProvider) {
        throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
    }
    // Get account from provider if not provided
    let account;
    if (providedAccount) {
        account = providedAccount;
    }
    else {
        const accounts = await ethereumProvider.request({ method: 'eth_accounts' });
        if (!accounts || accounts.length === 0) {
            throw new Error('Wallet not connected. Please connect your wallet first.');
        }
        account = accounts[0];
    }
    const chainId = ethereumProvider.chainId;
    // Step 1: Call API to create agent
    onStatusUpdate?.('Creating agent...');
    // 0.  Get on the correct chain get adapter for the chain
    let chain;
    switch (chainId) {
        case 11155111: // ETH Sepolia
            chain = sepolia;
            break;
        case 84532: // Base Sepolia
            chain = baseSepolia;
            break;
        case 11155420: // Optimism Sepolia
            chain = optimismSepolia;
            break;
        default:
            chain = sepolia;
            console.warn(`Unknown chainId ${chainId}, defaulting to Sepolia`);
    }
    // 1.  Need to create the Agent Account Abstraction (Account)
    // Build AA account client using client's EOA (MetaMask/Web3Auth)
    // Get agent name from request
    const agentName = options.agentData.agentName;
    // Get Account Client by Agent Name, find if exists and if not the create it
    console.log('Getting deployed account client by agent name: ', agentName);
    const bundlerUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL;
    const agentAccountClient = await getDeployedAccountClientByAgentName(bundlerUrl, agentName, account, {
        chain: chain,
        rpcUrl: undefined,
        ethereumProvider,
        includeDeployParams: true,
        
    });
    if (!agentAccountClient) {
        throw new Error('Failed to build AA account client');
    }
    // Verify the address matches
    const computedAddress = await agentAccountClient.getAddress();
    if (computedAddress.toLowerCase() !== options.agentData.agentAccount.toLowerCase()) {
        throw new Error(`AA address mismatch: computed ${computedAddress}, expected ${options.agentData.agentAccount}`);
    }
    // 2.  Need to create the Agent Identity (NFT)
    // Prepare request body with AA parameters if needed
    const requestBody = {
        account: computedAddress,
        ...agentData,
    };
    const response = await fetch('/api/agents/create-for-aa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to create agent');
    }
    const data = await response.json();
    if (!Array.isArray(data.calls) || data.calls.length === 0) {
        throw new Error('Agent creation response missing register calls');
    }

    /*
      await deploySmartAccountIfNeeded({
        bundlerUrl,
        chain: chain as any,
        account: agentAccountClient,
      });
    */
    // Construct Agent Identity with agentAccount Client
    const createAgentIdentityCalls = data.calls.map((call) => ({
        to: call.to,
        data: call.data,
        value: BigInt(call.value || '0'),
    }));
    // Send UserOperation via bundler
    onStatusUpdate?.('Sending UserOperation via bundler...');
    const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain: chain,
        accountClient: agentAccountClient,
        calls: createAgentIdentityCalls,
    });
    onStatusUpdate?.(`UserOperation sent! Hash: ${userOpHash}. Waiting for confirmation...`);
    // Wait for receipt
    const receipt = await waitForUserOperationReceipt({
        bundlerUrl,
        chain: chain,
        hash: userOpHash,
    });
    // Extract agentId from receipt logs
    let agentId;
    try {
        const extractResponse = await fetch('/api/agents/extract-agent-id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                receipt: JSON.parse(JSON.stringify(receipt, (_, value) => (typeof value === 'bigint' ? value.toString() : value))),
                chainId: chain.id,
            }),
        });
        if (extractResponse.ok) {
            const extractData = await extractResponse.json();
            if (extractData?.agentId) {
                agentId = extractData.agentId;
            }
        }
        else {
            const errorPayload = await extractResponse.json().catch(() => ({}));
            console.warn('Failed to extract agentId via API:', errorPayload);
        }
    }
    catch (error) {
        console.warn('Unable to extract agentId via API:', error);
    }
    // 3.  Add ENS record associated with new agent
    if (options.ensOptions?.enabled && options.ensOptions.orgName) {
        try {
            const ensAgentAccount = (typeof computedAddress === 'string' && computedAddress.startsWith('0x'))
                ? computedAddress
                : options.agentData.agentAccount;
            onStatusUpdate?.('Creating ENS subdomain...');
            const ensResponse = await fetch('/api/agents/ens/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentName: options.agentData.agentName,
                    agentAccount: ensAgentAccount,
                    orgName: options.ensOptions.orgName,
                    agentUrl: options.agentData.agentUrl,
                }),
            });
            if (!ensResponse.ok) {
                const errorData = await ensResponse.json().catch(() => ({}));
                throw new Error(errorData?.message || errorData?.error || 'Failed to create ENS record');
            }
            onStatusUpdate?.('Preparing ENS metadata update...');
            const infoResponse = await fetch('/api/agents/ens/set-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentName: options.agentData.agentName,
                    orgName: options.ensOptions.orgName,
                    agentAddress: ensAgentAccount,
                    agentUrl: options.agentData.agentUrl,
                    agentDescription: options.agentData.description,
                }),
            });
            if (infoResponse.ok) {
                const infoData = await infoResponse.json();
                const infoCalls = [];
                if (Array.isArray(infoData?.calls)) {
                    for (const rawCall of infoData.calls) {
                        const to = rawCall?.to;
                        const data = rawCall?.data;
                        if (!to || !data) {
                            continue;
                        }
                        let value;
                        if (rawCall?.value !== null && rawCall?.value !== undefined) {
                            try {
                                value = BigInt(rawCall.value);
                            }
                            catch (error) {
                                console.warn('Unable to parse ENS info call value', rawCall.value, error);
                            }
                        }
                        infoCalls.push({
                            to,
                            data,
                            value,
                        });
                    }
                }
                if (infoCalls.length > 0) {
                    onStatusUpdate?.('Updating ENS agent info...');
                    const infoUserOpHash = await sendSponsoredUserOperation({
                        bundlerUrl,
                        chain: chain,
                        accountClient: agentAccountClient,
                        calls: infoCalls,
                    });
                    await waitForUserOperationReceipt({
                        bundlerUrl,
                        chain: chain,
                        hash: infoUserOpHash,
                    });
                }
            }
            else {
                const errorPayload = await infoResponse.json().catch(() => ({}));
                console.warn('Failed to prepare ENS metadata calls:', errorPayload);
            }
            console.log('Requested ENS record creation and metadata update for agent', options.agentData.agentName);
        }
        catch (ensError) {
            console.warn('Failed to create ENS record for agent:', ensError);
        }
    }
    // Refresh GraphQL indexer
    if (agentId) {
        await refreshAgentInIndexer(agentId);
    }
    else {
        onStatusUpdate?.('Refreshing GraphQL indexer...');
        console.log('UserOperation confirmed. Please refresh the agent list to see the new agent.');
    }
    return {
        agentId,
        txHash: userOpHash,
        requiresClientSigning: true,
    };
}
//# sourceMappingURL=walletSigning.js.map