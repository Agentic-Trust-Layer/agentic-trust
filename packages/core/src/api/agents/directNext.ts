import { AgentApiError } from './core';
import {
  createAgentDirectCore,
  type DirectAgentApiContext,
} from './directServer';
import type {
  AgentOperationPlan,
  AgentOperationMode,
  DirectCreateAgentPayload,
} from './types';

const hasNativeResponse =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as Record<string, unknown>).Response === 'function';

export type CreateDirectContextFromNext = (
  req: Request,
) => DirectAgentApiContext;

const defaultContextFactory: CreateDirectContextFromNext = () => ({});

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

function handleError(error: unknown) {
  if (error instanceof AgentApiError) {
    return jsonResponse(
      {
        error: error.message,
        details: error.details,
      },
      error.status ?? 400,
    );
  }

  console.error('[AgenticTrust][Next][Direct] Unexpected error:', error);
  return jsonResponse(
    {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    },
    500,
  );
}

function assertMode(mode?: string): mode is AgentOperationMode {
  return mode === 'aa' || mode === 'eoa';
}

export function createAgentDirectRouteHandler(
  defaultMode?: AgentOperationMode,
  createContext: CreateDirectContextFromNext = defaultContextFactory,
) {
  return async (req: Request) => {
    try {
      const body = (await req.json()) as Partial<DirectCreateAgentPayload>;
      const ctx = createContext(req);
      const modeFromBody = typeof body.mode === 'string' ? body.mode : undefined;
      const modeToUse = modeFromBody ?? defaultMode;

      if (!assertMode(modeToUse)) {
        throw new AgentApiError('mode must be either "aa" or "eoa"', 400);
      }

      const result: AgentOperationPlan = await createAgentDirectCore(ctx, {
        ...body,
        mode: modeToUse,
      } as DirectCreateAgentPayload);
      return jsonResponse(result);
    } catch (error) {
      return handleError(error);
    }
  };
}

