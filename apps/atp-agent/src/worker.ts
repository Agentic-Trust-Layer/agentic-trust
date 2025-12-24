/**
 * Cloudflare Worker entry point for ATP Agent
 * 
 * Uses Hono framework (Express-like, Worker-compatible) to handle A2A requests
 */

import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import {
  getAgenticTrustClient,
  loadSessionPackage,
  getENSClient,
  isENSNameAvailable,
  DEFAULT_CHAIN_ID,
  type SessionPackage,
} from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';
import { getD1Database, getIndexerD1Database, type D1Database } from './lib/d1-wrapper';

/**
 * Recursively convert BigInt values to strings for JSON serialization
 */
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }
  
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value);
    }
    return result;
  }
  
  return obj;
}

/**
 * Normalize DID strings that may arrive URL-encoded (e.g. "did%3A8004%3A...").
 * We accept both encoded and decoded forms, but standardize to decoded.
 */
function normalizeDid(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let out = raw;
  // Handle 0..2 rounds of percent-decoding to cover did%3A... and did%253A...
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch {
      break;
    }
  }
  // Fallback for partially-encoded values
  return out.replace(/%3A/gi, ':');
}

/**
 * Extract subdomain (e.g. "abc" from "abc.8004-agent.io")
 */
function extractSubdomain(hostname: string | undefined, baseDomain: string): string | null {
  if (!hostname) return null;

  const hostNoPort = hostname.split(':')[0].toLowerCase();
  const base = baseDomain.toLowerCase();

  if (!hostNoPort.endsWith(base)) {
    return null;
  }

  const withoutBase = hostNoPort.slice(0, -base.length);
  const trimmed = withoutBase.replace(/\.$/, '');

  if (!trimmed) return null;

  return trimmed;
}

/**
 * CORS headers helper
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * A2A "Task" primitives
 * - Tasks are long-lived threads (a conversation) and messages are events within a task.
 * - We keep legacy context_type/context_id fields, but also persist explicit task_id/task_type.
 */
const ATP_TASK_TYPES = [
  'feedback_auth_request',
  'validation_request',
  'association_request',
  'feedback_request_approved',
] as const;
type ATPTaskType = (typeof ATP_TASK_TYPES)[number];

function normalizeTaskType(value: unknown): ATPTaskType | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  return (ATP_TASK_TYPES as readonly string[]).includes(v) ? (v as ATPTaskType) : null;
}

function generateTaskId(prefix: string = 'task'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

let tasksSchemaEnsured = false;
async function ensureTasksSchema(db: D1Database): Promise<void> {
  if (tasksSchemaEnsured) return;

  // Tasks table (thread metadata)
  // NOTE: Cloudflare D1 `exec()` can be fragile with multi-statement SQL in some runtimes;
  // also avoid `exec()` entirely (Cloudflare internal tracing can crash when aggregating exec meta).
  const ddl: string[] = [
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      subject TEXT NULL,
      from_agent_did TEXT NULL,
      from_agent_name TEXT NULL,
      to_agent_did TEXT NULL,
      to_agent_name TEXT NULL,
      from_client_address TEXT NULL,
      to_client_address TEXT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_message_at INTEGER NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_from_agent_did ON tasks(from_agent_did);`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_to_agent_did ON tasks(to_agent_did);`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_last_message_at ON tasks(last_message_at);`,
  ];

  for (const stmt of ddl) {
    await db.prepare(stmt).run();
  }

  // Add explicit task columns to messages (safe to attempt repeatedly; ignore "duplicate column" errors).
  try {
    await db.prepare('ALTER TABLE messages ADD COLUMN task_id TEXT NULL;').run();
  } catch {}
  try {
    await db.prepare('ALTER TABLE messages ADD COLUMN task_type TEXT NULL;').run();
  } catch {}
  try {
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);').run();
  } catch {}

  tasksSchemaEnsured = true;
}

// Define Hono app types
type Env = {
  DB: D1Database;
  INDEXER_DB?: D1Database;
  [key: string]: any;
};

type Variables = {
  providerSubdomain?: string | null;
  providerEnsName?: string | null;
  providerAgentAccount?: string | null;
};

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

// Create Hono app
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS middleware
app.use('*', cors());

// Middleware to extract subdomain and resolve ENS
app.use('*', async (c: HonoContext, next: Next) => {
  try {
    // Ensure core helpers (ENS client, etc.) can read required env vars.
    if (c.env) {
      syncEnvVars(c.env);
    }

    const url = new URL(c.req.url);
    const hostname = url.hostname;
    const baseDomain = c.env?.PROVIDER_BASE_DOMAIN || '8004-agent.io';
    const subdomain = extractSubdomain(hostname, baseDomain);

    c.set('providerSubdomain', subdomain);

    let providerEnsName: string | null = null;
    let providerAgentAccount: string | null = null;

    if (subdomain) {
      providerEnsName = `${subdomain}.8004-agent.eth`;
      try {
        const ensClient = await getENSClient();
        providerAgentAccount = await ensClient.getAgentAccountByName(providerEnsName);
      } catch (err) {
        console.error(
          '[ATP Agent Worker] Error resolving ENS account for',
          providerEnsName,
          err,
        );
      }
    }

    c.set('providerEnsName', providerEnsName);
    c.set('providerAgentAccount', providerAgentAccount);

    if (c.env?.NODE_ENV === 'development') {
      console.log(
        '[ATP Agent Worker] Routing context:',
        JSON.stringify(
          {
            host: hostname,
            subdomain,
            ensName: providerEnsName,
            agentAccount: providerAgentAccount,
          },
          null,
          2,
        ),
      );
    }

    await next();
  } catch (error) {
    console.error('[ATP Agent Worker] Error in subdomain/ENS middleware:', error);
    await next();
  }
});

/**
 * Sync environment variables from Worker env to process.env
 * This allows getAgenticTrustClient() to read from process.env as it expects
 */
function syncEnvVars(env: Env) {
  // Copy all environment variables from Worker env to process.env
  // This is needed because getAgenticTrustClient() reads from process.env
  if (typeof process !== 'undefined') {
    // Some bundlers polyfill `process` but not `process.env`
    (process as any).env = (process as any).env || {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' && key.startsWith('AGENTIC_TRUST_')) {
        process.env[key] = value;
      }
    }
  }

  // Also stash on globalThis so core singletons (e.g. ensClient) can hydrate on-demand.
  (globalThis as any).__agenticTrustEnv = (globalThis as any).__agenticTrustEnv || {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && key.startsWith('AGENTIC_TRUST_')) {
      (globalThis as any).__agenticTrustEnv[key] = value;
    }
  }
}

/**
 * Middleware to ensure client is initialized (lazy initialization)
 * In Cloudflare Workers, we cannot do async operations at module load time
 * So we initialize on first request instead
 */
async function waitForClientInit(c: HonoContext, next: Next) {
  // Sync environment variables from Worker env to process.env
  if (c.env) {
    syncEnvVars(c.env);
  }
  
  // Lazy initialization - only happens when first request comes in
  // This is safe in Workers because it's within a handler
  try {
    await getAgenticTrustClient();
  } catch (error) {
    console.warn('[ATP Agent Worker] Failed to initialize AgenticTrustClient:', error);
    // Continue anyway - some endpoints might not need it
  }
  await next();
}

// Root handler
app.get('/', (c: HonoContext) => {
  const subdomain = c.get('providerSubdomain');
  return c.json({
    message: 'ATP Agent is running',
    host: new URL(c.req.url).hostname,
    subdomain: subdomain || null,
    note: 'Try /.well-known/agent-card.json or /api/a2a for agent endpoints.',
  });
});

const buildAgentCard = (params: {
  subdomain: string | null | undefined;
  env: Record<string, any>;
  origin: string;
  messageEndpoint: string;
  skills: any[];
}) => {
  const { subdomain, env, origin, messageEndpoint, skills } = params;

  const osafDomains = ['governance-and-trust', 'security', 'collaboration'] as const;
  const osafSkills = [
    'agent_interaction.request_handling',
    'integration.protocol_handling',
    'trust.identity.validation',
    'trust.feedback.authorization',
    'trust.validation.attestation',
    'trust.association.attestation',
    'trust.membership.attestation',
    'trust.delegation.attestation',
    'relationship.association.revocation',
    'delegation.request.authorization',
    'delegation.payload.verification',
    'governance.audit.provenance',
  ] as const;

  return {
    protocolVersion: '1.0',
    name: subdomain ? `${env.AGENT_NAME || 'ATP Agent'} (${subdomain})` : env.AGENT_NAME || 'ATP Agent',
    description: env.AGENT_DESCRIPTION || 'An ATP agent for A2A communication',
    version: env.AGENT_VERSION || '0.1.0',
    supportedInterfaces: [{ url: messageEndpoint, protocolBinding: 'JSONRPC' }],
    provider: {
      organization: env.PROVIDER_ORGANIZATION || 'ATP',
      url: origin,
    },
    capabilities: {
      streaming: env.CAPABILITY_STREAMING === 'true',
      pushNotifications: env.CAPABILITY_PUSH_NOTIFICATIONS === 'true',
      stateTransitionHistory: env.CAPABILITY_STATE_HISTORY === 'true',
      extensions: [
        {
          uri: 'https://eips.ethereum.org/EIPS/eip-8004',
          description: 'ERC-8004 feedbackAuth issuance metadata',
          required: false,
          params: {
            trustModels: ['feedback'],
            feedbackDataURI: '',
          },
        },
        {
          uri: 'https://schema.oasf.outshift.com/',
          description: 'OSAF/OASF extension metadata: domains + skill taxonomy overlay (ATP/Agentic Trust).',
          required: false,
          params: {
            osafExtension: true,
            domains: osafDomains,
            skills: osafSkills,
            // Best-effort mapping from executable skill IDs to OASF/OSAF skill ids.
            skillOverlay: {
              'osaf:trust.feedback.authorization': ['trust.feedback.authorization'],
              'atp.feedback.request': ['trust.feedback.authorization', 'collaboration'],
              'atp.feedback.getRequests': ['trust.feedback.authorization', 'collaboration'],
              'atp.feedback.getRequestsByAgent': ['trust.feedback.authorization', 'collaboration'],
              'atp.feedback.markGiven': ['trust.validation.attestation', 'collaboration'],
              'atp.feedback.requestapproved': ['trust.feedback.authorization', 'collaboration'],
              'osaf:trust.validation.attestation': ['trust.validation.attestation', 'collaboration'],
              'atp.inbox.sendMessage': ['agent_interaction.request_handling', 'integration.protocol_handling', 'collaboration'],
              'atp.inbox.listClientMessages': ['agent_interaction.request_handling', 'collaboration'],
              'atp.inbox.listAgentMessages': ['agent_interaction.request_handling', 'collaboration'],
              'atp.inbox.markRead': ['agent_interaction.request_handling', 'collaboration'],
            },
          },
        },
      ],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills,
    supportsExtendedAgentCard: false,
  };
};

function addOsafOverlayTags(skill: any): any {
  const id = String(skill?.id || '').trim();
  const existingTags = Array.isArray(skill?.tags) ? skill.tags : [];
  const outTags = new Set<string>(existingTags.map((t: any) => String(t)));

  const add = (t: string) => outTags.add(t);

  // Mark that the OASF/OSAF tags are an extension.
  add('osafExtension:true');

  if (id === 'osaf:trust.feedback.authorization') {
    add('osaf:trust.feedback.authorization');
    add('osafDomain:governance-and-trust');
  }
  if (id.startsWith('atp.inbox.')) {
    add('osaf:agent_interaction.request_handling');
    add('osaf:integration.protocol_handling');
    add('osafDomain:collaboration');
  }
  if (id.startsWith('atp.feedback.')) {
    add('osaf:trust.feedback.authorization');
    add('osafDomain:governance-and-trust');
    add('osafDomain:collaboration');
  }
  if (id.startsWith('atp.stats.')) {
    add('osaf:governance.audit.provenance');
    add('osafDomain:governance-and-trust');
  }
  if (id === 'osaf:trust.validation.attestation') {
    add('osaf:trust.validation.attestation');
    add('osafDomain:governance-and-trust');
    add('osafDomain:collaboration');
  }

  return { ...skill, tags: Array.from(outTags) };
}

const normalizeModes = (modes: unknown): string[] => {
  if (!Array.isArray(modes)) return [];
  return modes
    .map((m) => {
      if (m === 'text') return 'text/plain';
      if (m === 'json') return 'application/json';
      if (m === 'task-status') return 'application/json';
      return String(m);
    })
    .filter(Boolean);
};

const buildSkills = (subdomain: string | null | undefined) => {
  const baseSkills = [
    {
      id: 'osaf:trust.feedback.authorization',
      name: 'osaf:trust.feedback.authorization',
      tags: ['erc8004', 'feedback', 'auth', 'a2a'],
      examples: ['Client requests feedbackAuth after receiving results'],
      inputModes: ['text'],
      outputModes: ['text', 'json'],
      description: 'Issue a signed ERC-8004 feedbackAuth for a client to submit feedback',
    },
    {
      id: 'osaf:trust.validation.attestation',
      name: 'osaf:trust.validation.attestation',
      tags: ['erc8004', 'validation', 'attestation', 'a2a'],
      examples: ['Submit a validation response for a pending validation request'],
      inputModes: ['text', 'json'],
      outputModes: ['text', 'json'],
      description: 'Submit a validation response (attestation) using a configured session package.',
    },
  ];

  // Only add admin/inbox skills for agents-atp subdomain
  if (subdomain === 'agents-atp') {
    return [
      ...baseSkills,
      {
        id: 'atp.ens.isNameAvailable',
        name: 'atp.ens.isNameAvailable',
        tags: ['ens', 'availability', 'a2a', 'admin'],
        examples: ['Check ENS availability for <label>.8004-agent.eth'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description: 'Check if an ENS name is available. Payload: { ensName, chainId }',
      },
      {
        id: 'atp.feedback.request',
        name: 'atp.feedback.request',
        tags: ['erc8004', 'feedback', 'request', 'a2a', 'admin'],
        examples: ['Request to give feedback to an agent', 'Submit a feedback request for an agent'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'Request to give feedback to an agent. Requires clientAddress (EOA), targetAgentId (agent ID to give feedback to), and comment (reason for feedback) in payload.',
      },
      {
        id: 'atp.feedback.getRequests',
        name: 'atp.feedback.getRequests',
        tags: ['erc8004', 'feedback', 'query', 'a2a', 'admin'],
        examples: ['Get all feedback requests for a wallet address', 'Query feedback requests by client address'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description: 'Get all feedback requests associated with a wallet address. Requires clientAddress (EOA) in payload.',
      },
      {
        id: 'atp.feedback.getRequestsByAgent',
        name: 'atp.feedback.getRequestsByAgent',
        tags: ['erc8004', 'feedback', 'query', 'a2a', 'admin'],
        examples: ['Get all feedback requests for a specific agent', 'Query feedback requests by target agent ID'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description: 'Get all feedback requests for a specific agent. Requires targetAgentId (agent ID) in payload.',
      },
      {
        id: 'atp.feedback.markGiven',
        name: 'atp.feedback.markGiven',
        tags: ['erc8004', 'feedback', 'update', 'a2a', 'admin'],
        examples: ['Mark a feedback request as having feedback given'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'Mark a feedback request as having feedback given, storing the tx hash. Requires feedbackRequestId and txHash in payload.',
      },
      {
        id: 'atp.feedback.requestapproved',
        name: 'atp.feedback.requestapproved',
        tags: ['atp', 'feedback', 'approval', 'database', 'a2a', 'admin'],
        examples: ['Approve a feedback request and notify requester'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'Approve a feedback request (no on-chain auth). Requires feedbackRequestId, fromAgentDid, toAgentDid, approvedForDays.',
      },
      {
        id: 'atp.inbox.sendMessage',
        name: 'atp.inbox.sendMessage',
        tags: ['erc8004', 'inbox', 'message', 'a2a'],
        examples: ['Send a message via the inbox system'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'Send a message via the inbox system. Requires body, and at least one destination (toClientAddress, toAgentDid, or toAgentName).',
      },
      {
        id: 'atp.inbox.listClientMessages',
        name: 'atp.inbox.listClientMessages',
        tags: ['erc8004', 'inbox', 'query', 'a2a'],
        examples: ['List messages for a client address', 'Get all messages for a wallet'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'List messages for a client address (both sent and received). Requires clientAddress (EOA) in payload.',
      },
      {
        id: 'atp.inbox.listAgentMessages',
        name: 'atp.inbox.listAgentMessages',
        tags: ['erc8004', 'inbox', 'query', 'a2a'],
        examples: ['List messages for an agent DID', 'Get all messages for an agent'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'List messages for an agent DID (both sent and received). Requires agentDid in payload.',
      },
      {
        id: 'atp.inbox.markRead',
        name: 'atp.inbox.markRead',
        tags: ['erc8004', 'inbox', 'query', 'a2a'],
        examples: ['Mark a message as read'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description: 'Mark a message as read. Requires messageId in payload.',
      },
      {
        id: 'atp.stats.trends',
        name: 'atp.stats.trends',
        tags: ['atp', 'stats', 'query', 'a2a', 'admin'],
        examples: ['Get feedback/validation trends'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description: 'Get stats trends. Optional payload: { daysBack }.',
      },
      {
        id: 'atp.stats.sdkApps',
        name: 'atp.stats.sdkApps',
        tags: ['atp', 'stats', 'query', 'a2a', 'admin'],
        examples: ['Get SDK app stats'],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description: 'Get stats for SDK apps.',
      },
    ];
  }

  return baseSkills;
};

const serveAgentCard = (c: HonoContext) => {
  const subdomain = c.get('providerSubdomain');
  const env = c.env || {};

  // Use request origin so subdomains advertise the correct host.
  const origin = new URL(c.req.url).origin.replace(/\/$/, '');
  const messageEndpoint = `${origin}/api/a2a`;

  const rawSkills = buildSkills(subdomain);
  const skills = (rawSkills as any[]).map((s: any) => ({
    ...addOsafOverlayTags(s),
    inputModes: normalizeModes(s.inputModes),
    outputModes: normalizeModes(s.outputModes),
  }));

  const agentCard = buildAgentCard({
    subdomain,
    env,
    origin,
    messageEndpoint,
    skills,
  });

  return c.json(agentCard);
};

// Agent card endpoint (A2A discovery)
app.get('/.well-known/agent-card.json', serveAgentCard);

// Backwards compatible alias
app.get('/.well-known/agent.json', serveAgentCard);

// OPTIONS preflight for agent card
app.options('/.well-known/agent-card.json', (c: HonoContext) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
});

// OPTIONS preflight for legacy agent.json (backwards compatibility)
app.options('/.well-known/agent.json', (c: HonoContext) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
});

const handleA2A = async (c: HonoContext) => {
  const subdomain = c.get('providerSubdomain');
  console.log('========================================');
  console.log('[ATP Agent A2A] POST request received at', new Date().toISOString());
  console.log('[ATP Agent A2A] Host:', new URL(c.req.url).hostname, 'subdomain:', subdomain || '(none)');
  console.log('========================================');

  try {
    type JsonRpcRequest = {
      jsonrpc: '2.0';
      id?: string | number | null;
      method: string;
      params?: any;
    };

    const isJsonRpcRequest = (x: any): x is JsonRpcRequest =>
      Boolean(x) && x.jsonrpc === '2.0' && typeof x.method === 'string';

    const jsonRpcResult = (id: any, result: any) => ({
      jsonrpc: '2.0',
      id: id ?? null,
      result,
    });

    const jsonRpcError = (id: any, code: number, message: string, data?: any) => ({
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code,
        message,
        ...(data !== undefined ? { data } : {}),
      },
    });

    let body: any;
    try {
      body = await c.req.json();
    } catch (e: any) {
      // JSON-RPC parse error response
      return c.json(jsonRpcError(null, -32700, 'Parse error', { message: e?.message || String(e) }), 400);
    }

    const rpcMode = isJsonRpcRequest(body);
    const rpcId = rpcMode ? (body as any).id ?? null : null;

    // If JSON-RPC, wrap all subsequent c.json responses as JSON-RPC results/errors.
    if (rpcMode) {
      const originalJson = c.json.bind(c);
      (c as any).json = (payloadOut: any, status?: number) => {
        const st = typeof status === 'number' ? status : 200;

        // If handler already returned a JSON-RPC object, pass through unchanged.
        if (payloadOut && typeof payloadOut === 'object' && (payloadOut as any).jsonrpc === '2.0') {
          return originalJson(payloadOut, 200);
        }

        const serialized = serializeBigInt(payloadOut);

        // Convert HTTP-ish errors into JSON-RPC errors.
        if (st >= 400) {
          const msg =
            (serialized as any)?.error ||
            (serialized as any)?.response?.error ||
            `A2A request failed (HTTP ${st})`;
          return originalJson(jsonRpcError(rpcId, -32000, String(msg), serialized), 200);
        }

        return originalJson(jsonRpcResult(rpcId, serialized), 200);
      };
    }

    // Extract A2A request data (legacy HTTP+JSON) or JSON-RPC 2.0 (method -> skillId)
    let fromAgentId: any;
    let toAgentId: any;
    let message: any;
    let payload: any;
    let metadata: any;
    let skillId: any;
    let auth: any;

    if (rpcMode) {
      skillId = body.method;
      const params = body.params;
      if (params && typeof params === 'object' && !Array.isArray(params)) {
        payload = Object.prototype.hasOwnProperty.call(params, 'payload') ? params.payload : params;
        message = params.message;
        metadata = params.metadata;
        auth = params.auth;
        fromAgentId = params.fromAgentId;
        toAgentId = params.toAgentId;
      } else {
        payload = params;
      }
    } else {
      ({ fromAgentId, toAgentId, message, payload, metadata, skillId, auth } = body);
    }

    // Validate required fields
    if (!skillId && (!fromAgentId || !toAgentId)) {
      return c.json({
        success: false,
        error: 'fromAgentId and toAgentId are required (unless skillId is provided)',
      }, 400);
    }

    // Verify authentication if provided
    let authenticatedClientAddress: string | null = null;
    if (auth) {
      const atClient = await getAgenticTrustClient();
      const providerUrl = new URL(c.req.url).origin.replace(/\/$/, '');

      const verification = await atClient.verifyChallenge(auth, providerUrl);

      if (!verification.valid) {
        return c.json({
          success: false,
          error: `Authentication failed: ${verification.error}`,
        }, 401);
      }

      authenticatedClientAddress = verification.clientAddress || auth.ethereumAddress || null;

      console.log('Client authenticated:', {
        did: auth.did,
        kid: auth.kid,
        algorithm: auth.algorithm,
        clientAddress: authenticatedClientAddress,
      });
    } else {
      console.warn('A2A request received without authentication');
    }

    // Process the A2A message
    console.log('Received A2A message:', {
      fromAgentId,
      toAgentId,
      message,
      payload,
      metadata,
      skillId,
      timestamp: new Date().toISOString(),
    });

    // Handle skill-based requests
    const responseContent: Record<string, unknown> = {
      received: true,
      processedAt: new Date().toISOString(),
      echo: message || 'Message received',
      ...(payload && { receivedPayload: payload }),
    };

    const handledSkillIdsForDebug = [
      'atp.ens.isNameAvailable',
      'osaf:trust.feedback.authorization',
      'osaf:trust.validation.attestation',
      'atp.feedback.requestLegacy',
      'atp.account.addOrUpdate',
      'atp.agent.createOrUpdate',
      'atp.feedback.request',
      'atp.feedback.getRequests',
      'atp.feedback.getRequestsByAgent',
      'atp.feedback.markGiven',
      'atp.feedback.requestapproved',
      'atp.inbox.sendMessage',
      'atp.inbox.listClientMessages',
      'atp.inbox.listAgentMessages',
      'atp.inbox.markRead',
      'atp.stats.trends',
      'atp.stats.sdkApps',
    ];

    console.log('[ATP Agent] Routing skill:', {
      skillId,
      subdomain,
      host: new URL(c.req.url).hostname,
      hasPayload: Boolean(payload),
      hasAuth: Boolean(auth),
    });

    if (skillId === 'atp.ens.isNameAvailable') {
      responseContent.skill = skillId;

      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.ens.isNameAvailable skill is only available on the agents-atp subdomain';
        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          403,
        );
      }

      const ensNameRaw = (payload as any)?.ensName ?? (payload as any)?.name;
      const chainIdRaw = (payload as any)?.chainId ?? (payload as any)?.chain;
      const ensName = typeof ensNameRaw === 'string' ? ensNameRaw.trim() : '';
      const chainId =
        typeof chainIdRaw === 'number'
          ? chainIdRaw
          : Number.isFinite(Number(chainIdRaw))
            ? Number(chainIdRaw)
            : 11155111;

      if (!ensName) {
        responseContent.error = 'ensName is required in payload';
        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          400,
        );
      }

      const timeoutMs = 6000;
      const available = await Promise.race([
        isENSNameAvailable(ensName, chainId).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);

      responseContent.available = available;
      responseContent.name = ensName;
      responseContent.chainId = chainId;
      responseContent.timeoutMs = timeoutMs;

      return c.json({
        success: true,
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        response: responseContent,
      });
    }

    // Handle feedback request auth skill
    if (skillId === 'osaf:trust.feedback.authorization') {
      try {
        const rpcUrl = c.env?.AGENTIC_TRUST_RPC_URL_SEPOLIA;
        if (!rpcUrl) {
          responseContent.error = 'RPC URL not configured';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 500);
        }

        const atClient = await getAgenticTrustClient();
        let clientAddress = payload.clientAddress;
        let { agentId: agentIdParam, expirySeconds } = payload || {};
        const feedbackRequestIdRaw = (payload as any)?.feedbackRequestId ?? (payload as any)?.requestId;
        const feedbackRequestId =
          typeof feedbackRequestIdRaw === 'string' || typeof feedbackRequestIdRaw === 'number'
            ? Number(feedbackRequestIdRaw)
            : undefined;

        // If feedbackRequestId is provided, derive required fields from the stored request record
        let requestRecord:
          | {
              id: number;
              client_address: string;
              from_agent_did: string | null;
              from_agent_name: string | null;
              to_agent_did: string | null;
              to_agent_name: string | null;
              to_agent_id: string;
              to_agent_chain_id: number;
              approved?: number | null;
              approved_on_date?: number | null;
              approved_for_days?: number | null;
            }
          | null = null;

        if (feedbackRequestId && Number.isFinite(feedbackRequestId)) {
          const db = c.env?.DB || getD1Database(c.env);
          if (!db) {
            responseContent.error = 'D1 database is not available. Cannot load feedback request.';
            responseContent.skill = skillId;
            return c.json(
              {
                success: false,
                messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                response: responseContent,
              },
              500,
            );
          }

          requestRecord = await db
            .prepare(
              'SELECT id, client_address, from_agent_did, from_agent_name, to_agent_did, to_agent_name, to_agent_id, to_agent_chain_id, approved, approved_on_date, approved_for_days FROM agent_feedback_requests WHERE id = ?',
            )
            .bind(feedbackRequestId)
            .first<any>();

          if (!requestRecord) {
            console.warn('[ATP Agent] 404 Feedback request not found', {
              skillId,
              subdomain,
              feedbackRequestId,
              agentIdParam: (payload as any)?.agentId,
              chainId: (payload as any)?.chainId,
            });
            responseContent.error = 'Feedback request not found';
            responseContent.skill = skillId;
            return c.json(
              {
                success: false,
                messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                response: responseContent,
              },
              404,
            );
          }

          // Must be approved before we issue feedbackAuth
          const approved = Number(requestRecord.approved || 0) === 1;
          if (!approved) {
            responseContent.error = 'Feedback request is not approved yet';
            responseContent.skill = skillId;
            return c.json(
              {
                success: false,
                messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                response: responseContent,
              },
              400,
            );
          }

          // If approval has an expiry window, enforce it
          const approvedOn = typeof requestRecord.approved_on_date === 'number' ? requestRecord.approved_on_date : null;
          const approvedForDays = typeof requestRecord.approved_for_days === 'number' ? requestRecord.approved_for_days : null;
          if (approvedOn && approvedForDays && approvedForDays > 0) {
            const nowSec = Math.floor(Date.now() / 1000);
            const expiresAt = approvedOn + approvedForDays * 24 * 60 * 60;
            if (nowSec > expiresAt) {
              responseContent.error = 'Feedback request approval has expired';
              responseContent.skill = skillId;
              return c.json(
                {
                  success: false,
                  messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                  response: responseContent,
                },
                400,
              );
            }
          }

          clientAddress = requestRecord.client_address;
          agentIdParam = requestRecord.to_agent_id;
          // Ensure chainId is available for any agent record auto-create logic
          (payload as any).chainId = requestRecord.to_agent_chain_id;
        }

        if (!clientAddress) {
          responseContent.error = 'clientAddress is required in payload for osaf:trust.feedback.authorization skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Load SessionPackage from database using subdomain
        let sessionPackage: SessionPackage | null = null;
        let agentIdForRequest: string | undefined;

        // Try to load session package from database using subdomain
        if (subdomain) {
          try {
            const db = c.env?.DB || getD1Database(c.env);
            // Convert subdomain to agent name format
            // Subdomain might be: "xyzalliance-arn" or "xyzalliance-arn-8004-agent-eth" (dots converted to dashes)
            // We need to extract the base agent name: "xyzalliance-arn"
            let baseAgentName = subdomain.trim();
            
            // Remove any trailing "-8004-agent-eth" or "-8004-agent" patterns
            baseAgentName = baseAgentName.replace(/-8004-agent-eth$/i, '').replace(/-8004-agent$/i, '');
            
            // Construct normalized identifiers
            const baseAgentNameLower = baseAgentName.toLowerCase();
            const ensName = `${baseAgentNameLower}.8004-agent.eth`;
            const ensNameDup = `${ensName}.8004-agent.eth`;
            
            console.log('[ATP Agent] Looking up agent in database by subdomain:', subdomain);
            console.log('[ATP Agent] Extracted base agent name:', baseAgentName);
            console.log('[ATP Agent] Constructed ens_name for lookup:', ensName);
            
            // Prefer any row that has a non-null session_package; otherwise newest updated
            const agentRecord = await db.prepare(
              `SELECT id, ens_name, agent_name, session_package, updated_at
               FROM agents
               WHERE ens_name = ? COLLATE NOCASE
                  OR ens_name = ? COLLATE NOCASE
                  OR agent_name = ? COLLATE NOCASE
                  OR agent_name = ? COLLATE NOCASE
               ORDER BY (session_package IS NOT NULL) DESC, updated_at DESC
               LIMIT 1`
            )
              .bind(ensName, ensNameDup, baseAgentNameLower, ensName)
              .first<{ id: number; ens_name: string; agent_name: string; session_package: string | null; updated_at: number }>();

            if (agentRecord?.session_package) {
              try {
                sessionPackage = JSON.parse(agentRecord.session_package) as SessionPackage;
                console.log('[ATP Agent] ✓ Loaded session package from database:', {
                  id: agentRecord.id,
                  ens_name: agentRecord.ens_name,
                  agent_name: agentRecord.agent_name,
                });
              } catch (parseError) {
                console.error('[ATP Agent] Failed to parse session package from database:', parseError);
              }
            } else if (agentRecord) {
              console.warn('[ATP Agent] Agent record found, but session_package is NULL:', {
                id: agentRecord.id,
                ens_name: agentRecord.ens_name,
                agent_name: agentRecord.agent_name,
              });
            } else {
              console.warn('[ATP Agent] No agent record found for subdomain:', subdomain, 'ens:', ensName);

              // Create agent record if it doesn't exist
              console.log('[ATP Agent] Creating new agent record in database:', { ensName, baseAgentName: baseAgentNameLower });
                try {
                  const now = Math.floor(Date.now() / 1000);
                  
                  // Get agent info from discovery/client to populate agent_account
                  let agentAccount: string | null = null;
                  let agentChainId = (payload as any)?.chainId || 11155111;
                  
                  if (agentIdParam) {
                    try {
                      const agentInfo = await atClient.agents.getAgent(agentIdParam.toString());
                      if (agentInfo) {
                        agentAccount = agentInfo.agentAccount || null;
                        // Use chainId from agent info if available
                        if (agentInfo.data?.chainId && typeof agentInfo.data.chainId === 'number') {
                          agentChainId = agentInfo.data.chainId;
                        }
                      }
                    } catch (err) {
                      console.warn('[ATP Agent] Could not fetch agent info for account:', err);
                    }
                  }
                  
                  // Extract email domain from agent name if possible
                  // Default to '8004-agent.eth' if we can't extract a domain
                  let emailDomain = '8004-agent.eth';
                  if (ensName.includes('.')) {
                    const parts = ensName.split('.');
                    if (parts.length >= 2) {
                      emailDomain = parts.slice(-2).join('.');
                    }
                  }
                  
                  // Check if record already exists (race condition check)
                  const existingCheck = await db.prepare(
                    'SELECT id FROM agents WHERE ens_name = ? COLLATE NOCASE'
                  )
                    .bind(ensName)
                    .first<{ id: number }>();
                  
                  if (!existingCheck) {
                    await db.prepare(
                      'INSERT INTO agents (ens_name, agent_name, email_domain, agent_account, chain_id, session_package, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                    )
                      .bind(
                        ensName,
                        baseAgentNameLower, // base label (no suffix)
                        emailDomain,
                        agentAccount?.toLowerCase() || null,
                        agentChainId,
                        null, // No session package yet
                        now,
                        now
                      )
                      .run();
                    
                    console.log('[ATP Agent] ✓ Created new agent record in database');
                  } else {
                    console.log('[ATP Agent] Agent record already exists (race condition), skipping creation');
                  }
                } catch (createError) {
                  console.error('[ATP Agent] Failed to create agent record:', createError);
                  // Continue processing even if creation fails
                }
            }
          } catch (dbError) {
            console.error('[ATP Agent] Error loading session package from database:', dbError);
          }
        }

        // For feedback auth requests, session package is REQUIRED
        // Fallback to environment variable if database lookup failed
        if (!sessionPackage) {
          const sessionPackagePath = c.env?.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
          if (sessionPackagePath) {
            try {
              sessionPackage = loadSessionPackage(sessionPackagePath);
              console.log('[ATP Agent] Loaded session package from environment variable');
            } catch (loadError: any) {
              console.warn('[ATP Agent] Failed to load session package from environment variable:', loadError?.message || loadError);
            }
          }
        }

        // For feedback auth, session package is required - return error if missing
        if (!sessionPackage) {
          responseContent.error = 'Session package is required for feedback auth requests. Either store it in the database (agents table) or set AGENTIC_TRUST_SESSION_PACKAGE_PATH environment variable.';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        if (sessionPackage) {
          agentIdForRequest = sessionPackage.agentId.toString();
          console.log('[ATP Agent] Using agentId from session package:', agentIdForRequest);
        } else {
          agentIdForRequest = agentIdParam?.toString();
          console.log('[ATP Agent] Using agentId from request param:', agentIdForRequest);
        }

        const agent = agentIdForRequest ? await atClient.agents.getAgent(agentIdForRequest) : null;

        if (!agent) {
          throw new Error('Agent not found. Cannot request feedback auth without agent instance.');
        }

        // Set session package on agent instance (required for feedback auth)
        console.log('[ATP Agent] Setting session package on agent instance');
        agent.setSessionPackage(sessionPackage);

        console.info("osaf:trust.feedback.authorization: ", agentIdParam, clientAddress, expirySeconds, subdomain ? `subdomain: ${subdomain}` : '');

        const feedbackAuthResponse = await agent.requestAuth({
          clientAddress,
          agentId: agentIdParam,
          skillId: skillId,
          expirySeconds,
        });

        responseContent.feedbackAuth = feedbackAuthResponse.feedbackAuth;
        responseContent.agentId = feedbackAuthResponse.agentId;
        responseContent.clientAddress = feedbackAuthResponse.clientAddress;
        responseContent.skill = feedbackAuthResponse.skill;

        // If this auth is in response to a stored feedback request, persist it and notify requester
        if (requestRecord && feedbackRequestId && Number.isFinite(feedbackRequestId)) {
          try {
            const db = c.env?.DB || getD1Database(c.env);
            if (db) {
              const nowSec = Math.floor(Date.now() / 1000);
              await db
                .prepare(
                  'UPDATE agent_feedback_requests SET feedback_auth = ?, status = ?, updated_at = ? WHERE id = ?',
                )
                .bind(
                  JSON.stringify(feedbackAuthResponse.feedbackAuth),
                  'authorized',
                  nowSec,
                  feedbackRequestId,
                )
                .run();

              // Create an inbox message back to the requester
              const nowMs = Date.now();
              const replyBody =
                `Your feedback request has been approved.\n\n` +
                `feedbackRequestId: ${feedbackRequestId}\n` +
                `feedbackAuth:\n${feedbackAuthResponse.feedbackAuth}\n`;

              await db
                .prepare(
                  'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                )
                .bind(
                  null,
                  requestRecord.to_agent_did,
                  requestRecord.to_agent_name,
                  requestRecord.client_address?.toLowerCase?.() || null,
                  requestRecord.from_agent_did,
                  requestRecord.from_agent_name,
                  'Feedback authorization granted',
                  replyBody,
                  'feedback_auth',
                  String(feedbackRequestId),
                  nowMs,
                  null,
                )
                .run();
            }
          } catch (dbErr) {
            console.warn('[ATP Agent] Failed to persist feedbackAuth / notify requester:', dbErr);
          }
        }
      } catch (error: any) {
        console.error('Error creating feedback auth:', error);
        responseContent.error = error?.message || 'Failed to create feedback auth';
        responseContent.skill = skillId;
      }
    } else if (
      skillId === 'osaf:trust.validation.attestation'
    ) {
      // Process validation response using session package
      console.log('[ATP Agent] Entering validation.respond handler, subdomain:', subdomain, 'skillId:', skillId);
      try {
        responseContent.skill = skillId;
        
        const agentIdParam = (payload as any)?.agentId ?? (metadata as any)?.agentId;
        const chainIdParam = (payload as any)?.chainId ?? (metadata as any)?.chainId ?? DEFAULT_CHAIN_ID;
        const requestHashParam = (payload as any)?.requestHash;
        const responseScore = (payload as any)?.response ?? 100;
        const responseUriParam = (payload as any)?.responseUri;
        const responseTag = (payload as any)?.tag ?? 'agent-validation';

        console.log('[ATP Agent] Validation.respond params:', {
          agentIdParam,
          chainIdParam,
          requestHashParam,
          subdomain,
          subdomainEqualsEnsValidator: subdomain === 'smart-name-validator',
        });

        // Declare sessionPackage at function scope so it can be reused
        let sessionPackage: SessionPackage | null = null;

        // Special handling for ens-validator subdomain
        if (subdomain === 'smart-name-validator') {
          console.log('[ATP Agent] ✅ ENS Validator subdomain detected, running ENS-specific validation logic');
          console.log('[ATP Agent] Subdomain:', subdomain, 'agentIdParam:', agentIdParam);
          
          if (!agentIdParam) {
            responseContent.error = 'agentId is required in payload for validation.respond skill';
            responseContent.success = false;
            return c.json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            }, 400);
          }

          const resolvedAgentId = String(agentIdParam);
          const resolvedChainId = typeof chainIdParam === 'number' ? chainIdParam : Number(chainIdParam);

          // Load session package first (needed for validator logic)
          const validatorSubdomain = subdomain === 'smart-name-validator' || subdomain === 'smart-account-validator' || subdomain === 'smart-app-validator';
          if (validatorSubdomain) {
            console.log('[ATP Agent] Attempting to load session package for validator subdomain:', subdomain);
          }
          if (subdomain) {
            try {
              const db = c.env?.DB || getD1Database(c.env);
              let baseAgentName = subdomain.trim();
              baseAgentName = baseAgentName.replace(/-8004-agent-eth$/i, '').replace(/-8004-agent$/i, '');
              const agentName = `${baseAgentName}.8004-agent.eth`;
              const baseAgentNameLower = baseAgentName.toLowerCase();
              const ensName = agentName.toLowerCase();
              const ensNameDup = agentName; // Keep original case for one of the checks

              console.log('[ATP Agent] Looking up session package for validator:', {
                subdomain,
                baseAgentName,
                baseAgentNameLower,
                agentName,
                ensName,
              });

              // Try direct lookup by agent_name first (most reliable match)
              let agentRecord = await db
                .prepare('SELECT id, ens_name, agent_name, session_package, updated_at FROM agents WHERE LOWER(agent_name) = LOWER(?)')
                .bind(baseAgentNameLower)
                .first<{ id: number; ens_name: string; agent_name: string; session_package: string | null; updated_at: number }>();

              // If not found, try the broader lookup pattern
              if (!agentRecord) {
                console.log('[ATP Agent] Direct agent_name lookup failed, trying broader pattern');
                agentRecord = await db.prepare(
                  `SELECT id, ens_name, agent_name, session_package, updated_at
                   FROM agents
                   WHERE ens_name = ? COLLATE NOCASE
                      OR ens_name = ? COLLATE NOCASE
                      OR ens_name = ? COLLATE NOCASE
                      OR agent_name = ? COLLATE NOCASE
                      OR agent_name = ? COLLATE NOCASE
                   ORDER BY (session_package IS NOT NULL) DESC, updated_at DESC
                   LIMIT 1`
                )
                  .bind(ensName, ensNameDup, '8004-agent.eth', baseAgentNameLower, ensName)
                  .first<{ id: number; ens_name: string; agent_name: string; session_package: string | null; updated_at: number }>();
              }

              console.log('[ATP Agent] Session package lookup result:', {
                found: !!agentRecord,
                id: agentRecord?.id,
                ens_name: agentRecord?.ens_name,
                agent_name: agentRecord?.agent_name,
                hasSessionPackage: !!agentRecord?.session_package,
              });

              if (agentRecord?.session_package) {
                try {
                  sessionPackage = JSON.parse(agentRecord.session_package) as SessionPackage;
                  console.log('[ATP Agent] ✅ Successfully loaded SessionPackage from database (validator):', {
                    subdomain,
                    id: agentRecord.id,
                    ens_name: agentRecord.ens_name,
                    agent_name: agentRecord.agent_name,
                  });
                } catch (parseError) {
                  console.error('[ATP Agent] Failed to parse session package (validator):', parseError);
                }
              } else if (agentRecord) {
                console.warn('[ATP Agent] Agent record found for validator, but session_package is NULL:', {
                  subdomain,
                  id: agentRecord.id,
                  ens_name: agentRecord.ens_name,
                  agent_name: agentRecord.agent_name,
                });
              } else {
                console.warn('[ATP Agent] No agent record found for validator subdomain:', subdomain);
                // Try a simpler direct lookup by agent_name as fallback
                try {
                  const fallbackRecord = await db
                    .prepare('SELECT id, ens_name, agent_name, session_package FROM agents WHERE LOWER(agent_name) = LOWER(?)')
                    .bind(baseAgentNameLower)
                    .first<{ id: number; ens_name: string; agent_name: string; session_package: string | null }>();
                  if (fallbackRecord?.session_package) {
                    sessionPackage = JSON.parse(fallbackRecord.session_package) as SessionPackage;
                    console.log('[ATP Agent] ✅ Successfully loaded SessionPackage from fallback lookup:', {
                      id: fallbackRecord.id,
                      ens_name: fallbackRecord.ens_name,
                      agent_name: fallbackRecord.agent_name,
                    });
                  } else if (fallbackRecord) {
                    console.warn('[ATP Agent] Fallback lookup found record but session_package is NULL:', fallbackRecord);
                  }
                } catch (fallbackError) {
                  console.error('[ATP Agent] Fallback lookup failed:', fallbackError);
                }
              }
            } catch (dbError) {
              console.error('[ATP Agent] Error loading session package (ens-validator):', dbError);
              console.error('[ATP Agent] Database error details:', {
                message: dbError instanceof Error ? dbError.message : String(dbError),
                stack: dbError instanceof Error ? dbError.stack : undefined,
              });
            }
          } else {
            console.warn('[ATP Agent] No subdomain provided for validator session package lookup');
          }
          
          console.log('[ATP Agent] Session package loaded for validator:', !!sessionPackage);
        }

        // Resolve agent ID and chain ID (used both in ens-validator logic and standard validation)
        const resolvedAgentId = String(agentIdParam);
        const resolvedChainId = typeof chainIdParam === 'number' ? chainIdParam : Number(chainIdParam);

        // Load session package from database (reuse if already loaded for ens-validator)
        // Only load if not already loaded by ens-validator logic above
        if (!sessionPackage && subdomain) {
          try {
            const db = c.env?.DB || getD1Database(c.env);
            let baseAgentName = subdomain.trim();
            baseAgentName = baseAgentName.replace(/-8004-agent-eth$/i, '').replace(/-8004-agent$/i, '');
            const agentName = `${baseAgentName}.8004-agent.eth`;
            const baseAgentNameLower = baseAgentName.toLowerCase();
            const ensName = agentName.toLowerCase();
            const ensNameDup = agentName; // Keep original case for one of the checks

            // Use same lookup pattern as other session package lookups (matches database structure)
            // Database may have ens_name as just domain ('8004-agent.eth') or full name ('ens-validator.8004-agent.eth')
            // and agent_name as base name ('smart-name-validator') or full name
            const agentRecord = await db.prepare(
              `SELECT id, ens_name, agent_name, session_package, updated_at
               FROM agents
               WHERE ens_name = ? COLLATE NOCASE
                  OR ens_name = ? COLLATE NOCASE
                  OR ens_name = ? COLLATE NOCASE
                  OR agent_name = ? COLLATE NOCASE
                  OR agent_name = ? COLLATE NOCASE
               ORDER BY (session_package IS NOT NULL) DESC, updated_at DESC
               LIMIT 1`
            )
              .bind(ensName, ensNameDup, '8004-agent.eth', baseAgentNameLower, ensName)
              .first<{ id: number; ens_name: string; agent_name: string; session_package: string | null; updated_at: number }>();

            if (agentRecord?.session_package) {
              try {
                sessionPackage = JSON.parse(agentRecord.session_package) as SessionPackage;
                console.log('[ATP Agent] ✅ Successfully loaded SessionPackage from database (agents table) for validation.respond');
                console.log('[ATP Agent]   SessionPackage agentId:', (sessionPackage as any)?.agentId, 'chainId:', (sessionPackage as any)?.chainId);
              } catch (parseError) {
                console.error('[ATP Agent] Failed to parse session package (validation.respond):', parseError);
              }
            }
          } catch (dbError) {
            console.error('[ATP Agent] Error loading session package (validation.respond):', dbError);
          }
        }

        // Fallback to env path
        if (!sessionPackage) {
          const sessionPackagePath = c.env?.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
          if (sessionPackagePath) {
            try {
              sessionPackage = loadSessionPackage(sessionPackagePath);
            } catch (loadError: any) {
              console.warn('[ATP Agent] Failed to load session package from env (validation.respond):', loadError?.message || loadError);
            }
          }
        }

        if (!sessionPackage) {
          const validatorSubdomain = subdomain === 'smart-name-validator' || subdomain === 'smart-account-validator' || subdomain === 'smart-app-validator';
          responseContent.error = validatorSubdomain
            ? `Session package is required for ${subdomain}. Store it in database or set AGENTIC_TRUST_SESSION_PACKAGE_PATH.`
            : 'Session package is required for validation.respond. Store it in database or set AGENTIC_TRUST_SESSION_PACKAGE_PATH.';
          responseContent.success = false;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Track validator validation status
        let validatorValidated: boolean | undefined = undefined;

        // Special handling for ens-validator subdomain
        if (subdomain === 'smart-name-validator') {
          console.log('[ATP Agent] ENS Validator subdomain detected, running ENS-specific validation logic');
          
          const { processEnsValidatorLogic } = await import('./validators/ens-validator');
          const ensValidatorResult = await processEnsValidatorLogic({
            sessionPackage,
            agentId: resolvedAgentId,
            chainId: resolvedChainId,
            requestHash: requestHashParam,
            payload,
          });

          if (!ensValidatorResult.shouldProceed) {
            responseContent.error = ensValidatorResult.error || 'ENS validation checks failed';
            responseContent.success = false;
            responseContent.ensValidatorResult = ensValidatorResult;
            return c.json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            }, 400);
          }

          // Store the validated status from the validator
          validatorValidated = ensValidatorResult.validated;
          console.log('[ATP Agent] Validator returned validated status:', validatorValidated);

          // Store ENS validator metadata in response
          if (ensValidatorResult.metadata) {
            responseContent.ensValidatorMetadata = ensValidatorResult.metadata;
          }

          console.log('[ATP Agent] ✅ ENS validator logic passed, proceeding with standard validation response');
        }

        // Special handling for smart-account-validator subdomain
        if (subdomain === 'smart-account-validator') {
          console.log('[ATP Agent] Smart Account Validator subdomain detected, running smart account-specific validation logic');
          
          const { processSmartAccountValidatorLogic } = await import('./validators/smart-account-validator');
          const smartAccountValidatorResult = await processSmartAccountValidatorLogic({
            sessionPackage,
            agentId: resolvedAgentId,
            chainId: resolvedChainId,
            requestHash: requestHashParam,
            payload,
          });

          if (!smartAccountValidatorResult.shouldProceed) {
            responseContent.error = smartAccountValidatorResult.error || 'Smart account validation checks failed';
            responseContent.success = false;
            responseContent.smartAccountValidatorResult = smartAccountValidatorResult;
            return c.json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            }, 400);
          }

          // Store the validated status from the validator
          validatorValidated = smartAccountValidatorResult.validated;
          console.log('[ATP Agent] Validator returned validated status:', validatorValidated);

          // Store smart account validator metadata in response
          if (smartAccountValidatorResult.metadata) {
            responseContent.smartAccountValidatorMetadata = smartAccountValidatorResult.metadata;
          }

          console.log('[ATP Agent] ✅ Smart account validator logic passed, proceeding with standard validation response');
        }

        // Special handling for smart-app-validator subdomain
        if (subdomain === 'smart-app-validator') {
          console.log('[ATP Agent] Smart App Validator subdomain detected, running smart app-specific validation logic');
          
          const { processSmartAppValidatorLogic } = await import('./validators/smart-app-validator');
          const smartAppValidatorResult = await processSmartAppValidatorLogic({
            sessionPackage,
            agentId: resolvedAgentId,
            chainId: resolvedChainId,
            requestHash: requestHashParam,
            payload,
          });

          if (!smartAppValidatorResult.shouldProceed) {
            responseContent.error = smartAppValidatorResult.error || 'Smart app validation checks failed';
            responseContent.success = false;
            responseContent.smartAppValidatorResult = smartAppValidatorResult;
            return c.json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            }, 400);
          }

          // Store the validated status from the validator
          validatorValidated = smartAppValidatorResult.validated;
          console.log('[ATP Agent] Validator returned validated status:', validatorValidated);

          // Store smart app validator metadata in response
          if (smartAppValidatorResult.metadata) {
            responseContent.smartAppValidatorMetadata = smartAppValidatorResult.metadata;
          }

          console.log('[ATP Agent] ✅ Smart app validator logic passed, proceeding with standard validation response');
        }

        // Dynamically import and call processValidationRequestsWithSessionPackage
        console.log('[ATP Agent] Calling processValidationRequestsWithSessionPackage with:', {
          sessionPackageAgentId: (sessionPackage as any)?.agentId,
          chainId: resolvedChainId,
          agentIdFilter: resolvedAgentId,
          requestHashFilter: requestHashParam,
          responseScore,
          responseUri: responseUriParam,
          responseTag,
          validatorValidated,
        });

        const coreModule = await import('@agentic-trust/core/server');
        const validationResults = await (coreModule.processValidationRequestsWithSessionPackage as any)({
          sessionPackage,
          chainId: resolvedChainId,
          agentIdFilter: resolvedAgentId,
          requestHashFilter: requestHashParam,
          responseScore,
          responseUri: responseUriParam,
          responseTag,
          validatorValidated, // Pass the validated status from the validator
        } as any);

        console.log('[ATP Agent] Validation results received:', {
          resultsCount: validationResults?.length || 0,
          results: validationResults,
        });

        const result = validationResults[0];
        if (!result) {
          console.warn('[ATP Agent] 404 No matching pending validation request found', {
            skillId,
            subdomain,
            resolvedAgentId,
            resolvedChainId,
            requestHash: requestHashParam,
            resultsCount: validationResults?.length || 0,
          });
          responseContent.error = 'No matching pending validation request found';
          responseContent.success = false;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 404);
        }

        responseContent.validationResult = serializeBigInt(result);
        responseContent.success = result.success;
        if (!result.success) {
          responseContent.error = result.error || 'Failed to submit validation response';
        }
      } catch (error: any) {
        console.error('[ATP Agent] Error processing validation response:', error);
        responseContent.error = error?.message || 'Failed to process validation response';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'atp.feedback.requestLegacy') {
      // Feedback request skill - just record in database (legacy)
      try {
        const clientAddress = payload.clientAddress;
        const fromAgentId =
          payload.fromAgentId ||
          payload.requesterAgentId ||
          null;
        const fromAgentChainId =
          payload.fromAgentChainId ||
          payload.requesterChainId ||
          null;
        const toAgentId =
          payload.toAgentId ||
          payload.targetAgentId ||
          payload.agentId ||
          '';
        const toAgentChainId =
          payload.toAgentChainId ||
          payload.chainId ||
          DEFAULT_CHAIN_ID;
        const fromAgentDid = payload.fromAgentDid || null;
        const fromAgentName = payload.fromAgentName || null;
        const toAgentDid = payload.toAgentDid || payload.targetAgentDid || payload.agentDid || null;
        const toAgentName = payload.toAgentName || payload.targetAgentName || payload.agentName || null;

        if (!clientAddress) {
          responseContent.error = 'clientAddress is required in payload for atp.feedback.requestLegacy skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Create feedback request record in database
        try {
          const db = c.env?.DB || getD1Database(c.env);
          const comment = (payload as any)?.comment || (payload as any)?.reason || '';
          
          // Extract fromAgentId and fromChainId from metadata if not provided in payload
          const metaFromAgentId = (metadata as any)?.fromAgentId;
          const metaFromAgentChainId = (metadata as any)?.fromAgentChainId || (metadata as any)?.fromChainId;
          const resolvedFromAgentId = fromAgentId || metaFromAgentId || null;
          const resolvedFromAgentChainId = fromAgentChainId || metaFromAgentChainId || DEFAULT_CHAIN_ID;
          
          if (clientAddress && toAgentId) {
            console.log('[ATP Agent] Creating agent_feedback_requests record:', { clientAddress, toAgentId, comment });
            
            const result = await db.prepare(
              'INSERT INTO agent_feedback_requests (client_address, from_agent_id, from_agent_chain_id, to_agent_id, to_agent_chain_id, comment, status, from_agent_did, from_agent_name, to_agent_did, to_agent_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
            )
              .bind(
                clientAddress,
                resolvedFromAgentId,
                resolvedFromAgentChainId,
                toAgentId,
                toAgentChainId,
                comment,
                'pending',
                fromAgentDid,
                fromAgentName,
                toAgentDid,
                toAgentName,
                Math.floor(Date.now() / 1000),
                Math.floor(Date.now() / 1000)
              )
              .first<{ id: number }>();
              
            if (result) {
              console.log('[ATP Agent] Created agent_feedback_requests record with ID:', result.id);
              (responseContent as any).requestId = result.id;
              responseContent.message = 'Feedback request recorded successfully';
              responseContent.status = 'pending';
              
              // Send A2A message to target agent if fromAgentId is available
              if (resolvedFromAgentId && toAgentId) {
                try {
                  const atClient = await getAgenticTrustClient();
                  const targetAgent = await atClient.agents.getAgent(toAgentId, toAgentChainId);
                  
                  if (targetAgent && targetAgent.a2aEndpoint) {
                    const messageText = `Feedback Request: ${comment || 'A user has requested to provide feedback on your agent.'}`;
                    
                    await targetAgent.sendMessage({
                      message: messageText,
                      payload: {
                        type: 'feedback_request_notification',
                        requestId: result.id,
                        reason: comment,
                        fromAgentId: resolvedFromAgentId?.toString(),
                        fromAgentChainId: resolvedFromAgentChainId,
                        clientAddress: clientAddress,
                        toAgentId: toAgentId,
                        toAgentChainId: toAgentChainId,
                      },
                      metadata: {
                        fromAgentId: resolvedFromAgentId?.toString(),
                        fromAgentChainId: resolvedFromAgentChainId,
                        toAgentId: toAgentId,
                        toAgentChainId: toAgentChainId,
                        source: 'atp-agent',
                        timestamp: new Date().toISOString(),
                      },
                    });
                    
                    console.log('[ATP Agent] Sent A2A message to target agent:', { toAgentId, fromAgentId: resolvedFromAgentId });
                  } else {
                    console.warn('[ATP Agent] Target agent not found or has no A2A endpoint:', { toAgentId, toAgentChainId });
                  }
                } catch (messageError: any) {
                  // Log error but don't fail the feedback request creation
                  console.error('[ATP Agent] Failed to send A2A message to target agent:', messageError);
                }
              } else {
                console.log('[ATP Agent] Skipping A2A message - fromAgentId not available in metadata');
              }
            }
          }
        } catch (dbError: any) {
          console.error('[ATP Agent] Failed to create agent_feedback_requests record:', dbError);
          responseContent.error = dbError?.message || 'Failed to record feedback request';
        }
      } catch (error: any) {
        console.error('Error processing feedback request:', error);
        responseContent.error = error?.message || 'Failed to process feedback request';
        responseContent.skill = skillId;
      }
    } else if (skillId === 'atp.account.addOrUpdate') {
      // Account management skill - add or update account in D1 database
      try {
        const { 
          email, 
          first_name, 
          last_name, 
          social_account_id, 
          social_account_type, 
          eoa_address, 
          aa_address,
          metadata: accountMetadata 
        } = payload || {};
        
        const db = c.env?.DB || getD1Database(c.env);
        
        // Determine email: use provided email, or generate placeholder from eoa_address
        let accountEmail: string;
        if (email && typeof email === 'string' && email.trim().length > 0) {
          accountEmail = email.toLowerCase().trim();
        } else if (eoa_address && typeof eoa_address === 'string') {
          // Generate placeholder email from eoa_address if no email provided
          accountEmail = `${eoa_address.toLowerCase()}@wallet.local`;
        } else {
          responseContent.error = 'Either email or eoa_address is required in payload for atp.account.addOrUpdate skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }
        
        // Check if account exists by email (unique identifier)
        let existing = await db.prepare(
          'SELECT id FROM accounts WHERE email = ?'
        )
          .bind(accountEmail)
          .first<{ id: number }>();

        // If not found by email but eoa_address provided, also check by eoa_address
        if (!existing && eoa_address) {
          const existingByEoa = await db.prepare(
            'SELECT id, email FROM accounts WHERE eoa_address = ?'
          )
            .bind(eoa_address.toLowerCase())
            .first<{ id: number; email: string }>();
          
          if (existingByEoa) {
            existing = { id: existingByEoa.id };
            // Update email if it was a placeholder and we now have a real email
            if (email && typeof email === 'string' && email.trim().length > 0 && existingByEoa.email.endsWith('@wallet.local')) {
              accountEmail = email.toLowerCase().trim();
            } else {
              accountEmail = existingByEoa.email;
            }
          }
        }

        // Use unixepoch() for timestamps (INTEGER)
        const now = Math.floor(Date.now() / 1000);
        
        if (existing) {
          // Update existing account
          await db.prepare(
            'UPDATE accounts SET email = ?, first_name = ?, last_name = ?, social_account_id = ?, social_account_type = ?, eoa_address = ?, aa_address = ?, updated_at = ? WHERE id = ?'
          )
            .bind(
              accountEmail,
              first_name || null,
              last_name || null,
              social_account_id || null,
              social_account_type || null,
              eoa_address ? eoa_address.toLowerCase() : null,
              aa_address ? aa_address.toLowerCase() : null,
              now,
              existing.id
            )
            .run();
          
          responseContent.action = 'updated';
          responseContent.accountId = existing.id;
          responseContent.message = 'Account updated successfully';
        } else {
          // Insert new account
          const result = await db.prepare(
            'INSERT INTO accounts (email, first_name, last_name, social_account_id, social_account_type, eoa_address, aa_address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
            .bind(
              accountEmail,
              first_name || null,
              last_name || null,
              social_account_id || null,
              social_account_type || null,
              eoa_address ? eoa_address.toLowerCase() : null,
              aa_address ? aa_address.toLowerCase() : null,
              now,
              now
            )
            .run();
          
          responseContent.action = 'created';
          responseContent.accountId = result.meta.last_row_id;
          responseContent.message = 'Account created successfully';
        }

        responseContent.email = accountEmail;
        if (eoa_address) {
          responseContent.eoa_address = eoa_address.toLowerCase();
        }
        if (aa_address) {
          responseContent.aa_address = aa_address.toLowerCase();
        }
        responseContent.skill = skillId;
      } catch (error: any) {
        console.error('Error managing account:', error);
        responseContent.error = error?.message || 'Failed to add/update account';
        responseContent.skill = skillId;
      }
    } else if (skillId === 'atp.agent.createOrUpdate') {
      // Agent management skill - create or update agent in D1 database
      try {
        const {
          agent_name,
          agent_account,
          ens_name,
          email_domain,
          chain_id,
          session_package,
        } = payload || {};

        if (!agent_name || typeof agent_name !== 'string') {
          responseContent.error = 'agent_name is required in payload for atp.agent.createOrUpdate skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        if (!agent_account || typeof agent_account !== 'string') {
          responseContent.error = 'agent_account is required in payload for atp.agent.createOrUpdate skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        console.log('[ATP Agent] Received atp.agent.createOrUpdate:', {
          agent_name,
          agent_account: agent_account.substring(0, 10) + '...',
          ens_name: ens_name || 'undefined',
          session_package_provided: session_package ? 'yes' : 'no',
          session_package_type: typeof session_package,
        });

        const db = c.env?.DB || getD1Database(c.env);

        // Determine ens_name: use provided ens_name, or generate from agent_name
        let agentEnsName: string;
        if (ens_name && typeof ens_name === 'string' && ens_name.trim().length > 0) {
          agentEnsName = ens_name.trim();
          // Normalize: remove duplicate .8004-agent.eth suffix if present
          // e.g., "xyzalliance-arn.8004-agent.eth.8004-agent.eth" -> "xyzalliance-arn.8004-agent.eth"
          while (agentEnsName.endsWith('.8004-agent.eth.8004-agent.eth')) {
            agentEnsName = agentEnsName.replace(/\.8004-agent\.eth$/, '');
          }
        } else {
          // Generate ENS name from agent_name (e.g., 'myagent' -> 'myagent.8004-agent.eth')
          // If agent_name already ends with .8004-agent.eth, use it as-is
          const normalizedAgentName = agent_name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
          agentEnsName = normalizedAgentName.endsWith('.8004-agent.eth')
            ? normalizedAgentName
            : `${normalizedAgentName}.8004-agent.eth`;
        }

        // Normalize for DB lookups: avoid case-sensitive duplicate ENS rows
        const agentEnsNameLower = agentEnsName.toLowerCase();

        // Normalize agent_name for DB: store base label (no ".8004-agent.eth" suffix)
        const baseAgentName = String(agent_name || '').replace(/\.8004-agent\.eth$/i, '').trim();

        // Determine email_domain: use provided or extract from agent_name if possible
        let agentEmailDomain: string | null = email_domain || null;
        if (!agentEmailDomain && agent_name.includes('.')) {
          // Try to extract domain from agent_name if it looks like a domain
          const parts = agent_name.split('.');
          if (parts.length >= 2) {
            agentEmailDomain = parts.slice(-2).join('.');
          }
        }

        // Use provided chain_id or default to Sepolia (11155111)
        const agentChainId = chain_id && Number.isFinite(chain_id) ? Number(chain_id) : 11155111;

        // Handle session_package: convert to string if it's an object, or use as-is if string, or null if undefined
        let sessionPackageValue: string | null = null;
        if (session_package !== undefined && session_package !== null) {
          if (typeof session_package === 'string') {
            sessionPackageValue = session_package.trim().length > 0 ? session_package : null;
          } else if (typeof session_package === 'object') {
            // If it's an object, stringify it
            sessionPackageValue = JSON.stringify(session_package);
          }
        }

        console.log('[ATP Agent] Processing session_package:', {
          provided: typeof session_package,
          hasValue: session_package !== undefined && session_package !== null,
          finalValue: sessionPackageValue ? `${sessionPackageValue.substring(0, 100)}...` : 'null',
        });

        // Check if agent exists by ens_name (prefer exact lowercase match, then case-insensitive)
        console.log('[ATP Agent] Looking for agent by ens_name:', agentEnsNameLower, 'agent_name:', baseAgentName);

        // Debug: show what agent records exist with similar names
        const similarRecords = await db.prepare(
          'SELECT id, ens_name, agent_name FROM agents WHERE LOWER(ens_name) LIKE LOWER(?) OR LOWER(agent_name) LIKE LOWER(?) LIMIT 5'
        )
          .bind(`%${baseAgentName}%`, `%${baseAgentName}%`)
          .all<{ id: number; ens_name: string; agent_name: string }>();

        console.log('[ATP Agent] Similar agent records in DB:', similarRecords?.results || []);

        const existing =
          (await db.prepare(
            'SELECT id, ens_name, updated_at FROM agents WHERE ens_name = ? ORDER BY updated_at DESC LIMIT 1'
          )
            .bind(agentEnsNameLower)
            .first<{ id: number; ens_name: string; updated_at: number }>()) ??
          (await db.prepare(
            'SELECT id, ens_name, updated_at FROM agents WHERE ens_name = ? COLLATE NOCASE ORDER BY updated_at DESC LIMIT 1'
          )
            .bind(agentEnsName)
            .first<{ id: number; ens_name: string; updated_at: number }>());

        console.log('[ATP Agent] Lookup result for ens_name:', agentEnsNameLower, '->', existing ? `ID ${existing.id} (${existing.ens_name})` : 'NOT FOUND');

        // Use unixepoch() for timestamps (INTEGER)
        const now = Math.floor(Date.now() / 1000);

        if (existing) {
          // Update existing agent
          await db.prepare(
            'UPDATE agents SET agent_name = ?, agent_account = ?, email_domain = ?, chain_id = ?, session_package = ?, updated_at = ? WHERE id = ?'
          )
            .bind(
              baseAgentName,
              agent_account.toLowerCase(),
              agentEmailDomain,
              agentChainId,
              sessionPackageValue,
              now,
              existing.id
            )
            .run();

          responseContent.action = 'updated';
          responseContent.agentId = existing.id;
          responseContent.message = 'Agent updated successfully';
        } else {
          // Insert new agent
          const result = await db.prepare(
            'INSERT INTO agents (ens_name, agent_name, email_domain, agent_account, chain_id, session_package, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          )
            .bind(
              agentEnsNameLower,
              baseAgentName,
              agentEmailDomain,
              agent_account.toLowerCase(),
              agentChainId,
              sessionPackageValue,
              now,
              now
            )
            .run();

          responseContent.action = 'created';
          responseContent.agentId = result.meta.last_row_id;
          responseContent.message = 'Agent created successfully';
        }

        responseContent.ens_name = existing?.ens_name ?? agentEnsNameLower;
        responseContent.agent_name = baseAgentName;
        responseContent.agent_account = agent_account.toLowerCase();
        responseContent.skill = skillId;
      } catch (error: any) {
        console.error('Error managing agent:', error);
        responseContent.error = error?.message || 'Failed to add/update agent';
        responseContent.skill = skillId;
      }
    } else if (skillId === 'atp.feedback.request') {
      // This skill is only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.feedback.request skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const clientAddress = payload?.clientAddress || payload?.client_address;
        const toAgentId = payload?.toAgentId || payload?.targetAgentId || payload?.target_agent_id || payload?.agentId;
        const toAgentChainId = payload?.toAgentChainId || payload?.chainId || payload?.targetAgentChainId || DEFAULT_CHAIN_ID;
        const toAgentDid = payload?.toAgentDid || payload?.targetAgentDid || payload?.agentDid || null;
        const toAgentName = payload?.toAgentName || payload?.targetAgentName || payload?.agentName || null;
        const fromAgentId = payload?.fromAgentId || payload?.requesterAgentId || null;
        const fromAgentChainId = payload?.fromAgentChainId || payload?.requesterChainId || DEFAULT_CHAIN_ID;
        const fromAgentDid = payload?.fromAgentDid || null;
        const fromAgentName = payload?.fromAgentName || null;
        const comment = payload?.comment || '';

        if (!clientAddress) {
          responseContent.error = 'clientAddress (EOA address) is required in payload for atp.feedback.request skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        if (!toAgentId) {
          responseContent.error = 'toAgentId (agent ID to give feedback to) is required in payload for atp.feedback.request skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        if (!comment || comment.trim().length === 0) {
          responseContent.error = 'comment (reason for feedback) is required in payload for atp.feedback.request skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Store feedback request in database
        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot store feedback request.');
        }

        const now = Math.floor(Date.now() / 1000);
        const result = await db
          .prepare(
            'INSERT INTO agent_feedback_requests (client_address, from_agent_id, from_agent_chain_id, to_agent_id, to_agent_chain_id, comment, status, from_agent_did, from_agent_name, to_agent_did, to_agent_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(
            clientAddress.toLowerCase(), 
            fromAgentId ? String(fromAgentId) : null,
            fromAgentChainId ?? DEFAULT_CHAIN_ID,
            String(toAgentId), 
            toAgentChainId ?? DEFAULT_CHAIN_ID,
            comment.trim(), 
            'pending',
            fromAgentDid,
            fromAgentName,
            toAgentDid,
            toAgentName,
            now, 
            now
          )
          .run();

        const feedbackRequestId = result.meta.last_row_id;

        console.log('[ATP Agent] Stored feedback request:', {
          clientAddress,
          toAgentId: String(toAgentId),
          fromAgentId: fromAgentId ? String(fromAgentId) : null,
          fromAgentDid,
          fromAgentName,
          toAgentDid,
          toAgentName,
          comment: comment.trim(),
          id: feedbackRequestId,
        });

        // Also create a corresponding inbox message so the request shows in messaging UIs
        try {
          const messageBody = `Feedback request for agent ${toAgentName || String(toAgentId)} (ID: ${String(toAgentId)}):\n\n${comment.trim()}`;
          const taskId = String(feedbackRequestId);
          await ensureTasksSchema(db);
          await db
            .prepare(
              `INSERT OR IGNORE INTO tasks (
                id, type, status, subject,
                from_agent_did, from_agent_name,
                to_agent_did, to_agent_name,
                from_client_address, to_client_address,
                created_at, updated_at, last_message_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              taskId,
              'feedback_auth_request',
              'open',
              'Request Feedback Permission',
              fromAgentDid,
              fromAgentName,
              toAgentDid,
              toAgentName,
              clientAddress.toLowerCase(),
              null,
              now * 1000, // store ms for last_message_at consistency with messages.created_at
              now * 1000,
              now * 1000,
            )
            .run();
          await db
            .prepare('UPDATE tasks SET updated_at = ?, last_message_at = ? WHERE id = ?')
            .bind(now * 1000, now * 1000, taskId)
            .run();

          await db
            .prepare(
              'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, task_id, task_type, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .bind(
              clientAddress.toLowerCase(),
              fromAgentDid,
              fromAgentName,
              null,
              toAgentDid,
              toAgentName,
              'Feedback request',
              messageBody,
              'feedback_auth_request',
              String(feedbackRequestId),
              taskId,
              'feedback_auth_request',
              now * 1000, // messages table uses milliseconds
              null,
            )
            .run();
          console.log('[ATP Agent] Created inbox message for feedback request:', {
            feedbackRequestId,
            clientAddress,
            fromAgentDid,
            fromAgentName,
            toAgentDid,
            toAgentName,
          });
        } catch (msgError) {
          console.warn('[ATP Agent] Failed to create inbox message for feedback request:', msgError);
        }

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.feedbackRequest = {
          id: feedbackRequestId,
          clientAddress,
          toAgentId: String(toAgentId),
          toAgentChainId,
          fromAgentId: fromAgentId ? String(fromAgentId) : null,
          fromAgentChainId,
          fromAgentDid,
          fromAgentName,
          toAgentDid,
          toAgentName,
          comment: comment.trim(),
          status: 'pending',
          createdAt: now,
        };
        responseContent.message = 'Feedback request stored successfully';
      } catch (error: any) {
        console.error('[ATP Agent] Error processing feedback request:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to process feedback request';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'atp.feedback.getRequests') {
      // This skill is only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.feedback.getRequests skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const clientAddress = payload?.clientAddress || payload?.client_address;

        if (!clientAddress) {
          responseContent.error = 'clientAddress (EOA address) is required in payload for atp.feedback.getRequests skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        if (!/^0x[a-fA-F0-9]{40}$/.test(clientAddress)) {
          responseContent.error = 'Invalid clientAddress format. Must be a valid Ethereum address (0x followed by 40 hex characters)';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot query feedback requests.');
        }

        console.log('[ATP Agent] Querying feedback requests for client address:', clientAddress);

        const requests = await db
          .prepare(
            'SELECT id, client_address, from_agent_id, from_agent_chain_id, to_agent_id, to_agent_chain_id, comment, status, feedback_auth, feedback_tx_hash, approved, approved_on_date, approved_for_days, from_agent_did, from_agent_name, to_agent_did, to_agent_name, created_at, updated_at FROM agent_feedback_requests WHERE client_address = ? ORDER BY created_at DESC'
          )
          .bind(clientAddress.toLowerCase())
          .all<any>();

        const feedbackRequests = (requests.results || []).map((req: any) => ({
          id: req.id,
          clientAddress: req.client_address,
          fromAgentId: req.from_agent_id || null,
          fromAgentChainId: req.from_agent_chain_id ?? null,
          toAgentId: req.to_agent_id,
          toAgentChainId: req.to_agent_chain_id ?? null,
          fromAgentDid: req.from_agent_did || null,
          fromAgentName: req.from_agent_name || null,
          toAgentDid: req.to_agent_did || null,
          toAgentName: req.to_agent_name || null,
          comment: req.comment,
          status: req.status,
          feedbackAuth: req.feedback_auth ? JSON.parse(req.feedback_auth) : null,
          feedbackTxHash: req.feedback_tx_hash || null,
          approved: Boolean(req.approved),
          approvedOnDate: req.approved_on_date ?? null,
          approvedForDays: req.approved_for_days ?? null,
          createdAt: req.created_at,
          updatedAt: req.updated_at,
        }));

        console.log('[ATP Agent] Found feedback requests:', feedbackRequests.length);

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.feedbackRequests = feedbackRequests;
        responseContent.count = feedbackRequests.length;
        responseContent.message = `Found ${feedbackRequests.length} feedback request(s) for ${clientAddress}`;
      } catch (error: any) {
        console.error('[ATP Agent] Error querying feedback requests:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to query feedback requests';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'atp.feedback.getRequestsByAgent') {
      // This skill is only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.feedback.getRequestsByAgent skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const targetAgentId = payload?.toAgentId || payload?.targetAgentId || payload?.target_agent_id || payload?.agentId;

        if (!targetAgentId) {
          responseContent.error = 'targetAgentId (agent ID) is required in payload for atp.feedback.getRequestsByAgent skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot query feedback requests.');
        }

        console.log('[ATP Agent] Querying feedback requests for target agent ID:', targetAgentId);

        const requests = await db
          .prepare(
            'SELECT id, client_address, from_agent_id, from_agent_chain_id, to_agent_id, to_agent_chain_id, comment, status, feedback_auth, feedback_tx_hash, approved, approved_on_date, approved_for_days, from_agent_did, from_agent_name, to_agent_did, to_agent_name, created_at, updated_at FROM agent_feedback_requests WHERE to_agent_id = ? ORDER BY created_at DESC'
          )
          .bind(String(targetAgentId))
          .all<any>();

        const feedbackRequests = (requests.results || []).map((req: any) => ({
          id: req.id,
          clientAddress: req.client_address,
          fromAgentId: req.from_agent_id || null,
          fromAgentChainId: req.from_agent_chain_id ?? null,
          toAgentId: req.to_agent_id,
          toAgentChainId: req.to_agent_chain_id ?? null,
          fromAgentDid: req.from_agent_did || null,
          fromAgentName: req.from_agent_name || null,
          toAgentDid: req.to_agent_did || null,
          toAgentName: req.to_agent_name || null,
          comment: req.comment,
          status: req.status,
          feedbackAuth: req.feedback_auth ? JSON.parse(req.feedback_auth) : null,
          feedbackTxHash: req.feedback_tx_hash || null,
          approved: Boolean(req.approved),
          approvedOnDate: req.approved_on_date ?? null,
          approvedForDays: req.approved_for_days ?? null,
          createdAt: req.created_at,
          updatedAt: req.updated_at,
        }));

        console.log('[ATP Agent] Found feedback requests for agent:', feedbackRequests.length);

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.feedbackRequests = feedbackRequests;
        responseContent.count = feedbackRequests.length;
        responseContent.message = `Found ${feedbackRequests.length} feedback request(s) for agent ID ${targetAgentId}`;
      } catch (error: any) {
        console.error('[ATP Agent] Error querying feedback requests by agent:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to query feedback requests';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'atp.feedback.markGiven') {
      // This skill is only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
          responseContent.error = 'atp.feedback.markGiven skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const { feedbackRequestId, txHash } = (payload || {}) as {
          feedbackRequestId?: number | string;
          txHash?: string;
        };

        if (!feedbackRequestId || !txHash) {
          responseContent.error = 'feedbackRequestId and txHash are required in payload for atp.feedback.markGiven skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot update feedback request.');
        }

        const requestId = typeof feedbackRequestId === 'string' ? parseInt(feedbackRequestId, 10) : Number(feedbackRequestId);

        if (!Number.isFinite(requestId)) {
          throw new Error('Invalid feedbackRequestId');
        }

        const now = Math.floor(Date.now() / 1000);

        await db
          .prepare('UPDATE agent_feedback_requests SET status = ?, feedback_tx_hash = ?, updated_at = ? WHERE id = ?')
          .bind('feedback_given', txHash, now, requestId)
          .run();

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.feedbackRequestId = requestId;
        responseContent.feedbackTxHash = txHash;
      } catch (error: any) {
        console.error('[ATP Agent] Error marking feedback request as given:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to mark feedback as given';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'atp.feedback.requestapproved') {
      // This skill is only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.feedback.requestapproved skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          403,
        );
      }

      try {
        const feedbackRequestIdRaw = (payload as any)?.feedbackRequestId ?? (payload as any)?.id;
        const feedbackRequestId = Number(feedbackRequestIdRaw);

        const fromAgentDid = normalizeDid((payload as any)?.fromAgentDid);
        const toAgentDid = normalizeDid((payload as any)?.toAgentDid);

        const approvedForDaysRaw = (payload as any)?.approvedForDays;
        const approvedForDays = Number(approvedForDaysRaw);

        if (!Number.isFinite(feedbackRequestId) || feedbackRequestId <= 0) {
          throw new Error('feedbackRequestId is required in payload for atp.feedback.requestapproved');
        }
        if (!fromAgentDid || !fromAgentDid.startsWith('did:8004:')) {
          throw new Error('fromAgentDid is required in payload for atp.feedback.requestapproved');
        }
        if (!toAgentDid || !toAgentDid.startsWith('did:8004:')) {
          throw new Error('toAgentDid is required in payload for atp.feedback.requestapproved');
        }
        if (!Number.isFinite(approvedForDays) || approvedForDays <= 0) {
          throw new Error('approvedForDays is required in payload for atp.feedback.requestapproved');
        }

        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot update feedback request.');
        }

        const req = await db
          .prepare(
            'SELECT id, client_address, from_agent_did, from_agent_name, to_agent_did, to_agent_name FROM agent_feedback_requests WHERE id = ?',
          )
          .bind(feedbackRequestId)
          .first<any>();

        if (!req) {
          throw new Error('Feedback request not found');
        }

        // Safety: ensure provided dids match stored request when present
        const storedFromDid = normalizeDid(req.from_agent_did);
        const storedToDid = normalizeDid(req.to_agent_did);
        if (storedFromDid && storedFromDid !== fromAgentDid) {
          throw new Error('fromAgentDid does not match stored request');
        }
        if (storedToDid && storedToDid !== toAgentDid) {
          throw new Error('toAgentDid does not match stored request');
        }

        const nowSec = Math.floor(Date.now() / 1000);
        await db
          .prepare(
            'UPDATE agent_feedback_requests SET approved = ?, approved_on_date = ?, approved_for_days = ?, status = ?, updated_at = ? WHERE id = ?',
          )
          .bind(1, nowSec, approvedForDays, 'approved', nowSec, feedbackRequestId)
          .run();

        // Create inbox message back to the requester (to the FROM agent)
        const nowMs = Date.now();
        const subject = 'Feedback request approved';
        const body =
          `Your feedback request has been approved.\n\n` +
          `feedbackRequestId: ${feedbackRequestId}\n` +
          `approvedForDays: ${approvedForDays}\n`;

        // Treat this as part of the same feedback_request task thread.
        await ensureTasksSchema(db);
        const taskId = String(feedbackRequestId);
        await db
          .prepare(
            `INSERT OR IGNORE INTO tasks (
              id, type, status, subject,
              from_agent_did, from_agent_name,
              to_agent_did, to_agent_name,
              created_at, updated_at, last_message_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            taskId,
            'feedback_auth_request',
            'open',
            'Request Feedback Permission',
            fromAgentDid,
            req.from_agent_name || null,
            toAgentDid,
            req.to_agent_name || null,
            nowMs,
            nowMs,
            nowMs,
          )
          .run();
        await db
          .prepare('UPDATE tasks SET updated_at = ?, last_message_at = ? WHERE id = ?')
          .bind(nowMs, nowMs, taskId)
          .run();

        await db
          .prepare(
            'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, task_id, task_type, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            null,
            toAgentDid,
            req.to_agent_name || null,
            null,
            fromAgentDid,
            req.from_agent_name || null,
            subject,
            body,
            'feedback_request_approved',
            String(feedbackRequestId),
            taskId,
            'feedback_auth_request',
            nowMs,
            null,
          )
          .run();

        responseContent.success = true;
        responseContent.skill = skillId;
        (responseContent as any).feedbackRequestId = feedbackRequestId;
        (responseContent as any).approved = true;
        (responseContent as any).approvedOnDate = nowSec;
        (responseContent as any).approvedForDays = approvedForDays;
      } catch (error: any) {
        console.error('[ATP Agent] Error approving feedback request:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to approve feedback request';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'atp.inbox.sendMessage') {
      // This skill is only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.inbox.sendMessage skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const {
          fromClientAddress,
          fromAgentDid: rawFromAgentDid,
          fromAgentName: rawFromAgentName,
          toClientAddress,
          toAgentDid: rawToAgentDid,
          toAgentName: rawToAgentName,
          subject,
          body,
          contextType,
          contextId,
        } = (payload || {}) as {
          fromClientAddress?: string;
          fromAgentDid?: string;
          fromAgentName?: string;
          toClientAddress?: string;
          toAgentDid?: string;
          toAgentName?: string;
          subject?: string;
          body?: string;
          contextType?: string;
          contextId?: string | number;
        };

        if (!body || body.trim().length === 0) {
          responseContent.error = 'body is required in payload for atp.inbox.sendMessage';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Normalize agent origin/destination
        let fromAgentDid = rawFromAgentDid || null;
        let fromAgentName = rawFromAgentName || null;
        let toAgentDid = rawToAgentDid || null;
        let toAgentName = rawToAgentName || null;

        try {
          const atClient = await getAgenticTrustClient();

          // Resolve FROM agent
          if (!fromAgentDid && fromAgentName) {
            try {
              let agent: any = null;
              let lookupName = fromAgentName;

              try {
                agent = await atClient.getAgentByName(lookupName);
              } catch {
                agent = null;
              }

              if (!agent && !lookupName.includes('.8004-agent.eth')) {
                const ensCandidate = `${lookupName}.8004-agent.eth`.toLowerCase();
                try {
                  agent = await atClient.getAgentByName(ensCandidate);
                  if (agent) {
                    lookupName = ensCandidate;
                  }
                } catch {
                  agent = null;
                }
              }

              if (agent && (agent as any).agentId && (agent as any).chainId) {
                const chainId = Number((agent as any).chainId);
                const agentIdStr = String((agent as any).agentId);
                fromAgentDid = `did:8004:${chainId}:${agentIdStr}`;
                fromAgentName = (agent as any).agentName || lookupName;
              }
            } catch (e) {
              console.warn('[ATP Agent] Failed to resolve FROM agent DID from name for inbox message:', e);
            }
          } else if (fromAgentDid && !fromAgentName) {
            try {
              const { agentId } = parseDid8004(fromAgentDid);
              const agent = await atClient.agents.getAgent(agentId.toString());
              if (agent && (agent as any).agentName) {
                fromAgentName = (agent as any).agentName as string;
              }
            } catch (e) {
              console.warn('[ATP Agent] Failed to resolve FROM agent name from DID for inbox message:', e);
            }
          }

          // Resolve TO agent if no explicit client recipient
          if (!toClientAddress && (toAgentName || toAgentDid)) {
            try {
              if (!toAgentDid && toAgentName) {
                let agent: any = null;
                let lookupName = toAgentName;

                try {
                  agent = await atClient.getAgentByName(lookupName);
                } catch {
                  agent = null;
                }

                if (!agent && !lookupName.includes('.8004-agent.eth')) {
                  const ensCandidate = `${lookupName}.8004-agent.eth`.toLowerCase();
                  try {
                    agent = await atClient.getAgentByName(ensCandidate);
                    if (agent) {
                      lookupName = ensCandidate;
                    }
                  } catch {
                    agent = null;
                  }
                }

                if (agent && (agent as any).agentId && (agent as any).chainId) {
                  const chainId = Number((agent as any).chainId);
                  const agentIdStr = String((agent as any).agentId);
                  toAgentDid = `did:8004:${chainId}:${agentIdStr}`;
                  toAgentName = (agent as any).agentName || lookupName;
                }
              } else if (toAgentDid && !toAgentName) {
                const { agentId } = parseDid8004(toAgentDid);
                const agent = await atClient.agents.getAgent(agentId.toString());
                if (agent && (agent as any).agentName) {
                  toAgentName = (agent as any).agentName as string;
                }
              }
            } catch (e) {
              console.warn('[ATP Agent] Failed to resolve TO agent identity for inbox message:', e);
            }
          }
        } catch (resolveError) {
          console.warn('[ATP Agent] Failed to resolve agent identity for inbox message:', resolveError);
        }

        if (!toClientAddress && !toAgentDid && !toAgentName) {
          responseContent.error = 'Either toClientAddress, toAgentDid, or toAgentName is required in payload for atp.inbox.sendMessage';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        if (!fromClientAddress && !fromAgentDid && !fromAgentName) {
          responseContent.error = 'Either fromClientAddress, fromAgentDid, or fromAgentName is required in payload for atp.inbox.sendMessage';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot store message.');
        }

        const now = Date.now();

        // Task normalization:
        // - If contextType matches a known task type, we treat this message as the start of (or part of) a task thread.
        // - If a contextId is not provided, we generate one and use it as the task id.
        await ensureTasksSchema(db);
        const taskType = normalizeTaskType(contextType);
        let taskId: string | null = contextId != null ? String(contextId) : null;
        if (taskType && !taskId) {
          taskId = generateTaskId(taskType);
        }

        if (taskType && taskId) {
          // Upsert task metadata (thread header). Keep it lightweight and idempotent.
          await db
            .prepare(
              `INSERT OR IGNORE INTO tasks (
                id, type, status, subject,
                from_agent_did, from_agent_name,
                to_agent_did, to_agent_name,
                from_client_address, to_client_address,
                created_at, updated_at, last_message_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              taskId,
              taskType,
              'open',
              subject || null,
              fromAgentDid || null,
              fromAgentName || null,
              toAgentDid || null,
              toAgentName || null,
              fromClientAddress ? fromClientAddress.toLowerCase() : null,
              toClientAddress ? toClientAddress.toLowerCase() : null,
              now,
              now,
              now,
            )
            .run();

          await db
            .prepare('UPDATE tasks SET updated_at = ?, last_message_at = ?, subject = COALESCE(subject, ?) WHERE id = ?')
            .bind(now, now, subject || null, taskId)
            .run();
        }

        const result = await db
          .prepare(
            'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, task_id, task_type, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            fromClientAddress ? fromClientAddress.toLowerCase() : null,
            fromAgentDid || null,
            fromAgentName || null,
            toClientAddress ? toClientAddress.toLowerCase() : null,
            toAgentDid || null,
            toAgentName || null,
            subject || null,
            body.trim(),
            taskType ? taskType : contextType || null,
            taskId != null ? taskId : contextId != null ? String(contextId) : null,
            taskId,
            taskType,
            now,
            null,
          )
          .run();

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.messageId = result.meta.last_row_id;
        responseContent.message = 'Message stored successfully';
      } catch (error: any) {
        console.error('[ATP Agent] Error storing inbox message:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to store message';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'atp.inbox.listClientMessages') {
      // This skill is only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.inbox.listClientMessages skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const clientAddress = payload?.clientAddress || payload?.client_address;

        if (!clientAddress) {
          responseContent.error = 'clientAddress (EOA address) is required in payload for atp.inbox.listClientMessages';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot query messages.');
        }
        await ensureTasksSchema(db);

        const addr = clientAddress.toLowerCase();
        const rows = await db
          .prepare(
            'SELECT id, from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, task_id, task_type, created_at, read_at FROM messages WHERE to_client_address = ? OR from_client_address = ? ORDER BY created_at DESC',
          )
          .bind(addr, addr)
          .all<any>();

        const messages = (rows.results || []).map((row: any) => ({
          id: row.id,
          fromClientAddress: row.from_client_address,
          fromAgentDid: row.from_agent_did,
          fromAgentName: row.from_agent_name,
          toClientAddress: row.to_client_address,
          toAgentDid: row.to_agent_did,
          toAgentName: row.to_agent_name,
          subject: row.subject,
          body: row.body,
          contextType: row.context_type,
          contextId: row.context_id,
          taskId: row.task_id ?? null,
          taskType: row.task_type ?? null,
          createdAt: row.created_at,
          readAt: row.read_at,
        }));

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.messages = messages;
        responseContent.count = messages.length;
      } catch (error: any) {
        console.error(
          '[ATP Agent] Error querying client messages:',
          error?.stack ? String(error.stack) : error,
        );
        responseContent.error = error instanceof Error ? error.message : 'Failed to query messages';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'atp.inbox.listAgentMessages') {
      // This skill is only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.inbox.listAgentMessages skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        let agentDid = payload?.agentDid || payload?.agent_did;

        if (!agentDid) {
          responseContent.error = 'agentDid is required in payload for atp.inbox.listAgentMessages';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        const rawAgentDid = String(agentDid).trim();
        const normalizedAgentDid = normalizeDid(rawAgentDid);
        agentDid = normalizedAgentDid || rawAgentDid;

        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot query messages.');
        }
        await ensureTasksSchema(db);

        const rows = await db
          .prepare(
            'SELECT id, from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, task_id, task_type, created_at, read_at FROM messages WHERE to_agent_did = ? OR to_agent_did = ? OR from_agent_did = ? OR from_agent_did = ? ORDER BY created_at DESC',
          )
          .bind(agentDid, rawAgentDid, agentDid, rawAgentDid)
          .all<any>();

        const messages = (rows.results || []).map((row: any) => ({
          id: row.id,
          fromClientAddress: row.from_client_address,
          fromAgentDid: row.from_agent_did,
          fromAgentName: row.from_agent_name,
          toClientAddress: row.to_client_address,
          toAgentDid: row.to_agent_did,
          toAgentName: row.to_agent_name,
          subject: row.subject,
          body: row.body,
          contextType: row.context_type,
          contextId: row.context_id,
          taskId: row.task_id ?? null,
          taskType: row.task_type ?? null,
          createdAt: row.created_at,
          readAt: row.read_at,
        }));

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.messages = messages;
        responseContent.count = messages.length;
      } catch (error: any) {
        console.error(
          '[ATP Agent] Error querying agent messages:',
          error?.stack ? String(error.stack) : error,
        );
        responseContent.error = error instanceof Error ? error.message : 'Failed to query messages';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'atp.stats.trends') {
      console.log('[ATP Agent] atp.stats.trends skill handler called, subdomain:', subdomain);
      // Only agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        console.warn('[ATP Agent] atp.stats.trends called on wrong subdomain:', subdomain);
        responseContent.error = 'atp.stats.trends skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }
      console.log('[ATP Agent] Processing atp.stats.trends request');
      try {
        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot query trends.');
        }

    // Global in-memory cache across all requests and sessions
    const now = Date.now();
    const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
    const cachedTrends = (globalThis as any).__trendsCache;
    const cachedAt = (globalThis as any).__trendsCacheAt;
    const forceRefresh = Boolean((payload as any)?.refresh);
    if (forceRefresh) {
      console.log('[ATP Agent] trends payload.refresh=true -> bypassing cache and recomputing');
    }
    
    // Check if we have valid cached data
    if (!forceRefresh && cachedTrends && cachedAt && (now - cachedAt < CACHE_TTL_MS)) {
      // Validate that cached data has actual content
      const hasData =
        cachedTrends.dailyMembers?.length > 0 ||
        cachedTrends.dailyAgents?.length > 0 ||
        cachedTrends.dailyEvents?.length > 0 ||
        cachedTrends.dailySdkApps?.length > 0 ||
        cachedTrends.sdkApps?.length > 0;
      
      if (hasData) {
        console.log('[ATP Agent] Returning cached trends (global cache)');
        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.trends = cachedTrends;
        return c.json({
          success: true,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
      } else {
        console.log('[ATP Agent] Cached trends has no data, fetching fresh data');
        // Clear invalid cache
        (globalThis as any).__trendsCache = null;
        (globalThis as any).__trendsCacheAt = null;
      }
    }

        // Daily members
    console.log('[ATP Agent] Querying daily members');
        const membersRows = await db
          .prepare(
            'SELECT day, new_members, cumulative_members FROM erc8004_daily_members ORDER BY day DESC LIMIT 60',
          )
          .all<any>();

        const dailyMembers = (membersRows.results || []).map((row: any) => ({
          day: row.day,
          newMembers: row.new_members,
          cumulativeMembers: row.cumulative_members,
        }));

        // Daily agents - query from indexer database
        console.log('[ATP Agent] Querying agents for daily counts from indexer database');
        const indexerDb = c.env?.INDEXER_DB || getIndexerD1Database({ INDEXER_DB: c.env?.INDEXER_DB });
        let dailyAgents: Array<{ day: string; newAgents: number; cumulativeAgents: number }> = [];
        
        if (!indexerDb) {
          console.warn('[ATP Agent] Indexer database not available, skipping daily agents');
        } else {
          const agentsRows = await indexerDb
            .prepare('SELECT createdAtTime FROM agents WHERE createdAtTime IS NOT NULL')
            .all<any>();

          const agentCounts: Record<string, number> = {};
          (agentsRows.results || []).forEach((row: any) => {
            const ts = row.createdAtTime;
            if (!ts) return;
            // createdAtTime is a Unix timestamp (seconds)
            const date = new Date(Number(ts) * 1000).toISOString().slice(0, 10);
            agentCounts[date] = (agentCounts[date] || 0) + 1;
          });

          const sortedAgentDates = Object.entries(agentCounts).sort((a, b) =>
            a[0] < b[0] ? -1 : 1,
          );
          let running = 0;
          dailyAgents = sortedAgentDates.map(([day, count]) => {
            running += count;
            return { day, newAgents: count, cumulativeAgents: running };
          });
        }

        // Daily events - always query from ATP database
        console.log('[ATP Agent] Querying daily events');
        const eventsRows = await db
          .prepare('SELECT event_date, title, description, kind, link FROM erc8004_events ORDER BY event_date DESC')
          .all<any>();

        const dailyEvents = (eventsRows.results || []).map((row: any) => ({
          day: row.event_date,
          title: row.title,
          description: row.description,
          kind: row.kind,
          link: row.link,
        }));

        // SDKs/Apps/Infra - always query from ATP database
        console.log('[ATP Agent] Querying tech (SDKs/Apps/Infra) first-seen list');
        const sdkAppsRows = await db
          .prepare(
            'SELECT date_first_seen, name, kind, homepage_url, description FROM erc8004_tech ORDER BY date_first_seen DESC, id DESC',
          )
          .all<any>();

        const sdkApps = (sdkAppsRows.results || []).map((row: any) => ({
          day: row.date_first_seen,
          name: row.name,
          kind: row.kind,
          homepageUrl: row.homepage_url || null,
          description: row.description,
        }));

        // Daily SDKs/Apps counts
        const sdkCounts: Record<string, number> = {};
        sdkApps.forEach((item: any) => {
          const day = String(item.day || '').slice(0, 10);
          if (!day) return;
          sdkCounts[day] = (sdkCounts[day] || 0) + 1;
        });
        const sortedSdkDates = Object.entries(sdkCounts).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        let sdkRunning = 0;
        const dailySdkApps = sortedSdkDates.map(([day, count]) => {
          sdkRunning += count;
          return { day, newSdkApps: count, cumulativeSdkApps: sdkRunning };
        });

        responseContent.trends = {
          dailyMembers: dailyMembers.reverse(),
          dailyAgents,
          dailyEvents,
          dailySdkApps,
          sdkApps,
        };

        // Only cache if we have actual data
        const hasData =
          dailyMembers.length > 0 ||
          dailyAgents.length > 0 ||
          dailyEvents.length > 0 ||
          dailySdkApps.length > 0 ||
          sdkApps.length > 0;
        if (hasData) {
          // Cache the results globally across all requests and sessions
          (globalThis as any).__trendsCache = responseContent.trends;
          (globalThis as any).__trendsCacheAt = now;
          console.log('[ATP Agent] Cached trends data globally');
        } else {
          console.log('[ATP Agent] No data to cache, skipping cache update');
        }

        responseContent.success = true;
        responseContent.skill = skillId;
        
        const trends = responseContent.trends as {
          dailyMembers?: Array<unknown>;
          dailyAgents?: Array<unknown>;
          dailyEvents?: Array<unknown>;
          dailySdkApps?: Array<unknown>;
          sdkApps?: Array<unknown>;
        } | undefined;
        console.log('[ATP Agent] Trends data prepared:', {
          dailyMembers: trends?.dailyMembers?.length || 0,
          dailyAgents: trends?.dailyAgents?.length || 0,
          dailyEvents: trends?.dailyEvents?.length || 0,
          dailySdkApps: trends?.dailySdkApps?.length || 0,
          sdkApps: trends?.sdkApps?.length || 0,
        });
        console.log('[ATP Agent] Returning trends response');
        
        return c.json({
          success: true,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
      } catch (error: any) {
        console.error('[ATP Agent] Error fetching trends:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to fetch trends';
        responseContent.skill = skillId;
        responseContent.success = false;
        
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 500);
      }
    } else if (skillId === 'atp.stats.sdkApps') {
      console.log('[ATP Agent] atp.stats.sdkApps skill handler called, subdomain:', subdomain);
      // Only agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.stats.sdkApps skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          403,
        );
      }

      try {
        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot query sdk/apps.');
        }

        const sdkAppsRows = await db
          .prepare(
            'SELECT date_first_seen, name, kind, homepage_url, description FROM erc8004_tech ORDER BY date_first_seen DESC, id DESC',
          )
          .all<any>();

        const items = (sdkAppsRows.results || []).map((row: any) => ({
          day: row.date_first_seen,
          name: row.name,
          kind: row.kind,
          homepageUrl: row.homepage_url || null,
          description: row.description,
        }));

        const counts: Record<string, number> = {};
        items.forEach((item: any) => {
          const day = String(item.day || '').slice(0, 10);
          if (!day) return;
          counts[day] = (counts[day] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        let running = 0;
        const daily = sorted.map(([day, count]) => {
          running += count;
          return { day, newSdkApps: count, cumulativeSdkApps: running };
        });

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.sdkApps = {
          total: items.length,
          items,
          daily,
        };

        return c.json({
          success: true,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
      } catch (error: any) {
        console.error('[ATP Agent] Error querying sdk/apps:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to query sdk/apps';
        responseContent.skill = skillId;
        responseContent.success = false;

        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          500,
        );
      }
    } else if (skillId === 'atp.inbox.markRead') {
      // This skill is only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.inbox.markRead skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const { messageId } = (payload || {}) as { messageId?: number | string };

        if (!messageId) {
          responseContent.error = 'messageId is required in payload for atp.inbox.markRead';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        const db = c.env?.DB || getD1Database(c.env);
        if (!db) {
          throw new Error('D1 database is not available. Cannot update messages.');
        }

        const id = typeof messageId === 'string' ? parseInt(messageId, 10) : Number(messageId);

        if (!Number.isFinite(id)) {
          throw new Error('Invalid messageId');
        }

        const now = Date.now();

        await db
          .prepare('UPDATE messages SET read_at = ? WHERE id = ?')
          .bind(now, id)
          .run();

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.messageId = id;
        responseContent.readAt = now;
      } catch (error: any) {
        console.error('[ATP Agent] Error marking message as read:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to mark message as read';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId) {
      console.warn('[ATP Agent] Skill not handled. Request will fall through to generic handler.', {
        skillId,
        subdomain,
        host: new URL(c.req.url).hostname,
        hasPayload: Boolean(payload),
        knownHandledSkills: handledSkillIdsForDebug,
      });
      if (rpcMode) {
        return c.json(
          jsonRpcError(rpcId, -32601, `Method not found: ${skillId}`, {
            knownMethods: handledSkillIdsForDebug,
          }),
        );
      }
      responseContent.response = `Received request for skill: ${skillId}. This skill is not yet implemented.`;
      responseContent.skill = skillId;
    } else {
      console.log('[ATP Agent] No skillId provided, using generic response');
    }

    // Note: A2A protocol messages are not stored in the database
    // The 'messages' table is for collaboration messages between users/agents, not A2A protocol messages

    // Generate a response
    const response = {
      success: true,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      response: responseContent,
    };

    // Serialize BigInt values to strings before JSON serialization
    const serializedResponse = serializeBigInt(response);

    return c.json(serializedResponse);
  } catch (error) {
    console.error('Error processing A2A request:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};

// Accept both /api/a2a and /api/a2a/ (Cloudflare/Hono can treat these as distinct).
app.post('/api/a2a', waitForClientInit, handleA2A);
app.post('/api/a2a/', waitForClientInit, handleA2A);

// OPTIONS preflight for A2A
app.options('/api/a2a', (c: HonoContext) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
});

// Accept both /api/a2a and /api/a2a/ for preflight too.
app.options('/api/a2a/', (c: HonoContext) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
});

// Log unmatched routes (helps diagnose 404s caused by path mismatch like trailing slashes).
app.notFound((c: HonoContext) => {
  try {
    const url = new URL(c.req.url);
    console.warn('[ATP Agent] 404 Not Found (no route match)', {
      method: c.req.method,
      path: url.pathname,
      host: url.hostname,
    });
  } catch {
    console.warn('[ATP Agent] 404 Not Found (no route match)');
  }
  return c.text('Not Found', 404);
});

// Health check endpoint
app.get('/health', (c: HonoContext) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export default handler for Cloudflare Workers
export default app;

