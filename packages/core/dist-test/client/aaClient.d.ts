import { sepolia } from 'viem/chains';
import type { PublicClient, WalletClient } from 'viem';
export declare function getDeployedAccountClientByAgentName(agentName: string, eoaAddress: `0x${string}`, options?: {
    chain?: typeof sepolia;
    publicClient?: PublicClient;
    walletClient?: WalletClient;
    ethereumProvider?: any;
}): Promise<any>;
export declare function getCounterfactualAccountClientByAgentName(agentName: string, eoaAddress: `0x${string}`, options?: {
    chain?: typeof sepolia;
    publicClient?: PublicClient;
    walletClient?: WalletClient;
    ethereumProvider?: any;
}): Promise<any>;
//# sourceMappingURL=aaClient.d.ts.map
