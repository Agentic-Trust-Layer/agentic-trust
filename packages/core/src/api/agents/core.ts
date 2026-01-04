import { zeroAddress } from 'viem';
import { uploadRegistration } from '../../server/lib/agentRegistration';
import { getAgenticTrustClient } from '../../server/lib/agenticTrust';
import { parseDid8004 } from '../../shared/did8004';
import { getChainContractAddress } from '../../server/lib/chainConfig';
import type { AgenticTrustClient } from '../../server/singletons/agenticTrustClient';
import {
  type AgentOperationPlan,
  type AgentOperationMode,
  type CreateAgentPayload,
  type UpdateAgentRegistrationPayload,
  type RequestFeedbackAuthPayload,
  type RequestFeedbackAuthResult,
  type PrepareFeedbackPayload,
  type PrepareValidationRequestPayload,
  type PrepareAssociationRequestPayload,
  type DirectFeedbackPayload,
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
  if (mode !== 'smartAccount' && mode !== 'eoa') {
    throw new AgentApiError('mode must be either "smartAccount" or "eoa"', 400);
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

  if (mode === 'smartAccount') {
    if (!input.account) {
      throw new AgentApiError('account is required for SmartAccount creation', 400);
    }
    assertAddress(input.account, 'account');

    const result = await client.agents.createAgentWithSmartAccountOwnerUsingWallet({
      agentName: input.agentName,
      agentAccount: input.agentAccount as `0x${string}`,
      agentCategory: input.agentCategory,
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
      mode: 'smartAccount',
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
    agentCategory: input.agentCategory,
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
const SUPPORTED_UPDATE_MODES: AgentOperationMode[] = ['smartAccount'];

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

  const mode: AgentOperationMode = input.mode ?? 'smartAccount';
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

  // Enforce: never include MCP endpoint entries in registration JSON.
  try {
    const maybeEndpoints = (registrationObject as any)?.endpoints;
    if (Array.isArray(maybeEndpoints)) {
      (registrationObject as any).endpoints = maybeEndpoints.filter(
        (e: any) => e?.name !== 'MCP',
      );
    }
  } catch {
    // best-effort only
  }

  // If the caller is updating a registration JSON that already includes a registrations[]
  // array, ensure the agentId is populated (common for "finalize after create" flows).
  try {
    const maybeRegistrations = (registrationObject as any)?.registrations;
    if (Array.isArray(maybeRegistrations)) {
      for (const entry of maybeRegistrations) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.agentId === null || typeof entry.agentId === 'undefined') {
          entry.agentId = parsed.agentId;
        }
      }
    } else {
      // If registrations[] is missing entirely, create it so agentId is persisted in tokenUri JSON.
      const registryAddress = getChainContractAddress(
        'AGENTIC_TRUST_IDENTITY_REGISTRY',
        parsed.chainId,
      );
      if (registryAddress) {
        (registrationObject as any).registrations = [
          {
            agentId: parsed.agentId,
            agentRegistry: `eip155:${parsed.chainId}:${String(registryAddress)}`,
            registeredAt: new Date().toISOString(),
          },
        ];
      }
    }
  } catch {
    // best-effort only; never fail the update due to payload shape
  }

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
    mode: 'smartAccount',
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
    return {
      feedbackAuthId: "0x0",
      agentId: "0x0",
      chainId: 0,
    };

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
  const { chainId, transaction } = await agent.prepareGiveFeedback({
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

export async function prepareValidationRequestCore(
  ctx: AgentApiContext | undefined,
  input: PrepareValidationRequestPayload,
): Promise<AgentOperationPlan> {
  if (!input.did8004?.trim()) {
    throw new AgentApiError('did8004 parameter is required', 400);
  }

  const mode: AgentOperationMode = input.mode ?? 'smartAccount';
  if (mode !== 'smartAccount' && mode !== 'eoa') {
    throw new AgentApiError(`Invalid mode "${String(mode)}"`, 400);
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

  // Get validation client
  const { getValidationRegistryClient } = await import('../../server/singletons/validationClient');
  const validationClient = await getValidationRegistryClient(parsed.chainId);

  if (!input.validatorAddress?.trim()) {
    throw new AgentApiError('validatorAddress parameter is required', 400);
  }

  const validatorAddress = input.validatorAddress;


  // Prepare the validation request transaction
  // Type assertion needed because TypeScript may not see the method on the base class type
  const { txRequest, requestHash } = await (validationClient as any).prepareValidationRequestTx({
    agentId: parsed.agentId,        // agentId requesting validation (the agent being validated)
    validatorAddress,               // validatorAddress that performs the validation (the validator)
    requestUri: input.requestUri,   // URI of the request (e.g. https://agentic-trust.org/validation/1)
    requestHash: input.requestHash, // hash of the request (e.g. keccak256 of the requestUri)
  });

  try {
    const existing = await validationClient.getValidationStatus(requestHash);
    const existingValidator = existing?.validatorAddress?.toLowerCase?.();
    if (existingValidator && existingValidator !== zeroAddress && existingValidator !== zeroAddress.toLowerCase()) {
      throw new AgentApiError(
        existingValidator === validatorAddress.toLowerCase()
          ? 'Validation request already exists for this agent and validator. Await the existing request to be processed before submitting another.'
          : 'Validation request with this request hash already exists for a different validator. Provide a unique requestUri/requestHash before retrying.',
        409,
        {
          requestHash,
          existingValidator: existing.validatorAddress,
          existingAgentId: existing.agentId?.toString?.(),
          response: existing.response,
        },
      );
    }
  } catch (error) {
    if (error instanceof AgentApiError) {
      throw error;
    }
    // Ignore read errors (some chains may not support the call yet, or requestHash may not exist yet)
    const err = error as any;
    const short =
      err?.shortMessage ||
      err?.cause?.shortMessage ||
      err?.cause?.reason ||
      err?.reason ||
      err?.message ||
      'Unknown error';

    const name = String(err?.name || err?.cause?.name || '').toLowerCase();
    const msg = String(short).toLowerCase();
    const looksLikeRevert =
      name.includes('contractfunctionexecutionerror') ||
      name.includes('contractfunctionrevertederror') ||
      msg.includes('revert') ||
      msg.includes('reverted');

    // Reverts are expected when there is no prior validation request for this hash.
    if (!looksLikeRevert) {
      console.warn(
        `[prepareValidationRequestCore] Unable to check existing validation status for requestHash=${requestHash}: ${short}`,
      );
    }
  }

  // EOA mode: return a direct transaction payload (no bundler / AA).
  if (mode === 'eoa') {
    const txPayload: AgentPreparedTransactionPayload = {
      to: txRequest.to,
      data: txRequest.data,
      value: normalizeCallValue(txRequest.value),
      chainId: parsed.chainId,
    };

    return {
      success: true,
      operation: 'update',
      mode: 'eoa',
      chainId: parsed.chainId,
      calls: [],
      transaction: txPayload,
      metadata: {
        validatorAddress,
        requestHash,
      },
    };
  }

  // SmartAccount mode: return calls + bundlerUrl for a sponsored UserOp.
  const bundlerUrl = getChainBundlerUrl(parsed.chainId);
  if (!bundlerUrl) {
    throw new AgentApiError(`Bundler URL not configured for chain ${parsed.chainId}`, 500);
  }

  const call: AgentOperationCall = {
    to: txRequest.to,
    data: txRequest.data,
    value: normalizeCallValue(txRequest.value),
  };

  return {
    success: true,
    operation: 'update',
    mode: 'smartAccount',
    chainId: parsed.chainId,
    bundlerUrl,
    calls: [call],
    transaction: undefined,
    metadata: {
      validatorAddress,
      requestHash,
    },
  };
}

export async function prepareAssociationRequestCore(
  ctx: AgentApiContext | undefined,
  input: PrepareAssociationRequestPayload,
): Promise<AgentOperationPlan> {
  if (!input.did8004?.trim()) {
    throw new AgentApiError('did8004 parameter is required', 400);
  }

  const mode: AgentOperationMode = input.mode ?? 'smartAccount';
  if (mode !== 'smartAccount' && mode !== 'eoa') {
    throw new AgentApiError(`Invalid mode "${String(mode)}"`, 400);
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

  if (!agent.agentAccount && !input.initiatorAddress) {
    throw new AgentApiError('Agent must have an agentAccount address', 400);
  }

  // Validate approver address
  if (!input.approverAddress?.trim()) {
    throw new AgentApiError('approverAddress parameter is required', 400);
  }

  const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
  if (!ADDRESS_REGEX.test(input.approverAddress)) {
    throw new AgentApiError('approverAddress must be a valid Ethereum address (0x...)', 400);
  }

  const initiatorAddress = (input.initiatorAddress ?? agent.agentAccount) as `0x${string}`;
  const approverAddress = input.approverAddress as `0x${string}`;

  // Get associations client
  const { getAssociationsClient } = await import('../../server/singletons/associationClient');
  const associationsClient = await getAssociationsClient(parsed.chainId);

  // Encode association metadata if provided
  const { encodeAssociationData } = await import('../../server/lib/association');
  let associationData: `0x${string}` =
    (input.data as `0x${string}` | undefined) ?? ('0x' as `0x${string}`);
  if (!input.data && input.assocType !== undefined && typeof input.description !== 'undefined') {
    associationData = encodeAssociationData({
      assocType: input.assocType,
      description: input.description ?? '',
    });
  }

  // Build the signed association record
  // Note: For smart accounts, signatures are handled via ERC-1271
  // The transaction will be signed client-side using the account abstraction
  // We create the record structure here, but the actual signature happens during execution
  const now = typeof input.validAt === 'number' ? input.validAt : Math.floor(Date.now() / 1000);
  
  // formatEvmV1: Create ERC-7930 interoperable address format using ethers
  // Format: 0x00010000 || uint8(chainRef.length) || chainRef || uint8(20) || address
  const { ethers } = await import('ethers');
  
  const toMinimalBigEndianBytes = (n: bigint): Uint8Array => {
    if (n === 0n) return new Uint8Array([0]);
    let hex = n.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    return ethers.getBytes(`0x${hex}`);
  };
  
  const formatEvmV1 = (chainId: number, address: string): string => {
    const addr = ethers.getAddress(address);
    const chainRef = toMinimalBigEndianBytes(BigInt(chainId));
    const head = ethers.getBytes('0x00010000');
    const out = ethers.concat([
      head,
      new Uint8Array([chainRef.length]),
      chainRef,
      new Uint8Array([20]),
      ethers.getBytes(addr),
    ]);
    return ethers.hexlify(out);
  };
  
  const initiator = formatEvmV1(parsed.chainId, initiatorAddress);
  const approver = formatEvmV1(parsed.chainId, approverAddress);

  const record = {
    initiator,
    approver,
    validAt: now,
    validUntil: 0, // No expiry by default
    interfaceId: '0x00000000' as `0x${string}`,
    data: associationData,
  };

  // Create SignedAssociationRecord with empty signatures (will be signed client-side via AA)
  const sar: any = {
    revokedAt: 0,
    // IMPORTANT:
    // Use K1 (0x0001) so the ERC-8092 reference implementation validates signatures via
    // OpenZeppelin SignatureChecker, which supports both EOAs and standard ERC-1271 smart accounts.
    // The ERC-8092 POC's ERC1271 keytype uses a bool-returning IERC1271 interface, which is not
    // compatible with the widely-used bytes4-magic ERC-1271 implementations.
    initiatorKeyType: '0x0001' as `0x${string}`, // K1 / ECDSA secp256k1
    approverKeyType: '0x0001' as `0x${string}`, // K1 / ECDSA secp256k1
    initiatorSignature:
      (input.initiatorSignature as `0x${string}` | undefined) ?? ('0x' as `0x${string}`),
    approverSignature:
      (input.approverSignature as `0x${string}` | undefined) ?? ('0x' as `0x${string}`),
    record,
  };

  // Prepare the storeAssociation transaction
  // The association client will encode the call, but signatures happen during AA execution
  const { txRequest } = await associationsClient.prepareStoreAssociationTx({ sar } as any);

  // EOA mode: return a direct transaction payload (no bundler / AA).
  if (mode === 'eoa') {
    const txPayload: AgentPreparedTransactionPayload = {
      to: txRequest.to,
      data: txRequest.data,
      value: normalizeCallValue(txRequest.value),
      chainId: parsed.chainId,
    };
    return {
      success: true,
      operation: 'update',
      mode: 'eoa',
      chainId: parsed.chainId,
      calls: [],
      transaction: txPayload,
      metadata: {
        initiatorAddress,
        approverAddress,
        assocType: input.assocType,
        description: input.description,
      },
    };
  }

  // SmartAccount mode: return calls + bundlerUrl for a sponsored UserOp.
  const bundlerUrl = getChainBundlerUrl(parsed.chainId);
  if (!bundlerUrl) {
    throw new AgentApiError(`Bundler URL not configured for chain ${parsed.chainId}`, 500);
  }

  const call: AgentOperationCall = {
    to: txRequest.to,
    data: txRequest.data,
    value: normalizeCallValue(txRequest.value),
  };

  return {
    success: true,
    operation: 'update',
    mode: 'smartAccount',
    chainId: parsed.chainId,
    bundlerUrl,
    calls: [call],
    transaction: undefined,
    metadata: {
      initiatorAddress,
      approverAddress,
      assocType: input.assocType,
      description: input.description,
    },
  };
}

function jsonSafeDeep(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafeDeep(item));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = jsonSafeDeep(v);
    }
    return result;
  }
  return value;
}

export interface GetFeedbackInput {
  did8004: string;
  includeRevoked?: boolean;
  limit?: number;
  offset?: number;
}

export interface GetFeedbackResult {
  feedback: unknown;
  summary: unknown;
}

export async function getFeedbackCore(
  ctx: AgentApiContext | undefined,
  input: GetFeedbackInput,
): Promise<GetFeedbackResult> {
  if (!input.did8004?.trim()) {
    throw new AgentApiError('did8004 parameter is required', 400);
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

  const includeRevoked = !!input.includeRevoked;
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? input.limit
      : 100;
  const offset =
    typeof input.offset === 'number' && Number.isFinite(input.offset)
      ? input.offset
      : 0;

  const client = await resolveClient(ctx);

  const [feedback, summary] = await Promise.all([
    client.getAgentFeedback({
      agentId: parsed.agentId,
      chainId: parsed.chainId,
      includeRevoked,
      limit,
      offset,
    }),
    client
      .getReputationSummary({
        agentId: parsed.agentId,
        chainId: parsed.chainId,
      })
      .catch((error: unknown) => {
        // Preserve previous behavior: log and return null on summary failure
        // eslint-disable-next-line no-console
        console.warn(
          '[AgenticTrust][Core] getReputationSummary failed:',
          error,
        );
        return null;
      }),
  ]);

  return {
    feedback: jsonSafeDeep(feedback),
    summary: jsonSafeDeep(summary),
  };
}

export interface DirectFeedbackResult {
  success: true;
  txHash: string;
}

export async function submitFeedbackDirectCore(
  ctx: AgentApiContext | undefined,
  input: DirectFeedbackPayload,
): Promise<DirectFeedbackResult> {
  const client = await resolveClient(ctx);

  let agentId: string | undefined =
    typeof input.agentId === 'number'
      ? input.agentId.toString()
      : input.agentId?.toString();
  let chainId: number | undefined =
    typeof input.chainId === 'number' && Number.isFinite(input.chainId)
      ? input.chainId
      : undefined;

  if (input.did8004 && input.did8004.trim()) {
    const parsed = (() => {
      try {
        return parseDid8004(input.did8004 as string);
      } catch (error) {
        throw new AgentApiError(
          `Invalid did:8004 identifier: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          400,
        );
      }
    })();
    agentId = parsed.agentId.toString();
    chainId = parsed.chainId;
  }

  if (!agentId) {
    throw new AgentApiError('agentId or did8004 is required', 400);
  }

  const resolvedChainId =
    typeof chainId === 'number' && Number.isFinite(chainId)
      ? chainId
      : DEFAULT_CHAIN_ID;

  const agent = await client.getAgent(agentId.toString(), resolvedChainId);
  if (!agent) {
    throw new AgentApiError('Agent not found', 404, {
      agentId,
      chainId: resolvedChainId,
    });
  }

  const numericScore =
    typeof input.score === 'number'
      ? input.score
      : Number.parseInt(input.score as string, 10);

  if (!Number.isFinite(numericScore)) {
    throw new AgentApiError('Invalid score value', 400);
  }

  try {
    const feedbackResult = await agent.giveFeedback({
      ...(input.clientAddress && {
        clientAddress: input.clientAddress as `0x${string}`,
      }),
      score: numericScore,
      feedback:
        input.feedback && input.feedback.length > 0
          ? input.feedback
          : 'Feedback submitted via direct endpoint',
      feedbackAuth: input.feedbackAuth,
      tag1: input.tag1,
      tag2: input.tag2,
      feedbackUri: input.feedbackUri,
      feedbackHash: input.feedbackHash,
      skill: input.skill,
      context: input.context,
      capability: input.capability,
    });

    return {
      success: true,
      txHash: feedbackResult.txHash,
    };
  } catch (error) {
    throw new AgentApiError(
      error instanceof Error ? error.message : 'Failed to submit feedback',
      502,
      {
        agentId,
        chainId: resolvedChainId,
      },
    );
  }
}

