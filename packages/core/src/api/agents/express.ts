import {
  AgentApiError,
  createAgentCore,
  type AgentApiContext,
  updateAgentRegistrationCore,
} from './core';
import type {
  CreateAgentPayload,
  AgentOperationPlan,
  UpdateAgentRegistrationPayload,
} from './types';

type ExpressRequestLike = {
  body?: unknown;
  params?: Record<string, string | undefined>;
  [key: string]: unknown;
};

type ExpressResponseLike = {
  status: (code: number) => ExpressResponseLike;
  json: (body: unknown) => ExpressResponseLike | void;
};

type ExpressRouterLike = {
  post: (
    path: string,
    handler: (req: ExpressRequestLike, res: ExpressResponseLike) => unknown,
  ) => unknown;
  put: (
    path: string,
    handler: (req: ExpressRequestLike, res: ExpressResponseLike) => unknown,
  ) => unknown;
};

export type CreateContextFromExpress = (
  req: ExpressRequestLike,
) => AgentApiContext;

const defaultContextFactory: CreateContextFromExpress = () => ({});

function sendJson(
  res: ExpressResponseLike,
  status: number,
  payload: unknown,
): void {
  res.status(status).json(payload);
}

function handleExpressError(res: ExpressResponseLike, error: unknown): void {
  if (error instanceof AgentApiError) {
    sendJson(res, error.status ?? 400, {
      error: error.message,
      details: error.details,
    });
    return;
  }

  console.error('[AgenticTrust][Express] Unexpected error:', error);
  sendJson(res, 500, {
    error: 'Internal server error',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}

function createHandler<Input, Output>(
  handler: (
    ctx: AgentApiContext,
    input: Input,
  ) => Promise<Output>,
  getContext: CreateContextFromExpress,
) {
  return async (req: ExpressRequestLike, res: ExpressResponseLike) => {
    try {
      const ctx = getContext(req);
      const result = await handler(ctx, req.body as Input);
      sendJson(res, 200, result);
    } catch (error) {
      handleExpressError(res, error);
    }
  };
}

export function createAgentExpressHandler(
  getContext: CreateContextFromExpress = defaultContextFactory,
) {
  return createHandler<CreateAgentPayload, AgentOperationPlan>(
    createAgentCore,
    getContext,
  );
}

export function updateAgentRegistrationExpressHandler(
  getContext: CreateContextFromExpress = defaultContextFactory,
) {
  return async (req: ExpressRequestLike, res: ExpressResponseLike) => {
    try {
      const ctx = getContext(req);
      const did8004 =
        req.params?.did8004 ||
        req.params?.['did:8004'] ||
        req.params?.['did%3A8004'];
      if (!did8004) {
        throw new AgentApiError('Missing did:8004 parameter', 400);
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const input: UpdateAgentRegistrationPayload = {
        did8004: decodeURIComponent(did8004),
        registration: body.registration,
        mode: body.mode as any,
      };
      const result = await updateAgentRegistrationCore(ctx, input);
      sendJson(res, 200, result);
    } catch (error) {
      handleExpressError(res, error);
    }
  };
}

export interface MountAgentRoutesOptions {
  basePath?: string;
  createContext?: CreateContextFromExpress;
}

export function mountAgentRoutes(
  router: ExpressRouterLike,
  options?: MountAgentRoutesOptions,
): void {
  const basePath = options?.basePath ?? '/api/agents';
  const getContext = options?.createContext ?? defaultContextFactory;

  router.post(
    `${basePath}/create`,
    createAgentExpressHandler(getContext),
  );
  router.put(
    `${basePath}/:did8004/registration`,
    updateAgentRegistrationExpressHandler(getContext),
  );
}

