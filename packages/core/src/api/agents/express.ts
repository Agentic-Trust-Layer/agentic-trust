import {
  AgentApiError,
  createAgentCore,
  type AgentApiContext,
  updateAgentRegistrationCore,
  requestFeedbackAuthCore,
  prepareFeedbackCore,
} from './core';
import { parseDid8004 } from '../../shared/did8004';
import type {
  CreateAgentPayload,
  AgentOperationPlan,
  UpdateAgentRegistrationPayload,
  RequestFeedbackAuthPayload,
  RequestFeedbackAuthResult,
  PrepareFeedbackPayload,
} from './types';

type ExpressRequestLike = {
  body?: unknown;
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  url?: string;
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
  get: (
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

function getQueryParam(req: ExpressRequestLike, key: string): string | undefined {
  const query = req.query;
  const value = query ? query[key] : undefined;
  if (Array.isArray(value)) {
    return value[0]?.toString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value !== undefined && value !== null) {
    return String(value);
  }
  if (typeof req.url === 'string') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const param = url.searchParams.get(key);
      return param ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function requestFeedbackAuthExpressHandler(
  getContext: CreateContextFromExpress = defaultContextFactory,
) {
  return async (req: ExpressRequestLike, res: ExpressResponseLike) => {
    try {
      const ctx = getContext(req);
      const clientAddress = getQueryParam(req, 'clientAddress') ?? '';
      const paramAgentId =
        getQueryParam(req, 'agentId') ??
        req.params?.did8004 ??
        req.params?.['did:8004'] ??
        req.params?.['did%3A8004'];

      let agentId = paramAgentId ?? '';
      let chainId = parseNumber(getQueryParam(req, 'chainId'));

      if (paramAgentId?.startsWith('did:8004:')) {
        try {
          const parsed = parseDid8004(paramAgentId);
          agentId = parsed.agentId;
          chainId = parsed.chainId;
        } catch {
          // fallback to manual values below
        }
      }

      const indexLimit = parseNumber(getQueryParam(req, 'indexLimit'));
      const expirySeconds =
        parseNumber(getQueryParam(req, 'expirySec')) ??
        parseNumber(getQueryParam(req, 'expirySeconds'));

      const input: RequestFeedbackAuthPayload = {
        clientAddress,
        agentId,
        chainId,
        indexLimit,
        expirySeconds,
      };

      const result: RequestFeedbackAuthResult = await requestFeedbackAuthCore(
        ctx,
        input,
      );
      sendJson(res, 200, result);
    } catch (error) {
      handleExpressError(res, error);
    }
  };
}

export function prepareFeedbackExpressHandler(
  getContext: CreateContextFromExpress = defaultContextFactory,
) {
  return async (req: ExpressRequestLike, res: ExpressResponseLike) => {
    try {
      const ctx = getContext(req);
      const did8004 =
        req.params?.did8004 ??
        req.params?.['did:8004'] ??
        req.params?.['did%3A8004'];
      if (!did8004) {
        sendJson(res, 400, { error: 'did8004 parameter is required' });
        return;
      }

      const body = (req.body ?? {}) as Omit<PrepareFeedbackPayload, 'did8004'>;
      const input: PrepareFeedbackPayload = {
        did8004,
        ...body,
      };

      const result: AgentOperationPlan = await prepareFeedbackCore(ctx, input);
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
  router.get(
    `${basePath}/:did8004/feedback-auth`,
    requestFeedbackAuthExpressHandler(getContext),
  );
  router.post(
    `${basePath}/:did8004/feedback`,
    prepareFeedbackExpressHandler(getContext),
  );
}

