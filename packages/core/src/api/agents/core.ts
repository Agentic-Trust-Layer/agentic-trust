import { uploadRegistration } from '../../server/lib/agentRegistration';
import { getAgenticTrustClient } from '../../server/lib/agenticTrust';
import { parseDid8004 } from '../../shared/did8004';
import type { AgenticTrustClient } from '../../server/singletons/agenticTrustClient';
import {
  type AgentOperationPlan,
  type AgentOperationMode,
  type CreateAgentPayload,
  type UpdateAgentRegistrationPayload,
  type RequestFeedbackAuthPayload,
  type RequestFeedbackAuthResult,
  type PrepareFeedbackPayload,
  type AgentOperationCall,
  type AgentPreparedTransactionPayload,
} from './types';
import { DEFAULT_CHAIN_ID, getChainBundlerUrl } from '../../server/lib/chainConfig';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export class AgentApiError extends Error {
  constructor(
    message: string,
    public status: number = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AgentApiError';
  }
}

export interface AgentApiContext {
  tenantId?: string;
  requestId?: string;
  /**
   * Optional override for providing a pre-configured AgenticTrustClient.
   * Falls back to the shared singleton if not provided.
   */
  getClient?: () => Promise<AgenticTrustClient>;
}

async function resolveClient(ctx?: AgentApiContext): Promise<AgenticTrustClient> {
  if (ctx?.getClient) {
    return ctx.getClient();
  }
  return getAgenticTrustClient();
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== 'string' || !ADDRESS_REGEX.test(value)) {
    throw new AgentApiError(
      `${field} must be a valid Ethereum address (0x...)`,
      400,
    );
  }
}

function assertMode(mode: string | undefined): asserts mode is AgentOperationMode {
  if (mode !== 'aa' && mode !== 'eoa') {
    throw new AgentApiError('mode must be either "aa" or "eoa"', 400);
  }
}

function normalizeCallValue(value: unknown): string {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return '0';
}

function normalizeCalls(rawCalls?: Array<{ to?: string; data?: string; value?: unknown }>): AgentOperationCall[] {
  if (!Array.isArray(rawCalls)) {
    return [];
  }

  return rawCalls.map((call) => {
    if (!call?.to || !call?.data) {
      throw new AgentApiError('Invalid call returned from agent preparation', 500, {
        call,
      });
    }
    return {
      to: call.to,
      data: call.data,
      value: normalizeCallValue(call.value),
    };
  });
}

function normalizeTransactionPayload(
  tx: unknown,
  fallbackChainId: number,
): AgentPreparedTransactionPayload {
  if (
    !tx ||
    typeof tx !== 'object' ||
    !(tx as Record<string, unknown>).to ||
    !(tx as Record<string, unknown>).data
  ) {
    throw new AgentApiError('Invalid transaction payload produced by server', 500, {
      tx,
    });
  }

  const payload = tx as Record<string, unknown>;
  const chainId =
    typeof payload.chainId === 'number' && Number.isFinite(payload.chainId)
      ? (payload.chainId as number)
      : fallbackChainId;

  return {
    to: payload.to as string,
    data: payload.data as string,
    value: normalizeCallValue(payload.value),
    gas: typeof payload.gas === 'string' ? payload.gas : undefined,
    gasPrice: typeof payload.gasPrice === 'string' ? payload.gasPrice : undefined,
    maxFeePerGas:
      typeof payload.maxFeePerGas === 'string' ? payload.maxFeePerGas : undefined,
    maxPriorityFeePerGas:
      typeof payload.maxPriorityFeePerGas === 'string'
        ? payload.maxPriorityFeePerGas
        : undefined,
    nonce: typeof payload.nonce === 'number' ? payload.nonce : undefined,
    chainId,
  };
}

export async function createAgentCore(
  ctx: AgentApiContext | undefined,
  input: CreateAgentPayload,
): Promise<AgentOperationPlan> {
  if (!input.agentName?.trim()) {
    throw new AgentApiError('agentName is required', 400);
  }

  if (!input.agentAccount) {
    throw new AgentApiError('agentAccount is required', 400);
  }
  assertAddress(input.agentAccount, 'agentAccount');

  assertMode(input.mode);
  const mode = input.mode;

  const chainId =
    typeof input.chainId === 'number' && Number.isFinite(input.chainId)
      ? input.chainId
      : DEFAULT_CHAIN_ID;

  const client = await resolveClient(ctx);

  if (mode === 'aa') {
    if (!input.account) {
      throw new AgentApiError('account is required for AA creation', 400);
    }
    assertAddress(input.account, 'account');

    const result = await client.agents.createAgentForAA({
      agentName: input.agentName,
      agentAccount: input.agentAccount as `0x${string}`,
      description: input.description,
      image: input.image,
      agentUrl: input.agentUrl,
      supportedTrust: input.supportedTrust,
      endpoints: input.endpoints,
      chainId,
    });

    return {
      success: true,
      operation: 'create',
      mode: 'aa',
      chainId: result.chainId,
      tokenUri: result.tokenUri,
      bundlerUrl: result.bundlerUrl,
      calls: normalizeCalls(result.calls),
      transaction: null,
    };
  }

  const createResult = await client.createAgent({
    ownerType: 'eoa',
    executionMode: 'client',
    agentName: input.agentName,
    agentAccount: input.agentAccount as `0x${string}`,
    description: input.description,
    image: input.image,
    agentUrl: input.agentUrl,
    supportedTrust: input.supportedTrust,
    endpoints: input.endpoints,
    chainId,
  });

  const clientResult = createResult as {
    requiresClientSigning?: boolean;
    transaction?: Record<string, unknown>;
    tokenUri?: string;
  };

  if (!clientResult.requiresClientSigning || !clientResult.transaction) {
    throw new AgentApiError(
      'Server was unable to generate client-side transaction for EOA agent creation',
      500,
      clientResult,
    );
  }

  const transaction = normalizeTransactionPayload(clientResult.transaction, chainId);

  return {
    success: true,
    operation: 'create',
    mode: 'eoa',
    chainId: transaction.chainId,
    tokenUri: clientResult.tokenUri,
    calls: [],
    transaction,
  };
}
const SUPPORTED_UPDATE_MODES: AgentOperationMode[] = ['aa'];

function normalizeRegistrationPayload(
  registration: unknown,
): Record<string, unknown> {
  if (!registration) {
    throw new AgentApiError('registration payload is required', 400);
  }
  if (typeof registration === 'string') {
    try {
      return JSON.parse(registration);
    } catch (error) {
      throw new AgentApiError(
        `Invalid registration JSON string: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        400,
      );
    }
  }
  if (typeof registration === 'object') {
    return registration as Record<string, unknown>;
  }
  throw new AgentApiError(
    'registration must be a JSON object or stringified JSON',
    400,
  );
}

export async function updateAgentRegistrationCore(
  ctx: AgentApiContext | undefined,
  input: UpdateAgentRegistrationPayload,
): Promise<AgentOperationPlan> {
  if (!input.did8004?.trim()) {
    throw new AgentApiError('did8004 parameter is required', 400);
  }

  const mode: AgentOperationMode = input.mode ?? 'aa';
  if (!SUPPORTED_UPDATE_MODES.includes(mode)) {
    throw new AgentApiError(
      `mode "${mode}" is not supported for registration updates`,
      400,
    );
  }

  const parsed = (() => {
    try {
      return parseDid8004(input.did8004);
    } catch (error) {
      throw new AgentApiError(
        `Invalid did:8004 identifier: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        400,
      );
    }
  })();

  const registrationObject = normalizeRegistrationPayload(input.registration);
  const uploadResult = await uploadRegistration(registrationObject as any);

  const client = await resolveClient(ctx);
  const prepared = await client.prepareUpdateAgent({
    agentId: parsed.agentId,
    chainId: parsed.chainId,
    tokenUri: uploadResult.tokenUri,
  });

  return {
    success: true,
    operation: 'update',
    mode: 'aa',
    chainId: prepared.chainId,
    cid: uploadResult.cid,
    tokenUri: uploadResult.tokenUri,
    identityRegistry: prepared.identityRegistry,
    bundlerUrl: prepared.bundlerUrl,
    calls: normalizeCalls(prepared.calls),
    transaction: null,
  };
}

export async function requestFeedbackAuthCore(
  ctx: AgentApiContext | undefined,
  input: RequestFeedbackAuthPayload,
): Promise<RequestFeedbackAuthResult> {
  const clientAddress = input.clientAddress?.toLowerCase();
  if (
    !clientAddress ||
    typeof clientAddress !== 'string' ||
    !ADDRESS_REGEX.test(clientAddress)
  ) {
    throw new AgentApiError(
      'clientAddress must be a valid 0x-prefixed 20-byte address',
      400,
    );
  }

  const agentId = input.agentId?.toString().trim();
  if (!agentId) {
    throw new AgentApiError('agentId is required', 400);
  }

  const chainId =
    typeof input.chainId === 'number' && Number.isFinite(input.chainId)
      ? input.chainId
      : DEFAULT_CHAIN_ID;

  const client = await resolveClient(ctx);
  const agent = await client.getAgent(agentId, chainId);
  if (!agent) {
    throw new AgentApiError('Agent not found', 404, { agentId, chainId });
  }

  try {
    const feedbackAuth = await agent.getFeedbackAuth({
      clientAddress: clientAddress as `0x${string}`,
      agentId,
      chainId,
      indexLimit: input.indexLimit,
      expirySeconds: input.expirySeconds,
    });

    return {
      feedbackAuthId: feedbackAuth.feedbackAuthId,
      agentId: feedbackAuth.agentId,
      chainId: feedbackAuth.chainId,
    };
  } catch (error) {
    throw new AgentApiError(
      error instanceof Error ? error.message : 'Failed to get feedback auth',
      502,
      {
        agentId,
        chainId,
      },
    );
  }
}

export async function prepareFeedbackCore(
  ctx: AgentApiContext | undefined,
  input: PrepareFeedbackPayload,
): Promise<AgentOperationPlan> {
  if (!input.did8004?.trim()) {
    throw new AgentApiError('did8004 parameter is required', 400);
  }

  const mode: AgentOperationMode = input.mode ?? 'eoa';
  if (mode !== 'eoa') {
    throw new AgentApiError(
      `mode "${mode}" is not supported for feedback submission. Only "eoa" mode is supported.`,
      400,
    );
  }

  const parsed = (() => {
    try {
      return parseDid8004(input.did8004);
    } catch (error) {
      throw new AgentApiError(
        `Invalid did:8004 identifier: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        400,
      );
    }
  })();

  const client = await resolveClient(ctx);
  const agent = await client.getAgent(parsed.agentId.toString(), parsed.chainId);
  if (!agent) {
    throw new AgentApiError('Agent not found', 404, { did8004: input.did8004 });
  }

  // Prepare the feedback transaction (EOA-friendly payload)
  const { chainId, transaction } = await agent.prepareGiveFeedbackTransaction({
    score: input.score,
    feedback: input.feedback,
    feedbackAuth: input.feedbackAuth,
    ...(input.clientAddress && {
      clientAddress: input.clientAddress as `0x${string}`,
    }),
    tag1: input.tag1,
    tag2: input.tag2,
    feedbackUri: input.feedbackUri,
    feedbackHash: input.feedbackHash,
    skill: input.skill,
    context: input.context,
    capability: input.capability,
  });

  // Map PreparedTransaction into AgentPreparedTransactionPayload
  const txPayload: AgentPreparedTransactionPayload = {
    to: transaction.to,
    data: transaction.data,
    value: transaction.value || '0x0',
    gas: transaction.gas,
    gasPrice: transaction.gasPrice,
    maxFeePerGas: transaction.maxFeePerGas,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    nonce: transaction.nonce,
    chainId,
  };

  return {
    success: true,
    operation: 'update',
    mode: 'eoa',
    chainId,
    calls: [],
    transaction: txPayload,
  };
}

