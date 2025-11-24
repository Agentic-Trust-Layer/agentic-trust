import type { AgentOperationPlan, DirectCreateAgentPayload } from './types';
import type { AgentClientConfig } from './client';

type FetchLike = typeof fetch;

const DEFAULT_BASE_PATH = '/api/agents';

function getFetch(config?: AgentClientConfig): FetchLike {
  if (config?.fetch) return config.fetch;
  if (typeof fetch !== 'undefined') return fetch;
  throw new Error(
    'Global fetch is not available. Provide a custom fetch implementation via config.fetch.',
  );
}

function getBasePath(config?: AgentClientConfig): string {
  return config?.basePath ?? DEFAULT_BASE_PATH;
}

export type CreateAgentDirectClientInput = DirectCreateAgentPayload;
export type CreateAgentDirectClientResult = AgentOperationPlan;

export async function createAgentDirect(
  input: CreateAgentDirectClientInput,
  config?: AgentClientConfig,
): Promise<CreateAgentDirectClientResult> {
  const fetchImpl = getFetch(config);
  const basePath = getBasePath(config);

  const response = await fetchImpl(`${basePath}/create-direct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.message || body?.error || 'Failed to create agent (direct)';
    throw new Error(message);
  }

  return body as CreateAgentDirectClientResult;
}

