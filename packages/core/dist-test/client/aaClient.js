import { keccak256, stringToHex, createPublicClient, http, createWalletClient, custom } from 'viem';
import { sepolia } from 'viem/chains';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';
import { getAgentAccountByAgentName } from '../server/lib/agentAccount';
export async function getAAAccountClientByAgentName(agentName, eoaAddress, options) {
    console.info("*********** aaClient getAAAccountClientByAgentName: agentName", agentName);
    const resolvedChain = options?.chain || sepolia;
    let walletClient;
    if (options?.walletClient) {
        walletClient = options.walletClient;
    }
    else {
        const provider = options?.ethereumProvider || (typeof window !== 'undefined' ? window.ethereum : null);
        if (!provider) {
            throw new Error('No wallet provider found. Ensure MetaMask/Web3Auth is available or pass ethereumProvider.');
        }
        walletClient = createWalletClient({
            chain: resolvedChain,
            transport: custom(provider),
            account: eoaAddress,
        });
    }
    let publicClient;
    if (options?.publicClient) {
        publicClient = options.publicClient;
    }
    else if (options?.rpcUrl) {
        publicClient = createPublicClient({
            chain: resolvedChain,
            transport: http(options.rpcUrl),
        });
    }
    else {
        const provider = options?.ethereumProvider || (typeof window !== 'undefined' ? window.ethereum : null);
        if (!provider) {
            throw new Error('No RPC URL or wallet provider available. Provide rpcUrl, ethereumProvider, or publicClient in options.');
        }
        publicClient = createPublicClient({
            chain: resolvedChain,
            transport: custom(provider),
        });
    }
    try {
        walletClient.account = eoaAddress;
    }
    catch (error) {
        console.warn('Unable to assign account on walletClient:', error);
    }
    const currentChainId = await walletClient.getChainId();
    if (currentChainId !== resolvedChain.id) {
        console.info(`🔄 Wallet is on chain ${currentChainId}, switching to ${resolvedChain.id} (${resolvedChain.name})`);
        try {
            await walletClient.switchChain({ id: resolvedChain.id });
            console.info(`✅ Successfully switched to chain ${resolvedChain.id}`);
        }
        catch (switchError) {
            console.error('❌ Failed to switch chain:', switchError);
            throw new Error(`Wallet is connected to chain ${currentChainId} but expected chain ${resolvedChain.id}. Please switch to ${resolvedChain.name} manually.`);
        }
    }
    const trimmedName = agentName?.trim();
    if (trimmedName) {
        console.info("*********** aaClient getAAAccountClientByAgentName: trimmedName", trimmedName);
        console.info("*********** aaClient getAAAccountClientByAgentName: options?.walletClient", options?.walletClient);
        if (options?.walletClient) {
            try {
                console.info("*********** aaClient getAAAccountClientByAgentName: trimmedName", trimmedName);
                const resolution = await getAgentAccountByAgentName(trimmedName);
                console.info("*********** aaClient getAAAccountClientByAgentName: resolution", resolution);
                if (resolution.account) {
                    const agentAccountClient = await toMetaMaskSmartAccount({
                        address: resolution.account,
                        client: publicClient,
                        implementation: Implementation.Hybrid,
                        signer: {
                            walletClient,
                        },
                    });
                    console.info(`ENS resolution found account via ${resolution.method}:`, resolution.account);
                    return agentAccountClient;
                }
            }
            catch (error) {
                console.warn('Server-side ENS resolution failed, falling back to client or deterministic path:', error);
            }
        }
        try {
            console.log("*********** aaClient getAAAccountClientByAgentName: try and call resolve-account API");
            const response = await fetch('/api/agents/resolve-account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentName: trimmedName }),
            });
            if (response.ok) {
                const data = await response.json();
                console.log("*********** aaClient getAAAccountClientByAgentName: data", data);
                if (data.account && data.account !== '0x0000000000000000000000000000000000000000') {
                    console.log("*********** aaClient getAAAccountClientByAgentName: data.account", data.account);
                    try {
                        const agentAccountClient = await toMetaMaskSmartAccount({
                            address: data.account,
                            implementation: Implementation.Hybrid,
                            deployParams: [eoaAddress, [], [], []],
                            signer: {
                                walletClient,
                            },
                        });
                        return agentAccountClient;
                    }
                    catch (error) {
                        console.log("******* found account is not an abstract account *****");
                    }
                }
                console.info('No ENS resolution found via API, using deterministic computation');
            }
            else {
                console.warn('ENS resolution API call failed, using deterministic computation');
            }
        }
        catch (error) {
            console.warn('Error calling ENS resolution API, using deterministic computation:', error);
        }
    }
    const salt = keccak256(stringToHex(agentName));
    const agentAccountClient = await toMetaMaskSmartAccount({
        client: publicClient,
        implementation: Implementation.Hybrid,
        deployParams: [eoaAddress, [], [], []],
        signer: {
            walletClient,
        },
        deploySalt: salt,
    });
    return agentAccountClient;
}
//# sourceMappingURL=aaClient.js.map