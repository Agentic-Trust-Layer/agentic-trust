import {
  AgentApiError,
  createAgentCore,
  type AgentApiContext,
  updateAgentRegistrationCore,
} from './core';
import type {
  AgentOperationPlan,
  CreateAgentPayload,
  UpdateAgentRegistrationPayload,
} from './types';

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

