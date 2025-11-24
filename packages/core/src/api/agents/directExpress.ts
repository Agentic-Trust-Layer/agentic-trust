type ExpressRequestLike = {
  body?: unknown;
  [key: string]: unknown;
};

type ExpressResponseLike = {
  status: (code: number) => ExpressResponseLike;
  json: (body: unknown) => ExpressResponseLike | void;
};

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

export type CreateDirectContextFromExpress = (
  req: ExpressRequestLike,
) => DirectAgentApiContext;

const defaultContextFactory: CreateDirectContextFromExpress = () => ({});

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

  console.error('[AgenticTrust][Express][Direct] Unexpected error:', error);
  sendJson(res, 500, {
    error: 'Internal server error',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}

function assertMode(mode?: string): mode is AgentOperationMode {
  return mode === 'aa' || mode === 'eoa';
}

export function createAgentDirectExpressHandler(
  defaultMode?: AgentOperationMode,
  getContext: CreateDirectContextFromExpress = defaultContextFactory,
) {
  return async (req: ExpressRequestLike, res: ExpressResponseLike) => {
    try {
      const ctx = getContext(req);
      const body = (req.body ?? {}) as Partial<DirectCreateAgentPayload>;
      const modeFromBody = typeof body.mode === 'string' ? body.mode : undefined;
      const modeToUse = modeFromBody ?? defaultMode;

      if (!assertMode(modeToUse)) {
        throw new AgentApiError('mode must be either "aa" or "eoa"', 400);
      }

      const result: AgentOperationPlan = await createAgentDirectCore(ctx, {
        ...body,
        mode: modeToUse,
      } as DirectCreateAgentPayload);
      sendJson(res, 200, result);
    } catch (error) {
      handleExpressError(res, error);
    }
  };
}

