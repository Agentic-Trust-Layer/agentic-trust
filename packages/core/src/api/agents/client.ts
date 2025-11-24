import type {
  AgentOperationPlan,
  CreateAgentPayload,
  UpdateAgentRegistrationPayload,
} from './types';

type FetchLike = typeof fetch;

export interface AgentClientConfig {
  basePath?: string;
  fetch?: FetchLike;
}

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

export type CreateAgentClientInput = CreateAgentPayload;
export type CreateAgentClientResult = AgentOperationPlan;

export async function createAgent(
  input: CreateAgentClientInput,
  config?: AgentClientConfig,
): Promise<CreateAgentClientResult> {
  const fetchImpl = getFetch(config);
  const basePath = getBasePath(config);

  const response = await fetchImpl(`${basePath}/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.message || body?.error || 'Failed to create agent';
    throw new Error(message);
  }

  return body as CreateAgentClientResult;
}

export interface UpdateAgentRegistrationClientInput
  extends Omit<UpdateAgentRegistrationPayload, 'registration'> {
  registration: string | Record<string, unknown>;
}

export type UpdateAgentRegistrationClientResult = AgentOperationPlan;

export async function updateAgentRegistration(
  input: UpdateAgentRegistrationClientInput,
  config?: AgentClientConfig,
): Promise<UpdateAgentRegistrationClientResult> {
  const fetchImpl = getFetch(config);
  const basePath = getBasePath(config);

  const encodedDid = encodeURIComponent(input.did8004);
  const response = await fetchImpl(
    `${basePath}/${encodedDid}/registration`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registration: input.registration,
      }),
    },
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body?.message || body?.error || 'Failed to update agent registration';
    throw new Error(message);
  }

  return body as UpdateAgentRegistrationClientResult;
}

