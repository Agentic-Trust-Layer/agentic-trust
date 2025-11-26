import type { AgentApiContext } from './core';
import { getAgentValidationsSummary } from '../../server/lib/validations';

export async function getValidationsCore(
  ctx: AgentApiContext | undefined,
  input: { chainId: number; agentId: string | number },
) {
  const summary = await getAgentValidationsSummary(input.chainId, input.agentId);

  return {
    success: true,
    agentId: summary.agentId,
    chainId: summary.chainId,
    did8004: summary.did8004,
    pending: summary.pending,
    completed: summary.completed,
  };
}


