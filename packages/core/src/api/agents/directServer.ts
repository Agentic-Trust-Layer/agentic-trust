import { getAgenticTrustClient } from '../../server/lib/agenticTrust';
import type { AgenticTrustClient } from '../../server/singletons/agenticTrustClient';
import { AgentApiError } from './core';
import type {
  AgentOperationPlan,
  AgentOperationMode,
  DirectCreateAgentPayload,
} from './types';
import { DEFAULT_CHAIN_ID } from '../../server/lib/chainConfig';

function assertAddress(value: string | undefined, field: string): void {
  if (!value || typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new AgentApiError(`${field} must be a valid Ethereum address (0x...)`, 400);
  }
}

export interface DirectAgentApiContext {
  getClient?: () => Promise<AgenticTrustClient>;
}

async function resolveClient(
  ctx?: DirectAgentApiContext,
): Promise<AgenticTrustClient> {
  if (ctx?.getClient) {
    return ctx.getClient();
  }
  return getAgenticTrustClient();
}

export async function createAgentDirectCore(
  ctx: DirectAgentApiContext | undefined,
  input: DirectCreateAgentPayload,
): Promise<AgentOperationPlan> {
  const client = await resolveClient(ctx);
  const chainId = input.chainId ?? DEFAULT_CHAIN_ID;

  if (!input.agentName?.trim()) {
    throw new AgentApiError('agentName is required', 400);
  }
  assertAddress(input.agentAccount, 'agentAccount');

  if (input.mode === 'aa') {
    const result = await client.createAgent({
      ownerType: 'aa',
      executionMode: 'server',
      agentName: input.agentName,
      agentAccount: input.agentAccount as `0x${string}`,
      agentCategory: input.agentCategory,
      description: input.description,
      image: input.image,
      agentUrl: input.agentUrl,
      supportedTrust: input.supportedTrust,
      endpoints: input.endpoints,
      chainId,
      ensOptions: input.ensOptions as any,
    } as any);

    const typedResult = result as { agentId?: string | bigint; txHash: string };
    if (!typedResult.txHash) {
      throw new AgentApiError('Server createAgent did not return txHash', 500, result);
    }

    return {
      success: true,
      operation: 'create',
      mode: 'aa',
      chainId,
      tokenUri: undefined,
      bundlerUrl: undefined,
      calls: [],
      transaction: null,
      agentId: typedResult.agentId
        ? typedResult.agentId.toString()
        : undefined,
      txHash: typedResult.txHash,
    };
  }

  const eoaResult = await client.createAgent({
    ownerType: 'eoa',
    executionMode: 'server',
    agentName: input.agentName,
    agentAccount: input.agentAccount as `0x${string}`,
    description: input.description,
    image: input.image,
    agentUrl: input.agentUrl,
    supportedTrust: input.supportedTrust,
    endpoints: input.endpoints,
    chainId,
  });

  const typed = eoaResult as { agentId: string | bigint; txHash: string };

  return {
    success: true,
    operation: 'create',
    mode: 'eoa',
    chainId,
    tokenUri: undefined,
    calls: [],
    transaction: null,
    agentId: typed.agentId ? typed.agentId.toString() : undefined,
    txHash: typed.txHash,
  };
}

