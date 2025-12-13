import type { AgentApiContext } from './core';
export declare function getValidationsCore(ctx: AgentApiContext | undefined, input: {
    chainId: number;
    agentId: string | number;
}): Promise<{
    success: boolean;
    agentId: string;
    chainId: number;
    did8004: string;
    pending: import("../../server/lib/validations").ValidationStatusWithHash[];
    completed: import("../../server/lib/validations").ValidationStatusWithHash[];
}>;
//# sourceMappingURL=validations.d.ts.map