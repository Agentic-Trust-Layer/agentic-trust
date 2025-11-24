import {
  AgentApiError,
  createAgentCore,
  type AgentApiContext,
  updateAgentRegistrationCore,
  requestFeedbackAuthCore,
  prepareFeedbackCore,
  getFeedbackCore,
} from './core';
import type {
  AgentOperationPlan,
  CreateAgentPayload,
  UpdateAgentRegistrationPayload,
  RequestFeedbackAuthPayload,
  RequestFeedbackAuthResult,
  PrepareFeedbackPayload,
} from './types';
import { parseDid8004 } from '../../shared/did8004';

type RouteParams = Record<string, string | string[] | undefined>;

const hasNativeResponse =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as Record<string, unknown>).Response === 'function';

export type CreateContextFromNext = (req: Request) => AgentApiContext;

const defaultContextFactory: CreateContextFromNext = () => ({});

function jsonResponse(body: unknown, status = 200) {
  if (hasNativeResponse) {
    const ResponseCtor = (globalThis as Record<string, any>).Response;
    return new ResponseCtor(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  return {
    status,
    body,
    headers: { 'content-type': 'application/json' },
  } as unknown;
}

function handleNextError(error: unknown) {
  if (error instanceof AgentApiError) {
    return jsonResponse(
      {
        error: error.message,
        details: error.details,
      },
      error.status ?? 400,
    );
  }

  console.error('[AgenticTrust][Next] Unexpected error:', error);
  return jsonResponse(
    {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    },
    500,
  );
}

export function createAgentRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (req: Request) => {
    try {
      const input = (await req.json()) as CreateAgentPayload;
      const ctx = createContext(req);
      const result: AgentOperationPlan = await createAgentCore(ctx, input);
      return jsonResponse(result);
    } catch (error) {
      return handleNextError(error);
    }
  };
}

function extractDidParam(params: RouteParams) {
  const candidateKeys = [
    'did:8004',
    'did%3A8004',
    'did8004',
  ];
  for (const key of candidateKeys) {
    const value = params[key];
    if (!value) continue;
    const asString = Array.isArray(value) ? value[0] : value;
    if (typeof asString === 'string' && asString.length > 0) {
      return decodeURIComponent(asString);
    }
  }

  // Fallback: first value
  const firstKey = Object.keys(params)[0];
  if (firstKey) {
    const value = params[firstKey];
    if (value) {
      const asString = Array.isArray(value) ? value[0] : value;
      if (typeof asString === 'string' && asString.length > 0) {
        return decodeURIComponent(asString);
      }
    }
  }
  throw new AgentApiError('Missing did:8004 parameter', 400);
}

export function updateAgentRegistrationRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (
    req: Request,
    context: { params: RouteParams },
  ) => {
    try {
      const did8004 = extractDidParam(context.params || {});
      const body = (await req.json()) as {
        registration: unknown;
        mode?: unknown;
      };
      const ctx = createContext(req);
      const input: UpdateAgentRegistrationPayload = {
        did8004,
        registration: body?.registration,
        mode: typeof body?.mode === 'string' ? (body.mode as any) : undefined,
      };
      const result: AgentOperationPlan =
        await updateAgentRegistrationCore(ctx, input);
      return jsonResponse(result);
    } catch (error) {
      return handleNextError(error);
    }
  };
}

function parseNumberParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function requestFeedbackAuthRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (
    req: Request,
    context?: { params?: RouteParams },
  ) => {
    try {
      const url = new URL(req.url);
      const params = url.searchParams;

      let agentIdParam =
        params.get('agentId') ??
        (context?.params ? extractDidParam(context.params) : undefined);

      const parsedDid =
        agentIdParam && agentIdParam.startsWith('did:8004:')
          ? parseDid8004(agentIdParam)
          : null;

      const input: RequestFeedbackAuthPayload = {
        clientAddress: params.get('clientAddress') ?? '',
        agentId: parsedDid ? parsedDid.agentId : (agentIdParam ?? ''),
        chainId: parsedDid
          ? parsedDid.chainId
          : parseNumberParam(params.get('chainId')),
        indexLimit: parseNumberParam(params.get('indexLimit')),
        expirySeconds:
          parseNumberParam(params.get('expirySec')) ??
          parseNumberParam(params.get('expirySeconds')),
      };

      const ctx = createContext(req);
      const result: RequestFeedbackAuthResult = await requestFeedbackAuthCore(ctx, input);
      return jsonResponse(result);
    } catch (error) {
      return handleNextError(error);
    }
  };
}

export function prepareFeedbackRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (
    req: Request,
    context: { params: RouteParams },
  ) => {
    try {
      const did8004 = extractDidParam(context.params || {});
      const body = (await req.json()) as Omit<PrepareFeedbackPayload, 'did8004'>;
      const ctx = createContext(req);
      const input: PrepareFeedbackPayload = {
        did8004,
        ...body,
      };
      const result: AgentOperationPlan = await prepareFeedbackCore(ctx, input);
      return jsonResponse(result);
    } catch (error) {
      return handleNextError(error);
    }
  };
}

export function getFeedbackRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (
    req: Request,
    context: { params: RouteParams },
  ) => {
    try {
      const did8004 = extractDidParam(context.params || {});

      const url = new URL(req.url);
      const searchParams = url.searchParams;

      const includeRevokedParam = searchParams.get('includeRevoked');
      const includeRevoked =
        includeRevokedParam === 'true' || includeRevokedParam === '1';

      const limit = parseNumberParam(searchParams.get('limit')) ?? 100;
      const offset = parseNumberParam(searchParams.get('offset')) ?? 0;

      const ctx = createContext(req);
      const result = await getFeedbackCore(ctx, {
        did8004,
        includeRevoked,
        limit,
        offset,
      });

      return jsonResponse(result);
    } catch (error) {
      return handleNextError(error);
    }
  };
}

