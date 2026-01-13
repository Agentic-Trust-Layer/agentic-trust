/**
 * Client-side wallet signing utilities
 *
 * Handles MetaMask/EIP-1193 wallet integration for signing and sending transactions
 * All Ethereum logic is handled server-side, client only needs to sign and send
 */
import { createWalletClient, custom, createPublicClient, getAddress, } from 'viem';
import { http, isAddressEqual } from 'viem';
import { AIAgentIdentityClient } from '@agentic-trust/8004-ext-sdk';
import { getChainById, DEFAULT_CHAIN_ID, getChainRpcUrl, getChainBundlerUrl, sepolia, baseSepolia, optimismSepolia, isL1, isL2, isPrivateKeyMode, } from '../server/lib/chainConfig';
import { getDeployedAccountClientByAgentName, sendSponsoredUserOperation, waitForUserOperationReceipt, } from './accountClient';
import { createAgent as callCreateAgentEndpoint, updateAgentRegistration as callUpdateAgentRegistrationEndpoint, } from '../api/agents/client';
import { parseDid8004 } from '../shared/did8004';
export { getDeployedAccountClientByAgentName, getDeployedAccountClientByAddress, getCounterfactualAccountClientByAgentName, getCounterfactualSmartAccountAddressByAgentName, getCounterfactualAAAddressByAgentName, } from './accountClient';
async function preflightValidationRegistryAuthorization(params) {
    const parsed = parseDid8004(params.requesterDid);
    const rpcUrl = getChainRpcUrl(params.chain.id);
    if (!rpcUrl) {
        throw new Error(`Missing RPC URL for chain ${params.chain.id}. Cannot preflight ValidationRegistry authorization.`);
    }
    if (!params.requesterAccountClient) {
        throw new Error('smartAccount mode requires requesterAccountClient');
    }
    const sender = await (async () => {
        if (typeof params.requesterAccountClient.getAddress === 'function') {
            return getAddress(await params.requesterAccountClient.getAddress());
        }
        const addr = params.requesterAccountClient.address;
        if (typeof addr === 'string' && addr.startsWith('0x')) {
            return getAddress(addr);
        }
        throw new Error('requesterAccountClient missing getAddress() and address; cannot determine sender.');
    })();
    const publicClient = createPublicClient({
        chain: params.chain,
        transport: http(rpcUrl),
    });
    const VALIDATION_ABI = [
        {
            type: 'function',
            name: 'getIdentityRegistry',
            stateMutability: 'view',
            inputs: [],
            outputs: [{ name: '', type: 'address' }],
        },
    ];
    const IDENTITY_ABI = [
        {
            type: 'function',
            name: 'ownerOf',
            stateMutability: 'view',
            inputs: [{ name: 'tokenId', type: 'uint256' }],
            outputs: [{ name: 'owner', type: 'address' }],
        },
        {
            type: 'function',
            name: 'isApprovedForAll',
            stateMutability: 'view',
            inputs: [
                { name: 'owner', type: 'address' },
                { name: 'operator', type: 'address' },
            ],
            outputs: [{ name: '', type: 'bool' }],
        },
        {
            type: 'function',
            name: 'getApproved',
            stateMutability: 'view',
            inputs: [{ name: 'tokenId', type: 'uint256' }],
            outputs: [{ name: '', type: 'address' }],
        },
    ];
    const validationRegistry = getAddress(params.validationRegistry);
    const identityRegistryOnValidation = await publicClient.readContract({
        address: validationRegistry,
        abi: VALIDATION_ABI,
        functionName: 'getIdentityRegistry',
    });
    const ownerOnValidation = await publicClient.readContract({
        address: identityRegistryOnValidation,
        abi: IDENTITY_ABI,
        functionName: 'ownerOf',
        args: [BigInt(parsed.agentId)],
    });
    const isOwner = ownerOnValidation.toLowerCase() === sender.toLowerCase();
    let isApprovedForAll = false;
    let tokenApproved = null;
    if (!isOwner) {
        try {
            isApprovedForAll = (await publicClient.readContract({
                address: identityRegistryOnValidation,
                abi: IDENTITY_ABI,
                functionName: 'isApprovedForAll',
                args: [ownerOnValidation, sender],
            }));
        }
        catch {
            // ignore
        }
        try {
            tokenApproved = (await publicClient.readContract({
                address: identityRegistryOnValidation,
                abi: IDENTITY_ABI,
                functionName: 'getApproved',
                args: [BigInt(parsed.agentId)],
            }));
        }
        catch {
            // ignore
        }
    }
    const ok = isOwner || isApprovedForAll || (typeof tokenApproved === 'string' && tokenApproved.toLowerCase() === sender.toLowerCase());
    console.log('[Validation Request][preflight] Authorization check:', {
        requesterDid: parsed.did,
        agentId: parsed.agentId,
        validationRegistry,
        identityRegistryOnValidation,
        ownerOnValidation,
        sender,
        isOwner,
        isApprovedForAll,
        tokenApproved,
        ok,
    });
    if (!ok) {
        throw new Error(`ValidationRegistry will revert "Not authorized". ` +
            `ownerOf(agentId=${parsed.agentId}) on ValidationRegistry.identityRegistry is ${ownerOnValidation}, ` +
            `UserOp sender is ${sender}, ` +
            `isApprovedForAll=${String(isApprovedForAll)}, getApproved=${tokenApproved ?? 'unknown'}.`);
    }
}
function resolveEthereumProvider(providedProvider) {
    if (providedProvider)
        return providedProvider;
    if (typeof window !== 'undefined') {
        const web3authProvider = window?.web3auth?.provider;
        if (web3authProvider)
            return web3authProvider;
        const injected = window.ethereum;
        if (injected)
            return injected;
    }
    return null;
}
async function resolveChainId(ethereumProvider) {
    try {
        const chainHex = await ethereumProvider.request?.({
            method: 'eth_chainId',
        });
        if (typeof chainHex === 'string') {
            return parseInt(chainHex, 16);
        }
    }
    catch {
        // ignore; fallback below
    }
    // Fallback to default chain id
    return DEFAULT_CHAIN_ID;
}
/**
 * Ensure the provider has an authorized account and return it.
 * Tries eth_accounts first; if empty, requests eth_requestAccounts.
 */
async function ensureAuthorizedAccount(ethereumProvider) {
    try {
        const existing = await ethereumProvider.request({ method: 'eth_accounts' });
        if (Array.isArray(existing) && existing.length > 0) {
            return existing[0];
        }
    }
    catch {
        // ignore and fall through to request
    }
    try {
        const granted = await ethereumProvider.request({
            method: 'eth_requestAccounts',
        });
        if (Array.isArray(granted) && granted.length > 0) {
            return granted[0];
        }
    }
    catch {
        // fallthrough to permissions flow
    }
    try {
        await ethereumProvider.request?.({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
        });
        const afterPerm = await ethereumProvider.request({
            method: 'eth_accounts',
        });
        if (Array.isArray(afterPerm) && afterPerm.length > 0) {
            return afterPerm[0];
        }
    }
    catch {
        // ignore
    }
    throw new Error('Wallet not authorized. Please connect your wallet.');
}
async function ensureChainSelected(ethereumProvider, chain) {
    try {
        const currentHex = await ethereumProvider.request?.({
            method: 'eth_chainId',
        });
        const current = typeof currentHex === 'string' ? parseInt(currentHex, 16) : undefined;
        if (current === chain.id)
            return;
    }
    catch {
        // continue to switch
    }
    const hexId = `0x${chain.id.toString(16)}`;
    try {
        await ethereumProvider.request?.({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: hexId }],
        });
        return;
    }
    catch (switchErr) {
        // 4902 = unknown chain, try add then switch
        if (switchErr?.code !== 4902) {
            throw switchErr;
        }
    }
    // Try to add chain using centralized configuration
    const chainConfig = getChainById(chain.id);
    const addParams = {
        chainId: hexId,
        chainName: chainConfig.name,
        nativeCurrency: {
            name: 'ETH',
            symbol: 'ETH',
            decimals: 18,
        },
        rpcUrls: [getChainRpcUrl(chain.id)],
        blockExplorerUrls: chainConfig.blockExplorers?.default
            ? [chainConfig.blockExplorers.default.url]
            : [],
    };
    await ethereumProvider.request?.({
        method: 'wallet_addEthereumChain',
        params: [addParams],
    });
    await ethereumProvider.request?.({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexId }],
    });
}
/**
 * Sign and send a transaction using MetaMask/EIP-1193 wallet
 *
 * @param options - Signing options including transaction, account, chain, and provider
 * @returns Transaction hash, receipt, and optionally extracted agentId
 */
export async function signAndSendTransaction(options) {
    const { transaction, account, chain, ethereumProvider, rpcUrl, onStatusUpdate, extractAgentId = false, } = options;
    // Get wallet provider
    const provider = resolveEthereumProvider(ethereumProvider);
    if (!provider) {
        throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
    }
    // Update status
    onStatusUpdate?.('Connecting to wallet...');
    // Create wallet client
    try {
        // Ensure correct chain & account permission before sending
        await ensureChainSelected(provider, chain);
        await ensureAuthorizedAccount(provider);
    }
    catch {
        // Non-fatal; some providers may not require this here
    }
    const walletClient = createWalletClient({
        account,
        chain,
        transport: custom(provider),
    });
    // Prefer a real RPC for reads (Web3Auth/OpenLogin providers often return opaque "internal JSON-RPC error"
    // for eth_getCode / eth_estimateGas / waitForReceipt).
    const rpcForReads = rpcUrl ||
        chain?.rpcUrls?.default?.http?.[0] ||
        chain?.rpcUrls?.public?.http?.[0];
    const readClient = createPublicClient({
        chain,
        transport: rpcForReads ? http(rpcForReads) : custom(provider),
    });
    // Web3Auth/OpenLogin providers can be on a different chain than our UI selection.
    // If we don't enforce chain alignment, sendTransaction can fail with opaque internal errors.
    try {
        const currentChainIdHex = (await provider.request?.({ method: 'eth_chainId', params: [] }));
        if (currentChainIdHex && typeof currentChainIdHex === 'string' && currentChainIdHex.startsWith('0x')) {
            const current = Number.parseInt(currentChainIdHex, 16);
            if (Number.isFinite(current) && current !== chain.id) {
                throw new Error(`Wallet is on chainId ${current} but this transaction targets chainId ${chain.id}. Please switch networks in Web3Auth and retry.`);
            }
        }
    }
    catch (e) {
        // If eth_chainId itself fails, continue; other checks will still surface errors.
    }
    // Preflight: ensure target has code + estimate gas (so we can surface reverts early and
    // avoid wallet-side estimation failures).
    let estimatedGas = null;
    if (transaction?.to) {
        const code = await readClient.getBytecode({ address: transaction.to });
        if (!code || code === '0x') {
            throw new Error(`Target contract is not deployed at ${String(transaction.to)} on chainId ${chain.id}. Check addresses/config.`);
        }
        try {
            estimatedGas = await readClient.estimateGas({
                account,
                to: transaction.to,
                data: transaction.data,
                value: BigInt(transaction.value ?? 0),
            });
        }
        catch (estimateErr) {
            // Try to extract revert reason from eth_call simulation
            let revertReason = 'unknown reason';
            try {
                await readClient.call({
                    account,
                    to: transaction.to,
                    data: transaction.data,
                    value: BigInt(transaction.value ?? 0),
                });
            }
            catch (callErr) {
                // Try multiple ways to extract revert reason
                const data = callErr?.data || callErr?.cause?.data || callErr?.details || callErr?.body?.error?.data || '';
                const shortMsg = callErr?.shortMessage || callErr?.message || '';
                // Standard Solidity revert: Error(string) selector 0x08c379a0
                if (typeof data === 'string' && data.startsWith('0x08c379a0')) {
                    try {
                        const { decodeAbiParameters } = await import('viem');
                        const decoded = decodeAbiParameters([{ type: 'string', name: 'reason' }], `0x${data.slice(10)}`);
                        revertReason = decoded[0];
                    }
                    catch {
                        revertReason = 'reverted with Error(string) (decode failed)';
                    }
                }
                else if (typeof data === 'string' && data.length > 2 && data.startsWith('0x')) {
                    // If we have hex data but it's not Error(string), show first bytes
                    revertReason = `reverted with data: ${data.slice(0, 130)}`;
                }
                else if (shortMsg && !shortMsg.includes('unknown')) {
                    revertReason = shortMsg;
                }
                // Log full error for debugging
                const errorMessage = callErr?.message || '';
                console.warn('[signAndSendTransaction] Full eth_call error details:', {
                    data,
                    shortMessage: shortMsg,
                    message: errorMessage,
                    cause: callErr?.cause,
                    body: callErr?.body,
                    stack: callErr?.stack?.split('\n').slice(0, 5),
                });
                // Try to decode Error(string) from the data if available
                if (data && typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
                    try {
                        // Check if it's an Error(string) - selector is 0x08c379a0
                        if (data.startsWith('0x08c379a0')) {
                            const { decodeAbiParameters } = await import('viem');
                            const decoded = decodeAbiParameters([{ type: 'string', name: 'reason' }], `0x${data.slice(10)}`);
                            console.warn('[signAndSendTransaction] Decoded Error(string) revert reason:', decoded[0]);
                            revertReason = decoded[0];
                        }
                        else {
                            // Try to decode as raw string data
                            const { decodeAbiParameters } = await import('viem');
                            try {
                                const decoded = decodeAbiParameters([{ type: 'string', name: 'reason' }], data);
                                if (decoded[0]) {
                                    console.warn('[signAndSendTransaction] Decoded raw revert reason:', decoded[0]);
                                    revertReason = decoded[0];
                                }
                            }
                            catch {
                                // If that fails, show first part of hex data
                                console.warn('[signAndSendTransaction] Raw revert data (first 100 chars):', data.slice(0, 100));
                            }
                        }
                    }
                    catch (decodeErr) {
                        console.warn('[signAndSendTransaction] Failed to decode revert data:', decodeErr);
                    }
                }
                // Try additional error message extraction
                if (errorMessage && errorMessage.includes('revert')) {
                    revertReason = errorMessage;
                }
            }
            const msg = estimateErr?.shortMessage || estimateErr?.message || String(estimateErr);
            throw new Error(`Transaction would fail (estimateGas): Execution reverted: ${revertReason}. ${msg}`);
        }
    }
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
    else if (estimatedGas) {
        // Pad estimate to avoid underestimation; some wallets struggle to estimate internally.
        // IMPORTANT: keep this integer-safe; BigInt() cannot take fractional numbers.
        // Use pure BigInt math to apply a 20% buffer.
        const eg = typeof estimatedGas === 'bigint' ? estimatedGas : BigInt(estimatedGas);
        txParams.gas = (eg * 120n) / 100n;
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
    // If fees are not provided, estimate them via RPC. This avoids Web3Auth internal errors
    // during wallet-side fee estimation.
    if (!txParams.gasPrice && !txParams.maxFeePerGas && !txParams.maxPriorityFeePerGas) {
        try {
            const fees = await readClient.estimateFeesPerGas();
            if (fees?.maxFeePerGas && fees?.maxPriorityFeePerGas) {
                txParams.maxFeePerGas = fees.maxFeePerGas;
                txParams.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
            }
            else {
                const gp = await readClient.getGasPrice();
                txParams.gasPrice = gp;
            }
        }
        catch {
            // Ignore; wallet may still handle fee estimation.
        }
    }
    // Sign and send transaction
    // NOTE: Web3Auth (OpenLogin) sometimes fails to surface the approval modal when using walletClient.sendTransaction.
    // We keep the viem path first, but add a fallback to eth_sendTransaction which tends to reliably trigger the UI.
    let hash;
    try {
        hash = await walletClient.sendTransaction(txParams);
    }
    catch (sendErr) {
        console.warn('[signAndSendTransaction] walletClient.sendTransaction failed; attempting eth_sendTransaction fallback', sendErr);
        try {
            const from = account || txParams.account;
            const txForProvider = {
                from,
                to: txParams.to,
                data: txParams.data,
                value: `0x${BigInt(txParams.value ?? 0n).toString(16)}`,
            };
            if (txParams.gas)
                txForProvider.gas = `0x${BigInt(txParams.gas).toString(16)}`;
            if (txParams.gasPrice)
                txForProvider.gasPrice = `0x${BigInt(txParams.gasPrice).toString(16)}`;
            if (txParams.maxFeePerGas)
                txForProvider.maxFeePerGas = `0x${BigInt(txParams.maxFeePerGas).toString(16)}`;
            if (txParams.maxPriorityFeePerGas)
                txForProvider.maxPriorityFeePerGas = `0x${BigInt(txParams.maxPriorityFeePerGas).toString(16)}`;
            hash = await provider.request?.({ method: 'eth_sendTransaction', params: [txForProvider] });
        }
        catch (fallbackErr) {
            console.warn('[signAndSendTransaction] eth_sendTransaction fallback failed', fallbackErr);
            throw sendErr;
        }
    }
    // Update status
    onStatusUpdate?.(`Transaction submitted! Hash: ${hash}. Waiting for confirmation...`);
    // Wait for transaction receipt (use RPC, not wallet provider)
    const receipt = await readClient.waitForTransactionReceipt({ hash });
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
            if (log.topics &&
                log.topics[0] === transferTopic &&
                log.topics[1] === zeroAddress) {
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
 * @param chainId - Chain ID for the agent
 * @param refreshEndpoint - Optional custom refresh endpoint (defaults to `/api/agents/<did>/refresh`)
 * @returns Promise that resolves when refresh is complete
 */
export async function refreshAgentInIndexer(agentId, chainId, refreshEndpoint) {
    const chainIdStr = typeof chainId === 'number' ? chainId.toString(10) : chainId?.toString() ?? '';
    if (!chainIdStr.trim()) {
        throw new Error('Chain ID is required to refresh agent in indexer');
    }
    const did = encodeURIComponent(`did:8004:${chainIdStr.trim()}:${agentId}`);
    const endpoint = refreshEndpoint || `/api/agents/${did}/refresh`;
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
    const provider = ethereumProvider ||
        (typeof window !== 'undefined' ? window.ethereum : null);
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
 * 1. Calls the API to create agent (endpoint: /api/agents/create)
 * 2. If client-side signing is required, signs and sends transaction
 * 3. Waits for receipt and extracts agentId
 * 4. Refreshes GraphQL indexer
 *
 * Only agentData is required - account, chain, and provider are auto-detected
 *
 * @param options - Creation options (only agentData required)
 * @returns Agent creation result
 */
async function createAgentWithWalletEOA(options) {
    const { agentData, account: providedAccount, ethereumProvider: providedProvider, rpcUrl: providedRpcUrl, onStatusUpdate, chainId: requestedChainId, } = options;
    // Get wallet provider (default to window.ethereum)
    const ethereumProvider = providedProvider ||
        (typeof window !== 'undefined' ? window.ethereum : null);
    if (!ethereumProvider) {
        throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
    }
    // Get account from provider if not provided
    let account;
    if (providedAccount) {
        account = providedAccount;
    }
    else {
        account = await ensureAuthorizedAccount(ethereumProvider);
    }
    // Step 1: Call API to create agent
    onStatusUpdate?.('Creating agent...');
    const plan = await callCreateAgentEndpoint({
        mode: 'eoa',
        agentName: agentData.agentName,
        agentAccount: agentData.agentAccount,
        agentCategory: agentData.agentCategory,
        supportedTrust: agentData.supportedTrust,
        description: agentData.description,
        image: agentData.image,
        agentUrl: agentData.agentUrl,
        endpoints: agentData.endpoints,
        chainId: requestedChainId,
    });
    if (plan.mode !== 'eoa' || !plan.transaction) {
        throw new Error('Server response missing EOA transaction details');
    }
    const chain = getChainById(plan.chainId);
    const preparedTx = {
        to: plan.transaction.to,
        data: plan.transaction.data,
        value: (plan.transaction.value ?? '0'),
        gas: plan.transaction.gas,
        gasPrice: plan.transaction.gasPrice,
        maxFeePerGas: plan.transaction.maxFeePerGas,
        maxPriorityFeePerGas: plan.transaction.maxPriorityFeePerGas,
        nonce: plan.transaction.nonce,
        chainId: plan.transaction.chainId,
    };
    // Sign and send transaction
    const result = await signAndSendTransaction({
        transaction: preparedTx,
        account,
        chain,
        ethereumProvider,
        onStatusUpdate,
        extractAgentId: true,
    });
    if (result.agentId) {
        // After registration, set agentWallet on-chain BEFORE notifying the indexer.
        try {
            const identityRegistry = plan.identityRegistry;
            if (!identityRegistry) {
                throw new Error('Missing identityRegistry in create-agent plan');
            }
            const viemWalletClient = createWalletClient({
                account,
                chain,
                transport: custom(ethereumProvider),
            });
            const viemPublicClient = createPublicClient({
                chain,
                transport: custom(ethereumProvider),
            });
            const identityClient = new AIAgentIdentityClient({
                publicClient: viemPublicClient,
                walletClient: viemWalletClient,
                identityRegistryAddress: identityRegistry,
            });
            const EIP712_DOMAIN_ABI = [
                {
                    type: 'function',
                    name: 'eip712Domain',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [
                        { name: 'name', type: 'string' },
                        { name: 'version', type: 'string' },
                        { name: 'chainId', type: 'uint256' },
                        { name: 'verifyingContract', type: 'address' },
                        { name: 'salt', type: 'bytes32' },
                        { name: 'extensions', type: 'uint256[]' },
                    ],
                },
            ];
            const domainRaw = (await viemPublicClient.readContract({
                address: identityRegistry,
                abi: EIP712_DOMAIN_ABI,
                functionName: 'eip712Domain',
                args: [],
            }));
            const domain = {
                name: String(domainRaw?.name ?? domainRaw?.[0] ?? ''),
                version: String(domainRaw?.version ?? domainRaw?.[1] ?? ''),
                chainId: Number(domainRaw?.chainId ?? domainRaw?.[2] ?? chain.id),
                verifyingContract: (domainRaw?.verifyingContract ?? domainRaw?.[3]),
                salt: (domainRaw?.salt ?? domainRaw?.[4]),
            };
            const agentIdBigInt = BigInt(result.agentId);
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60); // +1h
            const newWallet = getAddress(account);
            onStatusUpdate?.('MetaMask signature: set agent wallet (IdentityRegistry)');
            const signature = (await viemWalletClient.signTypedData({
                account,
                domain,
                primaryType: 'SetAgentWallet',
                types: {
                    SetAgentWallet: [
                        { name: 'agentId', type: 'uint256' },
                        { name: 'newWallet', type: 'address' },
                        { name: 'deadline', type: 'uint256' },
                    ],
                },
                message: { agentId: agentIdBigInt, newWallet, deadline },
            }));
            const { calls } = await identityClient.prepareSetAgentWalletCalls(agentIdBigInt, newWallet, deadline, signature);
            const call = calls[0];
            if (!call)
                throw new Error('prepareSetAgentWalletCalls returned no calls');
            await signAndSendTransaction({
                transaction: {
                    to: call.to,
                    data: call.data,
                    value: '0x0',
                    chainId: chain.id,
                },
                account,
                chain,
                ethereumProvider,
                onStatusUpdate,
                extractAgentId: false,
            });
        }
        catch (e) {
            console.warn('[createAgentWithWalletEOA] setAgentWallet failed (non-fatal):', e);
        }
        await refreshAgentInIndexer(result.agentId, plan.chainId);
    }
    return {
        agentId: result.agentId,
        txHash: result.hash,
        requiresClientSigning: true,
    };
}
/**
 * Create an agent with Account Abstraction (AA) using a wallet
 *
 * This client-side function handles the complete AA agent creation flow:
 * 1. Detects wallet provider and account
 * 2. Creates/retrieves AA account client for the agent
 * 3. Calls the server API route `/api/agents/create` to prepare registration
 * 4. Sends UserOperation via bundler using the AA account
 * 5. Extracts agentId and refreshes the indexer
 *
 * **Setup Required:**
 * Your Next.js app must mount the API route handler:
 *
 * ```typescript
 * // In app/api/agents/create/route.ts
 * import { createAgentRouteHandler } from '@agentic-trust/core/server';
 * export const POST = createAgentRouteHandler();
 * ```
 *
 * **Usage:**
 * ```typescript
 * import { createAgentWithWallet } from '@agentic-trust/core/client';
 *
 * const result = await createAgentWithWallet({
 *   agentData: {
 *     agentName: 'my-agent',
 *     agentAccount: '0x...', // AA account address
 *     description: 'My agent',
 *   },
 *   onStatusUpdate: (msg) => console.log(msg),
 * });
 * ```
 *
 * @param options - Agent creation options
 * @returns Agent creation result with agentId and txHash
 */
async function createAgentWithWalletAA(options) {
    const { agentData, account: providedAccount, ethereumProvider: providedProvider, rpcUrl: providedRpcUrl, onStatusUpdate, chainId: providedChainId, } = options;
    // Get wallet provider (default to window.ethereum)
    const ethereumProvider = resolveEthereumProvider(providedProvider);
    if (!ethereumProvider) {
        throw new Error('No wallet provider found. Please connect MetaMask or use an EIP-1193 compatible wallet.');
    }
    // Get account from provider if not provided
    let account;
    if (providedAccount) {
        account = providedAccount;
    }
    else {
        account = await ensureAuthorizedAccount(ethereumProvider);
    }
    const chainId = typeof providedChainId === 'number'
        ? providedChainId
        : await resolveChainId(ethereumProvider);
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
    // Ensure provider is on the required chain before building clients
    try {
        await ensureChainSelected(ethereumProvider, chain);
    }
    catch (switchErr) {
        console.warn('Unable to switch chain on provider for AA flow:', switchErr);
    }
    // Build viem clients bound to the user's Web3Auth provider
    const viemWalletClient = createWalletClient({
        account,
        chain,
        transport: custom(ethereumProvider),
    });
    const viemPublicClient = createPublicClient({
        chain,
        transport: custom(ethereumProvider),
    });
    // 1.  Need to create the Agent Account Abstraction (Account)
    // Build AA account client using client's EOA (MetaMask/Web3Auth)
    // Get agent name from request
    //let agentFullName = options.agentData.agentName;
    //if (options.ensOptions?.orgName) {
    //  agentFullName = options.agentData.agentName + '.' + options.ensOptions?.orgName + ".eth";
    //}
    // Get Account Client by Agent Name, find if exists and if not then create it
    let bundlerUrl = getChainBundlerUrl(chainId);
    let agentAccountClient = await getDeployedAccountClientByAgentName(bundlerUrl, options.agentData.agentName, account, {
        chain: chain,
        walletClient: viemWalletClient,
        publicClient: viemPublicClient,
    });
    if (!agentAccountClient) {
        throw new Error('Failed to build AA account client');
    }
    // Verify the address matches
    const computedAddress = await agentAccountClient.getAddress();
    if (computedAddress.toLowerCase() !==
        options.agentData.agentAccount.toLowerCase()) {
        throw new Error(`AA address mismatch: computed ${computedAddress}, expected ${options.agentData.agentAccount}`);
    }
    // 2.  Add ENS record associated with new agent
    console.log('*********** createAgentWithWallet: options.ensOptions', options.ensOptions);
    if (options.ensOptions?.enabled &&
        options.ensOptions.orgName &&
        isL1(chainId)) {
        try {
            const ensAgentAccount = typeof computedAddress === 'string' && computedAddress.startsWith('0x')
                ? computedAddress
                : options.agentData.agentAccount;
            onStatusUpdate?.('Creating ENS subdomain for agent: ' + options.agentData.agentName);
            const pkModeDetected = isPrivateKeyMode();
            console.log("createAgentWithWallet: pkModeDetected", pkModeDetected);
            const addEndpoint = pkModeDetected
                ? '/api/names/add-to-l1-org-pk'
                : '/api/names/add-to-l1-org';
            console.info(`[ENS][L1] ${pkModeDetected ? 'PK mode detected 11111' : 'Client mode'} - calling ${addEndpoint}`);
            const ensResponse = await fetch(addEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentAccount: ensAgentAccount,
                    orgName: options.ensOptions.orgName,
                    agentName: options.agentData.agentName,
                    agentUrl: options.agentData.agentUrl,
                    chainId,
                }),
            });
            if (!ensResponse.ok) {
                const err = await ensResponse.json().catch(() => ({}));
                console.warn('[ENS][L1] add-to-l1-org call failed', err);
            }
            else {
                console.info('[ENS][L1] add-to-l1-org call succeeded');
            }
            onStatusUpdate?.('Preparing ENS metadata update...');
            const infoEndpoint = pkModeDetected
                ? '/api/names/set-l1-name-info-pk'
                : '/api/names/set-l1-name-info';
            console.info(`[ENS][L1] ${pkModeDetected ? 'PK mode detected 22222' : 'Client mode'} - calling ${infoEndpoint}`);
            const infoResponse = await fetch(infoEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentAddress: ensAgentAccount,
                    orgName: options.ensOptions.orgName,
                    agentName: options.agentData.agentName,
                    agentUrl: options.agentData.agentUrl,
                    agentDescription: options.agentData.description,
                    chainId,
                }),
            });
            if (infoResponse.ok) {
                console.log('*********** createAgentWithWallet: ENS metadata response received');
                const infoData = await infoResponse.json();
                const serverInfoUserOpHash = infoData?.userOpHash;
                if (serverInfoUserOpHash) {
                    console.log('*********** createAgentWithWallet: ENS info userOpHash (server-submitted)', serverInfoUserOpHash);
                }
                else {
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
                        onStatusUpdate?.('MetaMask signature: update ENS metadata (URL/description/image)');
                        // Ensure we are using a deployed-only AA client (no factory/factoryData)
                        //const fullAgentName = agentName + '.' + options.ensOptions.orgName + ".eth";
                        console.log('!!!!!!!!!!!! handleCreateAgent: getDeployedAccountClientByAgentName 2: agentName', options.agentData.agentName);
                        agentAccountClient = await getDeployedAccountClientByAgentName(bundlerUrl, options.agentData.agentName, account, {
                            chain: chain,
                            walletClient: viemWalletClient,
                            publicClient: viemPublicClient,
                        });
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
    else if (options.ensOptions?.enabled &&
        options.ensOptions.orgName &&
        isL2(chainId)) {
        const rawOrg = options.ensOptions.orgName || '';
        const rawAgent = options.agentData.agentName || '';
        const cleanOrgName = rawOrg.replace(/\.eth$/i, '').toLowerCase();
        const orgPattern = cleanOrgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cleanAgentName = rawAgent
            .replace(new RegExp(`^${orgPattern}\\.`, 'i'), '')
            .replace(/\.eth$/i, '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-');
        const agentUrl = options.agentData.agentUrl;
        const agentDescription = options.agentData.description;
        const agentImage = options.agentData.image;
        // Prepare all necessary L2 ENS calls server-side, then send them as one user operation
        const prepareResp = await fetch('/api/names/add-to-l2-org', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentAddress: agentAccountClient.address,
                orgName: cleanOrgName,
                agentName: cleanAgentName,
                agentUrl,
                agentDescription,
                agentImage,
                chainId,
            }),
        });
        if (!prepareResp.ok) {
            const errorPayload = await prepareResp.json().catch(() => ({}));
            console.warn('Failed to prepare L2 ENS calls:', errorPayload);
        }
        else {
            const { calls: rawCalls } = await prepareResp.json();
            const l2EnsCalls = (rawCalls || []).map((call) => ({
                to: call.to,
                data: call.data,
                value: BigInt(call.value || '0'),
            }));
            if (l2EnsCalls.length > 0) {
                for (const call of l2EnsCalls) {
                    onStatusUpdate?.('MetaMask signature: create ENS subdomain / set ENS records');
                    console.log('********************* send sponsored user operation for L2 ENS call');
                    const userOpHash = await sendSponsoredUserOperation({
                        bundlerUrl,
                        chain,
                        accountClient: agentAccountClient,
                        calls: [call],
                    });
                    await waitForUserOperationReceipt({
                        bundlerUrl,
                        chain,
                        hash: userOpHash,
                    });
                }
            }
        }
        /*  TODO:  Need to resolve this to set ens url and description
          onStatusUpdate?.('Set ENS metadata update...');
          const infoResponse = await fetch('/api/names/set-l2-name-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentAddress: agentAccountClient.address,
              orgName: options.ensOptions.orgName,
              agentName: options.agentData.agentName,
              agentUrl: options.agentData.agentUrl,
              agentDescription: options.agentData.description,
              chainId,
            }),
          });
    
          if (!infoResponse.ok) {
            const errorPayload = await infoResponse.json().catch(() => ({}));
            console.warn('Failed to prepare L2 ENS calls:', errorPayload);
          } else {
            const { calls: rawCalls } = await infoResponse.json();
            const l2EnsCalls = (rawCalls || []).map((call: any) => ({
              to: call.to as `0x${string}`,
              data: call.data as `0x${string}`,
              value: BigInt(call.value || '0'),
            }));
            if (l2EnsCalls.length > 0) {
              for (const call of l2EnsCalls) {
                console.log('********************* send sponsored user operation for L2 ENS call');
                const userOpHash = await sendSponsoredUserOperation({
                  bundlerUrl,
                  chain,
                  accountClient: agentAccountClient,
                  calls: [call],
                });
                await waitForUserOperationReceipt({
                  bundlerUrl,
                  chain,
                  hash: userOpHash,
                });
              }
            }
          }
            */
    }
    // 2.  Need to create the Agent Identity (NFT)
    console.log('*********** createAgentWithWallet: creating agent identity...');
    const finalAgentName = options.ensOptions?.enabled && options.ensOptions?.orgName
        ? `${options.agentData.agentName}.${options.ensOptions?.orgName}.eth`
        : options.agentData.agentName;
    agentData.agentName = finalAgentName;
    let data;
    try {
        data = await callCreateAgentEndpoint({
            mode: 'smartAccount',
            account: computedAddress,
            agentName: agentData.agentName,
            agentAccount: agentData.agentAccount,
            agentCategory: agentData.agentCategory,
            supportedTrust: agentData.supportedTrust,
            description: agentData.description,
            image: agentData.image,
            agentUrl: agentData.agentUrl,
            endpoints: agentData.endpoints,
            chainId,
        });
    }
    catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Failed to create agent');
    }
    if (data.mode !== 'smartAccount') {
        throw new Error('Server returned an unexpected plan mode for SmartAccount creation');
    }
    if (data.bundlerUrl) {
        bundlerUrl = data.bundlerUrl;
    }
    if (!Array.isArray(data.calls) || data.calls.length === 0) {
        throw new Error('Agent creation response missing register calls');
    }
    // Construct Agent Identity with agentAccount Client
    const createAgentIdentityCalls = data.calls.map((call) => ({
        to: call.to,
        data: call.data,
        value: BigInt(call.value || '0'),
    }));
    // Send UserOperation via bundler
    onStatusUpdate?.('MetaMask signature: register agent identity (ERC-8004)');
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
                receipt: JSON.parse(JSON.stringify(receipt, (_, value) => typeof value === 'bigint' ? value.toString() : value)),
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
    // Refresh GraphQL indexer
    if (agentId) {
        // After registration, set agentWallet on-chain BEFORE notifying the indexer.
        try {
            const identityRegistry = data.identityRegistry;
            if (!identityRegistry) {
                throw new Error('Missing identityRegistry in create-agent response');
            }
            const identityClient = new AIAgentIdentityClient({
                publicClient: viemPublicClient,
                walletClient: viemWalletClient,
                identityRegistryAddress: identityRegistry,
            });
            const EIP712_DOMAIN_ABI = [
                {
                    type: 'function',
                    name: 'eip712Domain',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [
                        { name: 'name', type: 'string' },
                        { name: 'version', type: 'string' },
                        { name: 'chainId', type: 'uint256' },
                        { name: 'verifyingContract', type: 'address' },
                        { name: 'salt', type: 'bytes32' },
                        { name: 'extensions', type: 'uint256[]' },
                    ],
                },
            ];
            const domainRaw = (await viemPublicClient.readContract({
                address: identityRegistry,
                abi: EIP712_DOMAIN_ABI,
                functionName: 'eip712Domain',
                args: [],
            }));
            const domain = {
                name: String(domainRaw?.name ?? domainRaw?.[0] ?? ''),
                version: String(domainRaw?.version ?? domainRaw?.[1] ?? ''),
                chainId: Number(domainRaw?.chainId ?? domainRaw?.[2] ?? chain.id),
                verifyingContract: (domainRaw?.verifyingContract ?? domainRaw?.[3]),
                salt: (domainRaw?.salt ?? domainRaw?.[4]),
            };
            const agentIdBigInt = BigInt(agentId);
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60); // +1h
            const newWallet = getAddress(account);
            onStatusUpdate?.('MetaMask signature: set agent wallet (IdentityRegistry)');
            const signature = (await viemWalletClient.signTypedData({
                account,
                domain,
                primaryType: 'SetAgentWallet',
                types: {
                    SetAgentWallet: [
                        { name: 'agentId', type: 'uint256' },
                        { name: 'newWallet', type: 'address' },
                        { name: 'deadline', type: 'uint256' },
                    ],
                },
                message: { agentId: agentIdBigInt, newWallet, deadline },
            }));
            const { calls } = await identityClient.prepareSetAgentWalletCalls(agentIdBigInt, newWallet, deadline, signature);
            const call = calls[0];
            if (!call)
                throw new Error('prepareSetAgentWalletCalls returned no calls');
            const setWalletUserOpHash = await sendSponsoredUserOperation({
                bundlerUrl,
                chain: chain,
                accountClient: agentAccountClient,
                calls: [{ to: call.to, data: call.data, value: 0n }],
            });
            await waitForUserOperationReceipt({
                bundlerUrl,
                chain: chain,
                hash: setWalletUserOpHash,
            });
        }
        catch (e) {
            console.warn('[createAgentWithWalletAA] setAgentWallet failed (non-fatal):', e);
        }
        await refreshAgentInIndexer(agentId, chain.id);
        // Finalize UAID now that we have a real on-chain agentId, and write it back by updating tokenUri.
        try {
            onStatusUpdate?.('Finalizing UAID and updating registration tokenUri...');
            const uaidResp = await fetch('/api/agents/generate-uaid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentAccount: agentData.agentAccount,
                    chainId: chain.id,
                    // Use did:ethr for uid (not ENS)
                    uid: `did:ethr:${chain.id}:${agentData.agentAccount}`,
                    proto: 'a2a',
                    registry: 'erc-8004',
                    domain: typeof agentData.agentUrl === 'string' && agentData.agentUrl.trim()
                        ? (() => {
                            try {
                                return new URL(agentData.agentUrl).hostname;
                            }
                            catch {
                                return undefined;
                            }
                        })()
                        : undefined,
                }),
            });
            if (uaidResp.ok) {
                const uaidData = await uaidResp.json().catch(() => ({}));
                const uaid = typeof uaidData?.uaid === 'string' && uaidData.uaid.trim() ? uaidData.uaid.trim() : null;
                if (uaid) {
                    const did8004 = `did:8004:${chain.id}:${agentId}`;
                    const registrationUpdate = {
                        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
                        name: agentData.agentName,
                        description: agentData.description,
                        image: agentData.image,
                        agentUrl: agentData.agentUrl,
                        // Never include MCP endpoint in registration JSON updates.
                        endpoints: Array.isArray(agentData.endpoints)
                            ? agentData.endpoints.filter(e => e?.name !== 'MCP')
                            : undefined,
                        supportedTrust: agentData.supportedTrust,
                        active: true,
                        registeredBy: 'agentic-trust',
                        registryNamespace: 'erc-8004',
                        uaid,
                        // Ensure agentId is written into the tokenUri JSON
                        registrations: [
                            {
                                agentId: String(agentId),
                                // agentRegistry is best-effort; server will also backfill if omitted
                                agentRegistry: `eip155:${chain.id}:unknown`,
                                registeredAt: new Date().toISOString(),
                            },
                        ],
                    };
                    await updateAgentRegistrationWithWallet({
                        did8004,
                        chain,
                        accountClient: agentAccountClient,
                        registration: registrationUpdate,
                        onStatusUpdate,
                    });
                }
                else {
                    console.warn('[createAgentWithWalletAA] UAID endpoint returned no uaid value');
                }
            }
            else {
                const err = await uaidResp.json().catch(() => ({}));
                console.warn('[createAgentWithWalletAA] UAID endpoint failed:', err);
            }
        }
        catch (uaidErr) {
            console.warn('[createAgentWithWalletAA] Failed to finalize UAID + registration update:', uaidErr);
        }
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
export async function createAgentWithWallet(options) {
    const useAA = options.useAA ?? false;
    if (useAA) {
        return createAgentWithWalletAA(options);
    }
    return createAgentWithWalletEOA(options);
}
export async function updateAgentRegistrationWithWallet(options) {
    const { did8004, chain, accountClient, registration, onStatusUpdate } = options;
    const serialized = typeof registration === 'string' ? registration : JSON.stringify(registration, null, 2);
    onStatusUpdate?.('Preparing agent registration update on server...');
    console.info('........... registration: ', registration);
    let prepared;
    try {
        prepared = await callUpdateAgentRegistrationEndpoint({
            did8004,
            registration: serialized,
            mode: 'smartAccount',
        });
    }
    catch (error) {
        throw new Error(error instanceof Error
            ? error.message
            : 'Failed to prepare registration update');
    }
    const bundlerUrl = prepared.bundlerUrl;
    const rawCalls = Array.isArray(prepared.calls) ? prepared.calls : [];
    if (!bundlerUrl || rawCalls.length === 0) {
        throw new Error('Registration update response missing bundlerUrl or calls');
    }
    // Preflight authorization check to avoid opaque bundler simulation reverts ("Not authorized").
    // The IdentityRegistry setAgentUri requires msg.sender to be owner or approved operator for the agentId.
    try {
        const identityRegistry = prepared.identityRegistry;
        const rpcUrl = getChainRpcUrl(chain.id) || chain.rpcUrls?.default?.http?.[0];
        if (identityRegistry && rpcUrl) {
            const publicClient = createPublicClient({
                chain: chain,
                transport: http(rpcUrl),
            });
            const { agentId } = parseDid8004(did8004);
            const tokenId = BigInt(agentId);
            const sender = getAddress(accountClient.address);
            const ERC721_ABI = [
                {
                    type: 'function',
                    name: 'ownerOf',
                    stateMutability: 'view',
                    inputs: [{ name: 'tokenId', type: 'uint256' }],
                    outputs: [{ name: 'owner', type: 'address' }],
                },
                {
                    type: 'function',
                    name: 'getApproved',
                    stateMutability: 'view',
                    inputs: [{ name: 'tokenId', type: 'uint256' }],
                    outputs: [{ name: 'operator', type: 'address' }],
                },
                {
                    type: 'function',
                    name: 'isApprovedForAll',
                    stateMutability: 'view',
                    inputs: [
                        { name: 'owner', type: 'address' },
                        { name: 'operator', type: 'address' },
                    ],
                    outputs: [{ name: 'approved', type: 'bool' }],
                },
            ];
            const owner = (await publicClient.readContract({
                address: identityRegistry,
                abi: ERC721_ABI,
                functionName: 'ownerOf',
                args: [tokenId],
            }));
            // If owner is sender, OK.
            const ownerNorm = getAddress(owner);
            if (ownerNorm !== sender) {
                const approved = (await publicClient.readContract({
                    address: identityRegistry,
                    abi: ERC721_ABI,
                    functionName: 'getApproved',
                    args: [tokenId],
                }));
                const approvedNorm = approved ? getAddress(approved) : '0x0000000000000000000000000000000000000000';
                const approvedForAll = (await publicClient.readContract({
                    address: identityRegistry,
                    abi: ERC721_ABI,
                    functionName: 'isApprovedForAll',
                    args: [ownerNorm, sender],
                }));
                const isAuthorized = approvedNorm === sender || approvedForAll === true;
                if (!isAuthorized) {
                    throw new Error(`Not authorized to update agent registration. ` +
                        `Agent NFT owner=${ownerNorm}, sender=${sender}. ` +
                        `Grant approval (approve or setApprovalForAll) or use the owning account.`);
                }
            }
        }
    }
    catch (preflightErr) {
        // If we can definitively detect authorization mismatch, surface it.
        const msg = preflightErr?.message || String(preflightErr);
        if (msg.includes('Not authorized to update agent registration')) {
            throw preflightErr;
        }
    }
    const updateCalls = rawCalls.map((call) => ({
        to: call.to,
        data: call.data,
        value: BigInt(call.value ?? '0'),
    }));
    console.info('updateCalls', updateCalls);
    console.info('accountClient:', accountClient.address);
    onStatusUpdate?.('Sending registration update via bundler...');
    const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain: chain,
        accountClient,
        calls: updateCalls,
    });
    onStatusUpdate?.(`Registration update sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`);
    const receipt = await waitForUserOperationReceipt({
        bundlerUrl,
        chain: chain,
        hash: userOpHash,
    });
    console.info('........... receipt: ', receipt);
    return {
        txHash: userOpHash,
        requiresClientSigning: true,
    };
}
export async function giveFeedbackWithWallet(options) {
    const { did8004, chain, score, feedback, feedbackAuth, clientAddress, tag1, tag2, feedbackUri, feedbackHash, skill, context, capability, ethereumProvider, onStatusUpdate, } = options;
    onStatusUpdate?.('Preparing feedback submission on server...');
    let prepared;
    try {
        const response = await fetch(`/api/agents/${encodeURIComponent(did8004)}/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                score,
                feedback,
                feedbackAuth,
                clientAddress,
                tag1,
                tag2,
                feedbackUri,
                feedbackHash,
                skill,
                context,
                capability,
                mode: 'eoa',
            }),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.message || 'Failed to prepare feedback submission');
        }
        prepared = (await response.json());
    }
    catch (error) {
        throw new Error(error instanceof Error
            ? error.message
            : 'Failed to prepare feedback submission');
    }
    if (!prepared.transaction) {
        throw new Error('Feedback submission response missing transaction payload');
    }
    const txResult = await signAndSendTransaction({
        transaction: prepared.transaction, // AgentPreparedTransactionPayload is compatible with PreparedTransaction
        account: (clientAddress || '0x'),
        chain,
        ethereumProvider,
        onStatusUpdate,
    });
    return {
        txHash: txResult.hash,
        requiresClientSigning: true,
    };
}
export async function finalizeAssociationWithWallet(options) {
    const { chain, submitterAccountClient, mode = 'smartAccount', ethereumProvider, account, requesterDid, initiatorAddress: initiatorAddressOverride, approverAddress, assocType, description, validAt, data, initiatorSignature, approverSignature, onStatusUpdate, } = options;
    // Preflight: best-effort ERC-1271 signature validation to avoid opaque bundler "reason: 0x".
    // This checks whether the initiator/approver smart accounts would accept the provided signatures
    // for the association digest we are about to submit.
    if (mode === 'smartAccount') {
        if (!submitterAccountClient) {
            throw new Error('smartAccount mode requires submitterAccountClient');
        }
        try {
            const rpcUrl = getChainRpcUrl(chain.id) || chain.rpcUrls?.default?.http?.[0];
            if (rpcUrl) {
                const publicClient = createPublicClient({
                    chain: chain,
                    transport: http(rpcUrl),
                });
                // Resolve initiator address for digest computation.
                // If caller supplied an override (from inbox payload), prefer it to avoid mismatches.
                const initiatorFinal = initiatorAddressOverride
                    ? getAddress(initiatorAddressOverride)
                    : null;
                let initiatorResolved = initiatorFinal;
                if (!initiatorResolved) {
                    const initiatorResp = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}`);
                    const initiatorJson = initiatorResp.ok ? await initiatorResp.json().catch(() => ({})) : {};
                    const initiatorAddrRaw = initiatorJson?.agentAccount || initiatorJson?.account;
                    if (initiatorAddrRaw) {
                        initiatorResolved = getAddress(initiatorAddrRaw);
                    }
                }
                if (!initiatorResolved) {
                    throw new Error('Missing initiatorAddress for association preflight');
                }
                const approver = getAddress(approverAddress);
                // Recompute digest using the erc8092 scheme (same as packages/erc8092-sdk eip712Hash)
                const { ethers } = await import('ethers');
                const toMinimalBigEndianBytes = (n) => {
                    if (n === 0n)
                        return new Uint8Array([0]);
                    let hex = n.toString(16);
                    if (hex.length % 2)
                        hex = `0${hex}`;
                    return ethers.getBytes(`0x${hex}`);
                };
                const formatEvmV1 = (chainId, address) => {
                    const addr = ethers.getAddress(address);
                    const chainRef = toMinimalBigEndianBytes(BigInt(chainId));
                    const head = ethers.getBytes('0x00010000');
                    const out = ethers.concat([
                        head,
                        new Uint8Array([chainRef.length]),
                        chainRef,
                        new Uint8Array([20]),
                        ethers.getBytes(addr),
                    ]);
                    return ethers.hexlify(out);
                };
                const initiatorInterop = formatEvmV1(chain.id, initiatorResolved);
                const approverInterop = formatEvmV1(chain.id, approver);
                const abiCoder = ethers.AbiCoder.defaultAbiCoder();
                const DOMAIN_TYPEHASH = ethers.id('EIP712Domain(string name,string version)');
                const NAME_HASH = ethers.id('AssociatedAccounts');
                const VERSION_HASH = ethers.id('1');
                const MESSAGE_TYPEHASH = ethers.id('AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)');
                const domainSeparator = ethers.keccak256(abiCoder.encode(['bytes32', 'bytes32', 'bytes32'], [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH]));
                const interfaceId = '0x00000000';
                const validUntil = 0;
                const hashStruct = ethers.keccak256(abiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint40', 'uint40', 'bytes4', 'bytes32'], [
                    MESSAGE_TYPEHASH,
                    ethers.keccak256(initiatorInterop),
                    ethers.keccak256(approverInterop),
                    validAt,
                    validUntil,
                    interfaceId,
                    ethers.keccak256(data),
                ]));
                const digest = ethers.keccak256(ethers.solidityPacked(['bytes2', 'bytes32', 'bytes32'], ['0x1901', domainSeparator, hashStruct]));
                const ERC1271_MAGIC = '0x1626ba7e';
                const ERC1271_ABI = [
                    {
                        type: 'function',
                        name: 'isValidSignature',
                        stateMutability: 'view',
                        inputs: [
                            { name: 'hash', type: 'bytes32' },
                            { name: 'signature', type: 'bytes' },
                        ],
                        outputs: [{ name: 'magicValue', type: 'bytes4' }],
                    },
                ];
                const checkSignature = async (account, sig) => {
                    const code = await publicClient.getBytecode({ address: account });
                    // EOA: verify with ecrecover.
                    if (!code || code === '0x') {
                        try {
                            const recovered = ethers.recoverAddress(digest, sig);
                            return {
                                ok: recovered.toLowerCase() === account.toLowerCase(),
                                method: 'ecrecover',
                                recovered,
                            };
                        }
                        catch (e) {
                            return { ok: false, method: 'ecrecover', error: e?.message || String(e) };
                        }
                    }
                    // Contract: verify with ERC-1271.
                    try {
                        const magic = (await publicClient.readContract({
                            address: account,
                            abi: ERC1271_ABI,
                            functionName: 'isValidSignature',
                            args: [digest, sig],
                        }));
                        return { ok: magic.toLowerCase() === ERC1271_MAGIC, method: 'erc1271', magic };
                    }
                    catch (e) {
                        return { ok: false, method: 'erc1271', error: e?.message || String(e) };
                    }
                };
                const initiatorCheck = await checkSignature(initiatorResolved, initiatorSignature);
                if (!initiatorCheck.ok) {
                    throw new Error(`Initiator signature check failed. initiator=${initiatorResolved} digest=${digest} method=${initiatorCheck.method}`);
                }
                const approverCheck = await checkSignature(approver, approverSignature);
                if (!approverCheck.ok) {
                    throw new Error(`Approver signature check failed. approver=${approver} digest=${digest} method=${approverCheck.method}`);
                }
                // Extra sanity: ensure we're submitting from the approver account we think we are.
                const submitter = getAddress(submitterAccountClient.address);
                if (!isAddressEqual(submitter, approver)) {
                    console.warn('[finalizeAssociationWithWallet] submitterAccountClient.address does not match approverAddress', { submitter, approver });
                }
            }
        }
        catch (preflightErr) {
            // If we can detect invalid signatures, surface it; otherwise continue to let bundler give more info.
            // (This block is best-effort and should not block in environments without RPC.)
            const msg = preflightErr?.message || String(preflightErr);
            if (msg.includes('rejected signature') || msg.includes('ERC-1271')) {
                throw preflightErr;
            }
        }
    }
    onStatusUpdate?.('Preparing association store transaction on server...');
    let prepared;
    const response = await fetch('/api/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            did8004: requesterDid,
            initiatorAddress: initiatorAddressOverride,
            approverAddress: getAddress(approverAddress),
            assocType,
            description,
            validAt,
            data,
            initiatorSignature,
            approverSignature,
            mode,
        }),
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Failed to prepare association store');
    }
    prepared = (await response.json());
    if (mode === 'eoa') {
        if (!prepared.transaction) {
            throw new Error('Association store response missing transaction payload');
        }
        if (!account) {
            throw new Error('EOA mode requires account (EOA sender address)');
        }
        const txResult = await signAndSendTransaction({
            transaction: prepared.transaction,
            account,
            chain,
            ethereumProvider,
            onStatusUpdate,
        });
        return { txHash: txResult.hash, requiresClientSigning: true };
    }
    const bundlerUrl = prepared.bundlerUrl;
    const rawCalls = Array.isArray(prepared.calls) ? prepared.calls : [];
    if (!bundlerUrl || rawCalls.length === 0) {
        throw new Error('Association store response missing bundlerUrl or calls');
    }
    if (!submitterAccountClient) {
        throw new Error('smartAccount mode requires submitterAccountClient');
    }
    const calls = rawCalls.map((call) => ({
        to: getAddress(call.to),
        data: call.data,
        value: BigInt(call.value ?? '0'),
    }));
    onStatusUpdate?.('Submitting association via bundler...');
    const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain: chain,
        accountClient: submitterAccountClient,
        calls,
    });
    await waitForUserOperationReceipt({
        bundlerUrl,
        chain: chain,
        hash: userOpHash,
    });
    return { txHash: userOpHash, requiresClientSigning: true };
}
export async function requestNameValidationWithWallet(options) {
    const { requesterDid, chain, requesterAccountClient, mode = 'smartAccount', ethereumProvider, account, requestUri, requestHash, onStatusUpdate, } = options;
    onStatusUpdate?.('Preparing validation request on server...');
    const validatorName = 'name-validation';
    const chainIdFromDid = (() => parseDid8004(requesterDid).chainId)();
    async function resolveValidatorAddressByName(params) {
        const urlParams = new URLSearchParams({
            query: params.validatorName,
            page: '1',
            pageSize: '10',
        });
        const response = await fetch(`/api/agents/search?${urlParams.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to resolve validator "${params.validatorName}" via discovery (status ${response.status})`);
        }
        const data = (await response.json().catch(() => ({})));
        const agents = Array.isArray(data?.agents) ? data.agents : [];
        const normalizedName = params.validatorName.trim().toLowerCase();
        const byExactName = agents.find((a) => {
            const name = typeof a?.agentName === 'string' ? a.agentName.trim().toLowerCase() : '';
            const chainIdOk = typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
            const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
            return chainIdOk && acctOk && name === normalizedName;
        });
        const fallback = agents.find((a) => {
            const chainIdOk = typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
            const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
            return chainIdOk && acctOk;
        });
        const agentAccount = (byExactName?.agentAccount ?? fallback?.agentAccount);
        if (!agentAccount) {
            throw new Error(`Validator "${params.validatorName}" not found in discovery (chainId=${params.chainId ?? 'any'})`);
        }
        return getAddress(agentAccount);
    }
    async function resolveValidatorAddress(params) {
        try {
            return await resolveValidatorAddressByName(params);
        }
        catch (_discoveryErr) {
            const chainId = typeof params.chainId === 'number'
                ? params.chainId
                : typeof chain?.id === 'number'
                    ? chain.id
                    : undefined;
            if (!chainId) {
                throw _discoveryErr;
            }
            const resp = await fetch(`/api/validator-address?validatorName=${encodeURIComponent(params.validatorName)}&chainId=${encodeURIComponent(String(chainId))}`);
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                const msg = errData?.error ||
                    errData?.message ||
                    `Failed to resolve validator "${params.validatorName}" via /api/validator-address (status ${resp.status})`;
                throw new Error(msg);
            }
            const data = (await resp.json().catch(() => ({})));
            const addr = typeof data?.validatorAddress === 'string' ? data.validatorAddress : '';
            if (!addr || !addr.startsWith('0x')) {
                throw new Error(`Validator "${params.validatorName}" address not returned by /api/validator-address`);
            }
            return getAddress(addr);
        }
    }
    let prepared;
    try {
        const requestBody = {
            requestUri,
            requestHash,
            mode,
        };
        // Server requires validatorAddress; resolve validatorName -> address client-side if needed.
        requestBody.validatorAddress =
            (options.validatorAddress
                ? getAddress(options.validatorAddress)
                : await resolveValidatorAddress({
                    validatorName,
                    chainId: chainIdFromDid,
                }));
        const response = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}/validation-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.message || 'Failed to prepare validation request');
        }
        prepared = (await response.json());
    }
    catch (error) {
        throw new Error(error instanceof Error
            ? error.message
            : 'Failed to prepare validation request');
    }
    const bundlerUrl = prepared.bundlerUrl;
    const rawCalls = Array.isArray(prepared.calls) ? prepared.calls : [];
    // EOA mode: server returns a transaction payload.
    if (mode === 'eoa') {
        if (!prepared.transaction) {
            throw new Error('Validation request response missing transaction payload');
        }
        if (!account) {
            throw new Error('EOA mode requires account (EOA sender address)');
        }
        const txResult = await signAndSendTransaction({
            transaction: prepared.transaction,
            account,
            chain,
            ethereumProvider,
            onStatusUpdate,
        });
        const validatorAddress = prepared.metadata?.validatorAddress ||
            (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
            '';
        const finalRequestHash = prepared.metadata?.requestHash || '';
        return {
            txHash: txResult.hash,
            requiresClientSigning: true,
            validatorAddress,
            requestHash: finalRequestHash,
        };
    }
    if (!bundlerUrl || rawCalls.length === 0) {
        throw new Error('Validation request response missing bundlerUrl or calls');
    }
    const validationCalls = rawCalls.map((call) => ({
        to: call.to,
        data: call.data,
        value: BigInt(call.value ?? '0'),
    }));
    await preflightValidationRegistryAuthorization({
        requesterDid,
        chain,
        requesterAccountClient,
        validationRegistry: getAddress(validationCalls[0].to),
    });
    onStatusUpdate?.('Sending validation request via bundler...');
    const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain: chain,
        accountClient: requesterAccountClient,
        calls: validationCalls,
    });
    onStatusUpdate?.(`Validation request sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`);
    const receipt = await waitForUserOperationReceipt({
        bundlerUrl,
        chain: chain,
        hash: userOpHash,
    });
    const validatorAddress = prepared.metadata?.validatorAddress ||
        (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
        '';
    const finalRequestHash = prepared.metadata?.requestHash || '';
    return {
        txHash: userOpHash,
        requiresClientSigning: true,
        validatorAddress,
        requestHash: finalRequestHash,
    };
}
export async function requestAccountValidationWithWallet(options) {
    const { requesterDid, chain, requesterAccountClient, mode = 'smartAccount', ethereumProvider, account, requestUri, requestHash, onStatusUpdate, } = options;
    onStatusUpdate?.('Preparing validation request on server...');
    const validatorName = 'account-validator';
    const chainIdFromDid = (() => parseDid8004(requesterDid).chainId)();
    async function resolveValidatorAddressByName(params) {
        const urlParams = new URLSearchParams({
            query: params.validatorName,
            page: '1',
            pageSize: '10',
        });
        const response = await fetch(`/api/agents/search?${urlParams.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to resolve validator "${params.validatorName}" via discovery (status ${response.status})`);
        }
        const data = (await response.json().catch(() => ({})));
        const agents = Array.isArray(data?.agents) ? data.agents : [];
        const normalizedName = params.validatorName.trim().toLowerCase();
        const byExactName = agents.find((a) => {
            const name = typeof a?.agentName === 'string' ? a.agentName.trim().toLowerCase() : '';
            const chainIdOk = typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
            const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
            return chainIdOk && acctOk && name === normalizedName;
        });
        const fallback = agents.find((a) => {
            const chainIdOk = typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
            const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
            return chainIdOk && acctOk;
        });
        const agentAccount = (byExactName?.agentAccount ?? fallback?.agentAccount);
        if (!agentAccount) {
            throw new Error(`Validator "${params.validatorName}" not found in discovery (chainId=${params.chainId ?? 'any'})`);
        }
        return getAddress(agentAccount);
    }
    async function resolveValidatorAddress(params) {
        try {
            return await resolveValidatorAddressByName(params);
        }
        catch (_discoveryErr) {
            const chainId = typeof params.chainId === 'number'
                ? params.chainId
                : typeof chain?.id === 'number'
                    ? chain.id
                    : undefined;
            if (!chainId) {
                throw _discoveryErr;
            }
            const resp = await fetch(`/api/validator-address?validatorName=${encodeURIComponent(params.validatorName)}&chainId=${encodeURIComponent(String(chainId))}`);
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                const msg = errData?.error ||
                    errData?.message ||
                    `Failed to resolve validator "${params.validatorName}" via /api/validator-address (status ${resp.status})`;
                throw new Error(msg);
            }
            const data = (await resp.json().catch(() => ({})));
            const addr = typeof data?.validatorAddress === 'string' ? data.validatorAddress : '';
            if (!addr || !addr.startsWith('0x')) {
                throw new Error(`Validator "${params.validatorName}" address not returned by /api/validator-address`);
            }
            return getAddress(addr);
        }
    }
    let prepared;
    try {
        const requestBody = {
            requestUri,
            requestHash,
            mode: 'smartAccount',
        };
        // Server requires validatorAddress; resolve validatorName -> address client-side if needed.
        requestBody.validatorAddress =
            (options.validatorAddress
                ? getAddress(options.validatorAddress)
                : await resolveValidatorAddress({
                    validatorName,
                    chainId: chainIdFromDid,
                }));
        const response = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}/validation-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.message || 'Failed to prepare validation request');
        }
        prepared = (await response.json());
    }
    catch (error) {
        throw new Error(error instanceof Error
            ? error.message
            : 'Failed to prepare validation request');
    }
    const bundlerUrl = prepared.bundlerUrl;
    const rawCalls = Array.isArray(prepared.calls) ? prepared.calls : [];
    if (mode === 'eoa') {
        if (!prepared.transaction) {
            throw new Error('Validation request response missing transaction payload');
        }
        if (!account) {
            throw new Error('EOA mode requires account (EOA sender address)');
        }
        const txResult = await signAndSendTransaction({
            transaction: prepared.transaction,
            account,
            chain,
            ethereumProvider,
            onStatusUpdate,
        });
        const validatorAddress = prepared.metadata?.validatorAddress ||
            (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
            '';
        const finalRequestHash = prepared.metadata?.requestHash || '';
        return {
            txHash: txResult.hash,
            requiresClientSigning: true,
            validatorAddress,
            requestHash: finalRequestHash,
        };
    }
    if (!bundlerUrl || rawCalls.length === 0) {
        throw new Error('Validation request response missing bundlerUrl or calls');
    }
    const validationCalls = rawCalls.map((call) => ({
        to: call.to,
        data: call.data,
        value: BigInt(call.value ?? '0'),
    }));
    await preflightValidationRegistryAuthorization({
        requesterDid,
        chain,
        requesterAccountClient,
        validationRegistry: getAddress(validationCalls[0].to),
    });
    onStatusUpdate?.('Sending validation request via bundler...');
    const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain: chain,
        accountClient: requesterAccountClient,
        calls: validationCalls,
    });
    onStatusUpdate?.(`Validation request sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`);
    const receipt = await waitForUserOperationReceipt({
        bundlerUrl,
        chain: chain,
        hash: userOpHash,
    });
    const validatorAddress = prepared.metadata?.validatorAddress ||
        (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
        '';
    const finalRequestHash = prepared.metadata?.requestHash || '';
    return {
        txHash: userOpHash,
        requiresClientSigning: true,
        validatorAddress,
        requestHash: finalRequestHash,
    };
}
export async function requestAppValidationWithWallet(options) {
    const { requesterDid, chain, requesterAccountClient, mode = 'smartAccount', ethereumProvider, account, requestUri, requestHash, onStatusUpdate, } = options;
    onStatusUpdate?.('Preparing validation request on server...');
    const validatorName = 'app-validator';
    const chainIdFromDid = (() => parseDid8004(requesterDid).chainId)();
    async function resolveValidatorAddressByName(params) {
        const urlParams = new URLSearchParams({
            query: params.validatorName,
            page: '1',
            pageSize: '10',
        });
        const response = await fetch(`/api/agents/search?${urlParams.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to resolve validator "${params.validatorName}" via discovery (status ${response.status})`);
        }
        const data = (await response.json().catch(() => ({})));
        const agents = Array.isArray(data?.agents) ? data.agents : [];
        const normalizedName = params.validatorName.trim().toLowerCase();
        const byExactName = agents.find((a) => {
            const name = typeof a?.agentName === 'string' ? a.agentName.trim().toLowerCase() : '';
            const chainIdOk = typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
            const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
            return chainIdOk && acctOk && name === normalizedName;
        });
        const fallback = agents.find((a) => {
            const chainIdOk = typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
            const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
            return chainIdOk && acctOk;
        });
        const agentAccount = (byExactName?.agentAccount ?? fallback?.agentAccount);
        if (!agentAccount) {
            throw new Error(`Validator "${params.validatorName}" not found in discovery (chainId=${params.chainId ?? 'any'})`);
        }
        return getAddress(agentAccount);
    }
    async function resolveValidatorAddress(params) {
        try {
            return await resolveValidatorAddressByName(params);
        }
        catch (_discoveryErr) {
            const chainId = typeof params.chainId === 'number'
                ? params.chainId
                : typeof chain?.id === 'number'
                    ? chain.id
                    : undefined;
            if (!chainId) {
                throw _discoveryErr;
            }
            const resp = await fetch(`/api/validator-address?validatorName=${encodeURIComponent(params.validatorName)}&chainId=${encodeURIComponent(String(chainId))}`);
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                const msg = errData?.error ||
                    errData?.message ||
                    `Failed to resolve validator "${params.validatorName}" via /api/validator-address (status ${resp.status})`;
                throw new Error(msg);
            }
            const data = (await resp.json().catch(() => ({})));
            const addr = typeof data?.validatorAddress === 'string' ? data.validatorAddress : '';
            if (!addr || !addr.startsWith('0x')) {
                throw new Error(`Validator "${params.validatorName}" address not returned by /api/validator-address`);
            }
            return getAddress(addr);
        }
    }
    let prepared;
    try {
        const requestBody = {
            requestUri,
            requestHash,
            mode,
        };
        requestBody.validatorAddress =
            (options.validatorAddress
                ? getAddress(options.validatorAddress)
                : await resolveValidatorAddress({
                    validatorName,
                    chainId: chainIdFromDid,
                }));
        const response = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}/validation-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.message || 'Failed to prepare validation request');
        }
        prepared = (await response.json());
    }
    catch (error) {
        throw new Error(error instanceof Error
            ? error.message
            : 'Failed to prepare validation request');
    }
    const bundlerUrl = prepared.bundlerUrl;
    const rawCalls = Array.isArray(prepared.calls) ? prepared.calls : [];
    if (mode === 'eoa') {
        if (!prepared.transaction) {
            throw new Error('Validation request response missing transaction payload');
        }
        if (!account) {
            throw new Error('EOA mode requires account (EOA sender address)');
        }
        const txResult = await signAndSendTransaction({
            transaction: prepared.transaction,
            account,
            chain,
            ethereumProvider,
            onStatusUpdate,
        });
        const validatorAddress = prepared.metadata?.validatorAddress ||
            (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
            '';
        const finalRequestHash = prepared.metadata?.requestHash || '';
        return {
            txHash: txResult.hash,
            requiresClientSigning: true,
            validatorAddress,
            requestHash: finalRequestHash,
        };
    }
    if (!bundlerUrl || rawCalls.length === 0) {
        throw new Error('Validation request response missing bundlerUrl or calls');
    }
    const validationCalls = rawCalls.map((call) => ({
        to: call.to,
        data: call.data,
        value: BigInt(call.value ?? '0'),
    }));
    await preflightValidationRegistryAuthorization({
        requesterDid,
        chain,
        requesterAccountClient,
        validationRegistry: getAddress(validationCalls[0].to),
    });
    onStatusUpdate?.('Sending validation request via bundler...');
    const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain: chain,
        accountClient: requesterAccountClient,
        calls: validationCalls,
    });
    onStatusUpdate?.(`Validation request sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`);
    const receipt = await waitForUserOperationReceipt({
        bundlerUrl,
        chain: chain,
        hash: userOpHash,
    });
    const validatorAddress = prepared.metadata?.validatorAddress ||
        (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
        '';
    const finalRequestHash = prepared.metadata?.requestHash || '';
    return {
        txHash: userOpHash,
        requiresClientSigning: true,
        validatorAddress,
        requestHash: finalRequestHash,
    };
}
export async function requestAIDValidationWithWallet(options) {
    const { requesterDid, chain, requesterAccountClient, mode = 'smartAccount', ethereumProvider, account, requestUri, requestHash, onStatusUpdate, } = options;
    onStatusUpdate?.('Preparing validation request on server...');
    const validatorName = 'aid-validator';
    const chainIdFromDid = (() => {
        const m = requesterDid.match(/^did:8004:(\d+):/);
        if (!m)
            return undefined;
        const parsed = Number(m[1]);
        return Number.isFinite(parsed) ? parsed : undefined;
    })();
    async function resolveValidatorAddressByName(params) {
        const urlParams = new URLSearchParams({
            query: params.validatorName,
            page: '1',
            pageSize: '10',
        });
        const response = await fetch(`/api/agents/search?${urlParams.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to resolve validator "${params.validatorName}" via discovery (status ${response.status})`);
        }
        const data = (await response.json().catch(() => ({})));
        const agents = Array.isArray(data?.agents) ? data.agents : [];
        const normalizedName = params.validatorName.trim().toLowerCase();
        const byExactName = agents.find((a) => {
            const name = typeof a?.agentName === 'string' ? a.agentName.trim().toLowerCase() : '';
            const chainIdOk = typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
            const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
            return chainIdOk && acctOk && name === normalizedName;
        });
        const fallback = agents.find((a) => {
            const chainIdOk = typeof params.chainId === 'number' ? Number(a?.chainId) === params.chainId : true;
            const acctOk = typeof a?.agentAccount === 'string' && a.agentAccount.startsWith('0x');
            return chainIdOk && acctOk;
        });
        const agentAccount = (byExactName?.agentAccount ?? fallback?.agentAccount);
        if (!agentAccount) {
            throw new Error(`Validator "${params.validatorName}" not found in discovery (chainId=${params.chainId ?? 'any'})`);
        }
        return getAddress(agentAccount);
    }
    async function resolveValidatorAddress(params) {
        try {
            return await resolveValidatorAddressByName(params);
        }
        catch (_discoveryErr) {
            const chainId = typeof params.chainId === 'number'
                ? params.chainId
                : typeof chain?.id === 'number'
                    ? chain.id
                    : undefined;
            if (!chainId) {
                throw _discoveryErr;
            }
            const resp = await fetch(`/api/validator-address?validatorName=${encodeURIComponent(params.validatorName)}&chainId=${encodeURIComponent(String(chainId))}`);
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                const msg = errData?.error ||
                    errData?.message ||
                    `Failed to resolve validator "${params.validatorName}" via /api/validator-address (status ${resp.status})`;
                throw new Error(msg);
            }
            const data = (await resp.json().catch(() => ({})));
            const addr = typeof data?.validatorAddress === 'string' ? data.validatorAddress : '';
            if (!addr || !addr.startsWith('0x')) {
                throw new Error(`Validator "${params.validatorName}" address not returned by /api/validator-address`);
            }
            return getAddress(addr);
        }
    }
    let prepared;
    try {
        const requestBody = {
            requestUri,
            requestHash,
            mode,
        };
        requestBody.validatorAddress =
            (options.validatorAddress
                ? getAddress(options.validatorAddress)
                : await resolveValidatorAddress({
                    validatorName,
                    chainId: chainIdFromDid,
                }));
        const response = await fetch(`/api/agents/${encodeURIComponent(requesterDid)}/validation-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.message || 'Failed to prepare validation request');
        }
        prepared = (await response.json());
    }
    catch (error) {
        throw new Error(error instanceof Error
            ? error.message
            : 'Failed to prepare validation request');
    }
    const bundlerUrl = prepared.bundlerUrl;
    const rawCalls = Array.isArray(prepared.calls) ? prepared.calls : [];
    if (mode === 'eoa') {
        if (!prepared.transaction) {
            throw new Error('Validation request response missing transaction payload');
        }
        if (!account) {
            throw new Error('EOA mode requires account (EOA sender address)');
        }
        const txResult = await signAndSendTransaction({
            transaction: prepared.transaction,
            account,
            chain,
            ethereumProvider,
            onStatusUpdate,
        });
        const validatorAddress = prepared.metadata?.validatorAddress ||
            (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
            '';
        const finalRequestHash = prepared.metadata?.requestHash || '';
        return {
            txHash: txResult.hash,
            requiresClientSigning: true,
            validatorAddress,
            requestHash: finalRequestHash,
        };
    }
    if (!bundlerUrl || rawCalls.length === 0) {
        throw new Error('Validation request response missing bundlerUrl or calls');
    }
    const validationCalls = rawCalls.map((call) => ({
        to: call.to,
        data: call.data,
        value: BigInt(call.value ?? '0'),
    }));
    onStatusUpdate?.('Sending validation request via bundler...');
    const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain: chain,
        accountClient: requesterAccountClient,
        calls: validationCalls,
    });
    onStatusUpdate?.(`Validation request sent! UserOperation hash: ${userOpHash}. Waiting for confirmation...`);
    const receipt = await waitForUserOperationReceipt({
        bundlerUrl,
        chain: chain,
        hash: userOpHash,
    });
    const validatorAddress = prepared.metadata?.validatorAddress ||
        (options.validatorAddress ? getAddress(options.validatorAddress) : '') ||
        '';
    const finalRequestHash = prepared.metadata?.requestHash || '';
    return {
        txHash: userOpHash,
        requiresClientSigning: true,
        validatorAddress,
        requestHash: finalRequestHash,
    };
}
//# sourceMappingURL=walletSigning.js.map