import { buildDid8004 } from '../../index';
import { getValidationClient } from '../singletons/validationClient';

export interface AgentValidationsSummary {
  agentId: string;
  chainId: number;
  did8004: string;
  pending: unknown[];
  completed: unknown[];
}

export async function getAgentValidationsSummary(
  chainId: number,
  agentId: string | number,
): Promise<AgentValidationsSummary> {
  const client = await getValidationClient(chainId);

  const numericAgentId =
    typeof agentId === 'string' ? Number.parseInt(agentId, 10) : Number(agentId);
  if (!Number.isFinite(numericAgentId) || numericAgentId <= 0) {
    throw new Error('Invalid agentId');
  }

  const agentIdBigInt = BigInt(numericAgentId);

  const requestHashes = await client.getAgentValidations(agentIdBigInt);

  const pending: unknown[] = [];
  const completed: unknown[] = [];

  for (const hash of requestHashes) {
    try {
      const status = await client.getValidationStatus(hash);
      if (status.response === 0) {
        pending.push(status);
      } else {
        completed.push(status);
      }
    } catch {
      // Ignore invalid entries but continue
    }
  }

  const did8004 = buildDid8004(chainId, numericAgentId);

  return {
    agentId: String(numericAgentId),
    chainId,
    did8004,
    pending,
    completed,
  };
}


