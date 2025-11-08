import { sepolia } from 'viem/chains';
import type { PublicClient, WalletClient } from 'viem';
export declare function getAAAccountClientByAgentName(agentName: string, eoaAddress: `0x${string}`, options?: {
    rpcUrl?: string;
    chain?: typeof sepolia;
    publicClient?: PublicClient;
    walletClient?: WalletClient;
    ethereumProvider?: any;
}): Promise<any>;
//# sourceMappingURL=aaClient.d.ts.map