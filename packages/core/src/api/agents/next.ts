import {
  AgentApiError,
  createAgentCore,
  type AgentApiContext,
  updateAgentRegistrationCore,
  requestFeedbackAuthCore,
  prepareFeedbackCore,
  prepareValidationRequestCore,
  prepareAssociationRequestCore,
  getFeedbackCore,
  submitFeedbackDirectCore,
} from './core';
import { getValidationsCore } from './validations';
import type {
  AgentOperationPlan,
  CreateAgentPayload,
  UpdateAgentRegistrationPayload,
  RequestFeedbackAuthPayload,
  RequestFeedbackAuthResult,
  PrepareFeedbackPayload,
  PrepareValidationRequestPayload,
  PrepareAssociationRequestPayload,
  DirectFeedbackPayload,
} from './types';
import { parseDid8004 } from '../../shared/did8004';
import { parseHcs14UaidDidTarget } from '../../server/lib/uaid';
import { getDiscoveryClient } from '../../server/singletons/discoveryClient';

type RouteParams = Record<string, string | string[] | undefined>;

const hasNativeResponse =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as Record<string, unknown>).Response === 'function';

export type CreateContextFromNext = (req: Request) => AgentApiContext;

const defaultContextFactory: CreateContextFromNext = () => ({});

// Recursively convert BigInt and other non-JSON-safe values into JSON-safe forms.
function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toJsonSafe(v);
    }
    return result;
  }

  return value;
}

function jsonResponse(body: unknown, status = 200) {
  const safeBody = toJsonSafe(body);

  if (hasNativeResponse) {
    const ResponseCtor = (globalThis as Record<string, any>).Response;
    return new ResponseCtor(JSON.stringify(safeBody), {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  return {
    status,
    body: safeBody,
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

function extractAgentIdentifierParam(params: RouteParams) {
  const candidateKeys = [
    'uaid',
    'uaid%3Adid',
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
  throw new AgentApiError('Missing agent identifier parameter (uaid or did:8004)', 400);
}

async function resolveUaidToDid8004(uaid: string): Promise<string | null> {
  const trimmed = String(uaid ?? '').trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('uaid:')) return null;

  try {
    const parsed = parseHcs14UaidDidTarget(trimmed);
    if (parsed.targetDid.startsWith('did:8004:')) {
      return parsed.targetDid;
    }
  } catch {
    // ignore and try KB lookup
  }

  try {
    const discoveryClient: any = await getDiscoveryClient();
    const agent = await discoveryClient.getAgentByUaid?.(trimmed);
    const didIdentity = typeof agent?.didIdentity === 'string' ? agent.didIdentity : null;
    if (didIdentity && didIdentity.startsWith('did:8004:')) {
      return didIdentity;
    }
    const chainId = typeof agent?.chainId === 'number' ? agent.chainId : null;
    const agentId8004 =
      typeof agent?.agentId === 'string' || typeof agent?.agentId === 'number'
        ? String(agent.agentId)
        : null;
    if (chainId && agentId8004 && /^\d+$/.test(agentId8004)) {
      return `did:8004:${chainId}:${agentId8004}`;
    }
  } catch {
    // ignore
  }

  return null;
}

export function updateAgentRegistrationRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (
    req: Request,
    context: { params: RouteParams },
  ) => {
    try {
      const agentIdentifier = extractAgentIdentifierParam(context.params || {});
      const did8004 =
        agentIdentifier.startsWith('uaid:')
          ? await resolveUaidToDid8004(agentIdentifier)
          : agentIdentifier;
      if (!did8004 || !did8004.startsWith('did:8004:')) {
        throw new AgentApiError(
          'UAID does not resolve to did:8004; on-chain operation unavailable for this agent',
          400,
        );
      }
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
      console.log(">>>>>>>>>>>>> feedback auth request: ", req);
      const url = new URL(req.url);
      const params = url.searchParams;

      const isPost = String(req.method || 'GET').toUpperCase() === 'POST';
      const body = isPost
        ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
        : {};

      let agentIdParam =
        (isPost && typeof body.agentId === 'string' ? (body.agentId as string) : null) ??
        params.get('agentId') ??
        (context?.params ? extractAgentIdentifierParam(context.params) : undefined);

      if (agentIdParam && agentIdParam.startsWith('uaid:')) {
        const did8004 = await resolveUaidToDid8004(agentIdParam);
        if (did8004) {
          agentIdParam = did8004;
        }
      }

      const parsedDid =
        agentIdParam && agentIdParam.startsWith('did:8004:')
          ? parseDid8004(agentIdParam)
          : null;

      const input: RequestFeedbackAuthPayload = {
        clientAddress:
          (isPost && typeof body.clientAddress === 'string' ? (body.clientAddress as string) : null) ??
          params.get('clientAddress') ??
          '',
        agentId: parsedDid ? parsedDid.agentId : (agentIdParam ?? ''),
        chainId: parsedDid
          ? parsedDid.chainId
          : (isPost && typeof body.chainId !== 'undefined'
              ? parseNumberParam(String(body.chainId))
              : parseNumberParam(params.get('chainId'))),
        indexLimit:
          isPost && typeof body.indexLimit !== 'undefined'
            ? parseNumberParam(String(body.indexLimit))
            : parseNumberParam(params.get('indexLimit')),
        expirySeconds:
          (isPost && typeof body.expirySeconds !== 'undefined'
            ? parseNumberParam(String(body.expirySeconds))
            : undefined) ??
          (isPost && typeof body.expirySec !== 'undefined'
            ? parseNumberParam(String(body.expirySec))
            : undefined) ??
          parseNumberParam(params.get('expirySec')) ??
          parseNumberParam(params.get('expirySeconds')),
        delegationSar: isPost ? (body as any).delegationSar : undefined,
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
      const agentIdentifier = extractAgentIdentifierParam(context.params || {});
      const did8004 =
        agentIdentifier.startsWith('uaid:')
          ? await resolveUaidToDid8004(agentIdentifier)
          : agentIdentifier;
      if (!did8004 || !did8004.startsWith('did:8004:')) {
        throw new AgentApiError(
          'UAID does not resolve to did:8004; on-chain operation unavailable for this agent',
          400,
        );
      }
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

export function prepareValidationRequestRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (
    req: Request,
    context: { params: RouteParams },
  ) => {
    try {
      const agentIdentifier = extractAgentIdentifierParam(context.params || {});
      const did8004 =
        agentIdentifier.startsWith('uaid:')
          ? await resolveUaidToDid8004(agentIdentifier)
          : agentIdentifier;
      if (!did8004 || !did8004.startsWith('did:8004:')) {
        throw new AgentApiError(
          'UAID does not resolve to did:8004; on-chain operation unavailable for this agent',
          400,
        );
      }
      const body = (await req.json()) as Omit<PrepareValidationRequestPayload, 'did8004'>;
      const ctx = createContext(req);
      const input: PrepareValidationRequestPayload = {
        did8004,
        ...body,
      };
      const result: AgentOperationPlan = await prepareValidationRequestCore(ctx, input);
      return jsonResponse(result);
    } catch (error) {
      return handleNextError(error);
    }
  };
}

export function prepareAssociationRequestRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (
    req: Request,
    context: { params: RouteParams },
  ) => {
    try {
      const agentIdentifier = extractAgentIdentifierParam(context.params || {});
      const did8004 =
        agentIdentifier.startsWith('uaid:')
          ? await resolveUaidToDid8004(agentIdentifier)
          : agentIdentifier;
      if (!did8004 || !did8004.startsWith('did:8004:')) {
        throw new AgentApiError(
          'UAID does not resolve to did:8004; on-chain operation unavailable for this agent',
          400,
        );
      }
      const body = (await req.json()) as Omit<PrepareAssociationRequestPayload, 'did8004'>;
      const ctx = createContext(req);
      const input: PrepareAssociationRequestPayload = {
        did8004,
        ...body,
      };
      const result: AgentOperationPlan = await prepareAssociationRequestCore(ctx, input);
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
      const agentIdentifier = extractAgentIdentifierParam(context.params || {});
      const did8004 =
        agentIdentifier.startsWith('uaid:')
          ? await resolveUaidToDid8004(agentIdentifier)
          : agentIdentifier;
      if (!did8004 || !did8004.startsWith('did:8004:')) {
        throw new AgentApiError(
          'UAID does not resolve to did:8004; on-chain operation unavailable for this agent',
          400,
        );
      }

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

export function directFeedbackRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (
    req: Request,
    context: { params: RouteParams },
  ) => {
    try {
      const agentIdentifier = extractAgentIdentifierParam(context.params || {});
      const did8004 =
        agentIdentifier.startsWith('uaid:')
          ? await resolveUaidToDid8004(agentIdentifier)
          : agentIdentifier;
      if (!did8004 || !did8004.startsWith('did:8004:')) {
        throw new AgentApiError(
          'UAID does not resolve to did:8004; on-chain operation unavailable for this agent',
          400,
        );
      }
      const body = (await req.json()) as Omit<DirectFeedbackPayload, 'did8004'>;
      const ctx = createContext(req);
      const input: DirectFeedbackPayload = {
        did8004,
        ...body,
      };
      const result = await submitFeedbackDirectCore(ctx, input);
      return jsonResponse(result);
    } catch (error) {
      return handleNextError(error);
    }
  };
}

export function getValidationsRouteHandler(
  createContext: CreateContextFromNext = defaultContextFactory,
) {
  return async (
    req: Request,
    context: { params: RouteParams },
  ) => {
    try {
      const agentIdentifier = extractAgentIdentifierParam(context.params || {});
      const did8004 =
        agentIdentifier.startsWith('uaid:')
          ? await resolveUaidToDid8004(agentIdentifier)
          : agentIdentifier;
      if (!did8004 || !did8004.startsWith('did:8004:')) {
        throw new AgentApiError(
          'UAID does not resolve to did:8004; on-chain operation unavailable for this agent',
          400,
        );
      }
      const parsed = parseDid8004(did8004);
      const ctx = createContext(req);
      const result = await getValidationsCore(ctx, {
        chainId: parsed.chainId,
        agentId: parsed.agentId,
      });
      console.log('[getValidationsRouteHandler] Result:', {
        did8004,
        chainId: parsed.chainId,
        agentId: parsed.agentId,
        result,
        pendingType: typeof result.pending,
        completedType: typeof result.completed,
        pendingIsArray: Array.isArray(result.pending),
        completedIsArray: Array.isArray(result.completed),
        pendingLength: Array.isArray(result.pending) ? result.pending.length : 'N/A',
        completedLength: Array.isArray(result.completed) ? result.completed.length : 'N/A',
      });
      return jsonResponse(result);
    } catch (error) {
      return handleNextError(error);
    }
  };
}

