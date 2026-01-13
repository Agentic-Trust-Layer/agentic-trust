/**
 * Express.js ATP Agent Server
 * 
 * This is an Express-only A2A (Agent-to-Agent) application that uses @agentic-trust/core
 * for agent management, A2A protocol, and ERC-8004 feedback authentication.
 * 
 * Uses Cloudflare D1 database for persistent storage.
 */

// Load environment variables from .env file
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file from the atp-agent app root directory
config({ path: resolve(process.cwd(), '.env') });

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import {
  getAgenticTrustClient,
  loadSessionPackage,
  mountAgentApiRoutes,
  getENSClient,
  isENSNameAvailable,
  getAgentValidationsSummary,
  DEFAULT_CHAIN_ID,
  type SessionPackage,
  storeErc8092AssociationWithSessionDelegation,
  buildDelegatedAssociationContext,
} from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';
import { getD1Database, type D1Database } from './lib/d1-wrapper';
import {
  bytesToHex,
  concatHex,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  keccak256,
  stringToHex,
} from 'viem';

function tryParseEvmV1(interoperableHex: string): { chainId: number; address?: string } | null {
  try {
    const bytes = hexToBytes(interoperableHex as `0x${string}`);
    if (bytes.length < 6) return null;
    const version = (bytes[0]! << 8) | bytes[1]!;
    if (version !== 0x0001) return null;
    const chainType = (bytes[2]! << 8) | bytes[3]!;
    if (chainType !== 0x0000) return null;
    const chainRefLen = bytes[4]!;
    if (bytes.length < 6 + chainRefLen) return null;
    const chainRefStart = 5;
    const chainRefEnd = chainRefStart + chainRefLen;
    const addrLen = bytes[chainRefEnd]!;
    const addrStart = chainRefEnd + 1;
    const addrEnd = addrStart + addrLen;
    if (bytes.length < addrEnd) return null;

    let chainId = 0;
    for (let i = chainRefStart; i < chainRefEnd; i++) chainId = (chainId << 8) + bytes[i]!;

    if (addrLen === 20) {
      const addrBytes = bytes.slice(addrStart, addrEnd);
      return { chainId, address: getAddress(bytesToHex(addrBytes)) };
    }
    return { chainId };
  } catch {
    return null;
  }
}

function associationIdFromRecord(rec: {
  initiator: `0x${string}`;
  approver: `0x${string}`;
  validAt: number;
  validUntil: number;
  interfaceId: `0x${string}`;
  data: `0x${string}`;
}): `0x${string}` {
  const DOMAIN_TYPEHASH = keccak256(stringToHex('EIP712Domain(string name,string version)'));
  const NAME_HASH = keccak256(stringToHex('AssociatedAccounts'));
  const VERSION_HASH = keccak256(stringToHex('1'));
  const MESSAGE_TYPEHASH = keccak256(
    stringToHex(
      'AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)',
    ),
  );

  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH],
    ),
  );

  const hashStruct = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint40' },
        { type: 'uint40' },
        { type: 'bytes4' },
        { type: 'bytes32' },
      ],
      [
        MESSAGE_TYPEHASH,
        keccak256(rec.initiator),
        keccak256(rec.approver),
        rec.validAt,
        rec.validUntil,
        rec.interfaceId as `0x${string}`,
        keccak256(rec.data),
      ],
    ),
  );

  return keccak256(concatHex(['0x1901', domainSeparator, hashStruct])) as `0x${string}`;
}

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
  return out.replace(/%3A/gi, ':');
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3003;

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Extract subdomain (e.g. "abc" from "abc.localhost")
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

// Attach providerSubdomain and resolve ENS-based agent account per request
app.use(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    console.log('[ATP Agent Server] Incoming request host:', req.hostname);
    const baseDomain = process.env.PROVIDER_BASE_DOMAIN || 'localhost';
    const subdomain = extractSubdomain(req.hostname, baseDomain);

    (req as any).providerSubdomain = subdomain;

    let providerEnsName: string | null = null;
    let providerAgentAccount: string | null = null;

    if (subdomain) {
      providerEnsName = `${subdomain}.8004-agent.eth`;
      try {
        const ensClient = await getENSClient();
        providerAgentAccount = await ensClient.getAgentAccountByName(providerEnsName);
      } catch (err) {
        console.error(
          '[ATP Agent Server] Error resolving ENS account for',
          providerEnsName,
          err,
        );
      }
    }

    (req as any).providerEnsName = providerEnsName;
    (req as any).providerAgentAccount = providerAgentAccount;

    if (process.env.NODE_ENV === 'development') {
      console.log(
        '[ATP Agent Server] Routing context:',
        JSON.stringify(
          {
            host: req.hostname,
            subdomain,
            ensName: providerEnsName,
            agentAccount: providerAgentAccount,
          },
          null,
          2,
        ),
      );
    }

    next();
  } catch (error) {
    console.error('[ATP Agent Server] Error in subdomain/ENS middleware:', error);
    next(error);
  }
});

// Mount Agentic Trust agent management routes
mountAgentApiRoutes(
  {
    post: (path, handler) =>
      app.post(path, (req, res) => handler(req as any, res as any)),
    get: (path, handler) =>
      app.get(path, (req, res) => handler(req as any, res as any)),
    put: (path, handler) =>
      app.put(path, (req, res) => handler(req as any, res as any)),
  },
  {
    basePath: '/api/agents',
    createContext: (req) => {
      const headers = (req as any).headers as
        | Record<string, unknown>
        | undefined;
      const subdomain = (req as any).providerSubdomain as string | null | undefined;
      const requestId =
        headers && typeof headers['x-request-id'] === 'string'
          ? (headers['x-request-id'] as string)
          : undefined;
      return {
        requestId,
        tenantId: subdomain ?? undefined,
      };
    },
  },
);

// Pre-initialize the AgenticTrustClient when the module loads
let clientInitPromise: Promise<void> | null = null;
if (typeof process !== 'undefined') {
  clientInitPromise = (async () => {
    try {
      console.log('[ATP Agent Server] Pre-initializing AgenticTrustClient...');
      await getAgenticTrustClient();
      console.log('[ATP Agent Server] AgenticTrustClient initialized successfully');
    } catch (error) {
      console.error('[ATP Agent Server] Failed to pre-initialize AgenticTrustClient:', error);
    }
  })();
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

  // NOTE: avoid multi-statement exec; it can behave differently across D1 adapters/runtimes.
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

/**
 * Middleware to wait for client initialization
 */
async function waitForClientInit(req: Request, res: Response, next: NextFunction) {
  if (clientInitPromise) {
    try {
      await clientInitPromise;
    } catch (error) {
      console.warn('[ATP Agent Server] Pre-initialization failed, will initialize on demand:', error);
    }
  }
  next();
}

/**
 * Simple root handler
 */
app.get('/', (req: Request, res: Response) => {
  const subdomain = (req as any).providerSubdomain as string | null | undefined;
  res.json({
    message: 'ATP Agent is running',
    host: req.hostname,
    subdomain: subdomain || null,
    note: 'Try /.well-known/agent-card.json or /api/a2a for agent endpoints.',
  });
});

/**
 * Agent card endpoints
 * Primary: /.well-known/agent-card.json (v1.0)
 * Legacy:  /.well-known/agent.json (alias)
 */
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
      id: 'oasf:trust.feedback.authorization',
      name: 'oasf:trust.feedback.authorization',
      tags: ['erc8004', 'feedback', 'auth', 'a2a'],
      examples: ['Client requests feedbackAuth after receiving results'],
      inputModes: ['text'],
      outputModes: ['text', 'json'],
      description: 'Issue a signed ERC-8004 feedbackAuth for a client to submit feedback',
    },
    {
      id: 'oasf:trust.validate.name',
      name: 'oasf:trust.validate.name',
      tags: ['erc8004', 'validation', 'attestation', 'a2a'],
      examples: ['Submit a validation response for a pending validation request'],
      inputModes: ['text', 'json'],
      outputModes: ['text', 'json'],
      description: 'Submit a validation response (attestation) using a configured session package.',
    },
    {
      id: 'atp.account.addOrUpdate',
      name: 'atp.account.addOrUpdate',
      tags: ['atp', 'account', 'database', 'a2a'],
      examples: ['Add or update user account in ATP database'],
      inputModes: ['text'],
      outputModes: ['text'],
      description: 'Add or update an account in the ATP accounts table',
    },
    {
      id: 'atp.agent.get',
      name: 'atp.agent.get',
      tags: ['atp', 'agent', 'database', 'a2a'],
      examples: ['Get agent record/config from ATP database'],
      inputModes: ['text', 'json'],
      outputModes: ['text', 'json'],
      description: 'Get an agent from the ATP agents table. Payload: { ens_name? | agent_name? | agent_account? }',
    },
    {
      id: 'atp.agent.createOrUpdate',
      name: 'atp.agent.createOrUpdate',
      tags: ['atp', 'agent', 'database', 'a2a'],
      examples: ['Create or update agent in ATP database'],
      inputModes: ['text', 'json'],
      outputModes: ['text', 'json'],
      description: 'Create or update an agent in the ATP agents table (supports session_package and agent_card_json).',
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

async function ensureAgentsSchema(db: D1Database): Promise<void> {
  // Agents table is provisioned externally in prod, but keep this safe for local/dev and incremental schema.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ens_name TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        email_domain TEXT NULL,
        agent_account TEXT NULL,
        chain_id INTEGER NULL,
        session_package TEXT NULL,
        agent_card_json TEXT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );`,
    )
    .run();

  try {
    await db.prepare('ALTER TABLE agents ADD COLUMN agent_card_json TEXT NULL;').run();
  } catch {}
}

const serveAgentCard = async (req: Request, res: Response) => {
  const subdomain = (req as any).providerSubdomain as string | null | undefined;
  const agentName = process.env.AGENT_NAME || 'ATP Agent';
  const agentDescription = process.env.AGENT_DESCRIPTION || 'An ATP agent for A2A communication';

  // Use request origin so subdomains advertise the correct host.
  const protoHeader = (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol || 'https';
  const hostHeader = (req.headers['x-forwarded-host'] as string | undefined) || req.get('host') || req.hostname;
  const origin = `${protoHeader}://${hostHeader}`.replace(/\/$/, '');
  const messageEndpoint = `${origin}/api/a2a`;

  const rawSkills = buildSkills(subdomain);

  // If this request is for a tenant subdomain (i.e. a specific provider agent),
  // load the per-agent agent_card_json config and filter the advertised skills accordingly.
  let configuredSkillIds: string[] | null = null;
  let configuredCardName: string | null = null;
  let configuredCardDescription: string | null = null;
  if (subdomain) {
    try {
      const db = getD1Database();
      await ensureAgentsSchema(db);

      let baseAgentName = subdomain.trim();
      baseAgentName = baseAgentName.replace(/-8004-agent-eth$/i, '').replace(/-8004-agent$/i, '');
      const baseAgentNameLower = baseAgentName.toLowerCase();
      const ensName = `${baseAgentNameLower}.8004-agent.eth`;
      const ensNameDup = `${ensName}.8004-agent.eth`;

      const agentRecord = await db
        .prepare(
          `SELECT id, ens_name, agent_name, agent_card_json, updated_at
           FROM agents
           WHERE ens_name = ? COLLATE NOCASE
              OR ens_name = ? COLLATE NOCASE
              OR agent_name = ? COLLATE NOCASE
              OR agent_name = ? COLLATE NOCASE
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .bind(ensName, ensNameDup, baseAgentNameLower, ensName)
        .first<{ id: number; ens_name: string; agent_name: string; agent_card_json: string | null; updated_at: number }>();

      const raw = agentRecord?.agent_card_json;
      if (raw && typeof raw === 'string' && raw.trim().length > 0) {
        try {
          const parsed = JSON.parse(raw);
          const skillIds =
            Array.isArray((parsed as any)?.skillIds) ? (parsed as any).skillIds :
            Array.isArray((parsed as any)?.skills) ? (parsed as any).skills :
            null;
          if (Array.isArray(skillIds)) {
            configuredSkillIds = skillIds.map((s: any) => String(s)).filter(Boolean);
          }
          if (typeof (parsed as any)?.name === 'string') {
            configuredCardName = (parsed as any).name;
          }
          if (typeof (parsed as any)?.description === 'string') {
            configuredCardDescription = (parsed as any).description;
          }
        } catch {
          // ignore invalid agent_card_json
        }
      }
    } catch (err) {
      console.warn('[ATP Agent] Failed to load agent_card_json for agent-card:', err);
    }
  }
  const addOsafOverlayTags = (skill: any): any => {
    const id = String(skill?.id || '').trim();
    const existingTags = Array.isArray(skill?.tags) ? skill.tags : [];
    const outTags = new Set<string>(existingTags.map((t: any) => String(t)));

    const add = (t: string) => outTags.add(t);
    add('oasfExtension:true');

    if (id === 'oasf:trust.feedback.authorization') {
      add('oasf:trust.feedback.authorization');
      add('oasfDomain:governance-and-trust');
    }
    if (id.startsWith('atp.inbox.')) {
      add('oasf:agent_interaction.request_handling');
      add('oasf:integration.protocol_handling');
      add('oasfDomain:collaboration');
    }
    if (id.startsWith('atp.feedback.')) {
      add('oasf:trust.feedback.authorization');
      add('oasfDomain:governance-and-trust');
      add('oasfDomain:collaboration');
    }
    if (id.startsWith('atp.stats.')) {
      add('oasf:governance.audit.provenance');
      add('oasfDomain:governance-and-trust');
    }
    if (id === 'oasf:trust.validate.name') {
      add('oasf:trust.validate.name');
      add('oasfDomain:governance-and-trust');
      add('oasfDomain:collaboration');
    }
    if (id === 'oasf:trust.validate.account') {
      add('oasf:trust.validate.account');
      add('oasfDomain:governance-and-trust');
      add('oasfDomain:collaboration');
    }
    if (id === 'oasf:trust.validate.app') {
      add('oasf:trust.validate.app');
      add('oasfDomain:governance-and-trust');
      add('oasfDomain:collaboration');
    }

    return { ...skill, tags: Array.from(outTags) };
  };
  const skillsAll = (rawSkills as any[]).map((s: any) => ({
    ...addOsafOverlayTags(s),
    inputModes: normalizeModes(s.inputModes),
    outputModes: normalizeModes(s.outputModes),
  }));

  const skills = (() => {
    if (!configuredSkillIds || configuredSkillIds.length === 0) return skillsAll;

    const wanted = configuredSkillIds.map((s) => String(s).trim()).filter(Boolean);
    const wantedSet = new Set(wanted);

    const matches = (skill: any): boolean => {
      const id = String(skill?.id || '').trim();
      if (id && wantedSet.has(id)) return true;

      const tags: string[] = Array.isArray(skill?.tags) ? skill.tags.map((t: any) => String(t)) : [];
      for (const w of wanted) {
        if (!w) continue;
        // Allow matching by explicit tag strings (e.g. "oasf:trust.feedback.authorization")
        if (tags.includes(w)) return true;
        // Allow matching by OASF skill taxonomy without prefix (e.g. "trust.feedback.authorization")
        if (!w.includes(':') && tags.includes(`oasf:${w}`)) return true;
      }
      return false;
    };

    const filtered = skillsAll.filter((s: any) => matches(s));
    if (filtered.length === 0 && skillsAll.length > 0) {
      console.warn('[ATP Agent] agent_card_json skill filter produced 0 skills; falling back to full skill list', {
        subdomain,
        configuredSkillIds: wanted,
      });
      return skillsAll;
    }
    return filtered;
  })();

  const oasfDomains = ['governance-and-trust', 'security', 'collaboration'] as const;
  const oasfSkills = [
    'agent_interaction.request_handling',
    'integration.protocol_handling',
    'trust.identity.validation',
    'trust.feedback.authorization',
    'trust.validate.name',
    'trust.validate.account',
    'trust.validate.app',
    'trust.association.attestation',
    'trust.membership.attestation',
    'trust.delegation.attestation',
    'relationship.association.revocation',
    'delegation.request.authorization',
    'delegation.payload.verification',
    'governance.audit.provenance',
  ] as const;

  const agentCard = {
    protocolVersion: '1.0',
    name: configuredCardName ?? (subdomain ? `${agentName} (${subdomain})` : agentName),
    description: configuredCardDescription ?? agentDescription,
    version: process.env.AGENT_VERSION || '0.1.0',
    supportedInterfaces: [{ url: messageEndpoint, protocolBinding: 'JSONRPC' }],
    provider: {
      organization: process.env.PROVIDER_ORGANIZATION || 'ATP',
      url: origin,
    },
    capabilities: {
      streaming: process.env.CAPABILITY_STREAMING === 'true',
      pushNotifications: process.env.CAPABILITY_PUSH_NOTIFICATIONS === 'true',
      stateTransitionHistory: process.env.CAPABILITY_STATE_HISTORY === 'true',
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
          description: 'OASF/OASF extension metadata: domains + skill taxonomy overlay (ATP/Agentic Trust).',
          required: false,
          params: {
            oasfExtension: true,
            domains: oasfDomains,
            skills: oasfSkills,
            skillOverlay: {
              'oasf:trust.feedback.authorization': ['trust.feedback.authorization'],
              'atp.feedback.request': ['trust.feedback.authorization', 'collaboration'],
              'atp.feedback.getRequests': ['trust.feedback.authorization', 'collaboration'],
              'atp.feedback.getRequestsByAgent': ['trust.feedback.authorization', 'collaboration'],
              'atp.feedback.markGiven': ['trust.validate.name', 'collaboration'],
              'atp.feedback.requestapproved': ['trust.feedback.authorization', 'collaboration'],
              'oasf:trust.validate.name': ['trust.validate.name', 'collaboration'],
              'oasf:trust.validate.account': ['trust.validate.account', 'collaboration'],
              'oasf:trust.validate.app': ['trust.validate.app', 'collaboration'],
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

  res.set({
    'Content-Type': 'application/json',
    ...getCorsHeaders(),
  });
  res.json(agentCard);
};

app.get('/.well-known/agent-card.json', serveAgentCard);
app.get('/.well-known/agent.json', serveAgentCard);

/**
 * Handle OPTIONS preflight for agent cards
 */
app.options('/.well-known/agent-card.json', (req: Request, res: Response) => {
  res.set(getCorsHeaders());
  res.status(204).send();
});

app.options('/.well-known/agent.json', (req: Request, res: Response) => {
  res.set(getCorsHeaders());
  res.status(204).send();
});

/**
 * A2A (Agent-to-Agent) API Endpoint
 * Handles incoming A2A messages from other agents
 */
app.post('/api/a2a', waitForClientInit, async (req: Request, res: Response) => {
  const subdomain = (req as any).providerSubdomain as string | null | undefined;
  console.log('========================================');
  console.log('[ATP Agent A2A] POST request received at', new Date().toISOString());
  console.log('[ATP Agent A2A] Host:', req.hostname, 'subdomain:', subdomain || '(none)');
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

    const body: any = req.body;
    const rpcMode = isJsonRpcRequest(body);
    const rpcId = rpcMode ? (body as any).id ?? null : null;

    // If JSON-RPC, wrap all res.json responses as JSON-RPC results/errors.
    if (rpcMode) {
      const originalJson = res.json.bind(res);
      (res as any).json = (payloadOut: any) => {
        const st = res.statusCode || 200;

        // If handler already returned a JSON-RPC object, pass through unchanged.
        if (payloadOut && typeof payloadOut === 'object' && (payloadOut as any).jsonrpc === '2.0') {
          res.status(200);
          return originalJson(payloadOut);
        }

        const serialized = serializeBigInt(payloadOut);

        // Convert HTTP-ish errors into JSON-RPC errors.
        if (st >= 400) {
          const msg =
            (serialized as any)?.error ||
            (serialized as any)?.response?.error ||
            `A2A request failed (HTTP ${st})`;
          res.status(200);
          return originalJson(jsonRpcError(rpcId, -32000, String(msg), serialized));
        }

        res.status(200);
        return originalJson(jsonRpcResult(rpcId, serialized));
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
      res.set(getCorsHeaders());
      return res.status(400).json({
        success: false,
        error: 'fromAgentId and toAgentId are required (unless skillId is provided)',
      });
    }

    // Verify authentication if provided
    let authenticatedClientAddress: string | null = null;
    if (auth) {
      const atClient = await getAgenticTrustClient();
      const protoHeader = (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol || 'https';
      const hostHeader = (req.headers['x-forwarded-host'] as string | undefined) || req.get('host') || req.hostname;
      const providerUrl = `${protoHeader}://${hostHeader}`.replace(/\/$/, '');

      const verification = await atClient.verifyChallenge(auth, providerUrl);

      if (!verification.valid) {
        res.set(getCorsHeaders());
        return res.status(401).json({
          success: false,
          error: `Authentication failed: ${verification.error}`,
        });
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
      'oasf:trust.feedback.authorization',
      'oasf:trust.validate.name',
      'oasf:trust.validate.account',
      'oasf:trust.validate.app',
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

    // Always log skill routing so we can debug 404s / mismatches in prod (Cloudflare logs).
    console.log('[ATP Agent] Routing skill:', {
      skillId,
      subdomain,
      host: req.hostname,
      hasPayload: Boolean(payload),
      hasAuth: Boolean(auth),
    });

    if (skillId === 'atp.ens.isNameAvailable') {
      responseContent.skill = skillId;
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.ens.isNameAvailable skill is only available on the agents-atp subdomain';
        res.set(getCorsHeaders());
        return res.status(403).json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
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
        res.set(getCorsHeaders());
        return res.status(400).json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
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

      res.set(getCorsHeaders());
      return res.json({
        success: true,
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        response: responseContent,
      });
    }

    // Handle feedback request auth skill
    if (skillId === 'oasf:trust.feedback.authorization') {
      try {
        const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA;
        if (!rpcUrl) {
          responseContent.error = 'RPC URL not configured';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(500).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
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
          const db = getD1Database();
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
            res.set(getCorsHeaders());
            return res.status(404).json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            });
          }

          // Must be approved before we issue feedbackAuth
          const approved = Number(requestRecord.approved || 0) === 1;
          if (!approved) {
            responseContent.error = 'Feedback request is not approved yet';
            responseContent.skill = skillId;
            res.set(getCorsHeaders());
            return res.status(400).json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            });
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
              res.set(getCorsHeaders());
              return res.status(400).json({
                success: false,
                messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                response: responseContent,
              });
            }
          }

          clientAddress = requestRecord.client_address;
          agentIdParam = requestRecord.to_agent_id;
          (payload as any).chainId = requestRecord.to_agent_chain_id;
        }

        if (!clientAddress) {
          responseContent.error = 'clientAddress is required in payload for oasf:trust.feedback.authorization skill';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        // Load SessionPackage from database using subdomain
        let sessionPackage: SessionPackage | null = null;
        let agentIdForRequest: string | undefined;

        // Try to load session package from database using subdomain
        if (subdomain) {
          try {
            const db = getD1Database();
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
          const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
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
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
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
        console.log('*****************  [ATP Agent] Setting session package on agent instance');
        agent.setSessionPackage(sessionPackage);

        // Debug: confirm whether we received a delegation SAR for this request (required to store ERC-8092 on-chain)
        try {
          console.log('**************** [ATP Agent] (payload as any): ', (payload as any));
          const delegationSarDebug = (payload as any)?.delegationSar;
          const keys =
            delegationSarDebug && typeof delegationSarDebug === 'object'
              ? Object.keys(delegationSarDebug as any)
              : [];
          console.log('[ATP Agent] delegationSar debug:', {
            present: !!delegationSarDebug,
            type: typeof delegationSarDebug,
            keys,
          });
        } catch {
          console.log('**************** [ATP Agent] No delegationSar provided');
        }

        // OPTIONAL: client-provided ERC-8092 delegation SAR payload (record + initiator signature).
        // If present, we will complete approver signature (agentAccount via MetaMask delegation)
        // and store the association on-chain BEFORE returning feedbackAuth.
        const delegationSarRaw = (payload as any)?.delegationSar;
        if (delegationSarRaw && typeof delegationSarRaw === 'object') {
          console.log('[ATP Agent] delegationSar provided; will attempt to store on-chain before returning feedbackAuth');
          try {
            const chainIdForStore =
              typeof (payload as any)?.chainId === 'number'
                ? (payload as any).chainId
                : Number.isFinite(Number((payload as any)?.chainId))
                  ? Number((payload as any).chainId)
                  : sessionPackage.chainId;

            const recordRaw = (delegationSarRaw as any)?.record;
            const initiatorSignatureRaw = String((delegationSarRaw as any)?.initiatorSignature || '').trim();
            if (!recordRaw || typeof recordRaw !== 'object') {
              throw new Error('delegationSar.record is required');
            }
            if (!initiatorSignatureRaw || initiatorSignatureRaw === '0x') {
              throw new Error('delegationSar.initiatorSignature is required');
            }

            const record = {
              initiator: String((recordRaw as any).initiator),
              approver: String((recordRaw as any).approver),
              validAt: Number((recordRaw as any).validAt ?? 0),
              validUntil: Number((recordRaw as any).validUntil ?? 0),
              interfaceId: String((recordRaw as any).interfaceId ?? '0x00000000'),
              data: String((recordRaw as any).data ?? '0x'),
            };

            const initiatorParsed = tryParseEvmV1(record.initiator);
            const approverParsed = tryParseEvmV1(record.approver);
            const initiatorAddr = initiatorParsed?.address ? initiatorParsed.address.toLowerCase() : null;
            const approverAddr = approverParsed?.address ? approverParsed.address.toLowerCase() : null;

            if (!initiatorAddr || initiatorAddr !== String(clientAddress).toLowerCase()) {
              throw new Error('delegationSar.record.initiator does not match clientAddress');
            }
            if (!approverAddr || approverAddr !== String(sessionPackage.aa).toLowerCase()) {
              throw new Error('delegationSar.record.approver does not match sessionPackage.aa');
            }

            const associationId = associationIdFromRecord(record as any);

            // Build delegated association context so we can sign approverSignature in a way
            // that validates under the agentAccount's ERC-1271 (MetaMask delegation).
            const { sessionAccountClient, publicClient } = await buildDelegatedAssociationContext(
              sessionPackage,
              chainIdForStore,
            );

            const typedData = {
              domain: { name: 'AssociatedAccounts', version: '1' },
              types: {
                AssociatedAccountRecord: [
                  { name: 'initiator', type: 'bytes' },
                  { name: 'approver', type: 'bytes' },
                  { name: 'validAt', type: 'uint40' },
                  { name: 'validUntil', type: 'uint40' },
                  { name: 'interfaceId', type: 'bytes4' },
                  { name: 'data', type: 'bytes' },
                ],
              },
              primaryType: 'AssociatedAccountRecord',
              message: {
                initiator: record.initiator,
                approver: record.approver,
                validAt: BigInt(record.validAt),
                validUntil: BigInt(record.validUntil),
                interfaceId: record.interfaceId,
                data: record.data,
              },
            };

            const signCandidate = async (): Promise<`0x${string}`> => {
              if (typeof (sessionAccountClient as any).signTypedData === 'function') {
                try {
                  const sig = (await (sessionAccountClient as any).signTypedData(typedData)) as `0x${string}`;
                  if (sig && sig !== '0x') return sig;
                } catch {
                  // fall through
                }
              }
              if (typeof (sessionAccountClient as any).signMessage === 'function') {
                const sig = (await (sessionAccountClient as any).signMessage({
                  message: { raw: hexToBytes(associationId) },
                })) as `0x${string}`;
                return sig;
              }
              throw new Error('sessionAccountClient cannot sign messages');
            };

            const approverSignature = await signCandidate();

            // Best-effort ERC-1271 preflight: ensure agentAccount accepts signature.
            try {
              const ERC1271_MAGIC = '0x1626ba7e' as const;
              const ERC1271_ABI = [
                {
                  type: 'function',
                  name: 'isValidSignature',
                  stateMutability: 'view',
                  inputs: [
                    { name: 'hash', type: 'bytes32' },
                    { name: 'signature', type: 'bytes' },
                  ],
                  outputs: [{ name: 'magicValue', type: 'bytes4' }],
                },
              ] as const;
              const magic = (await publicClient.readContract({
                address: sessionPackage.aa as `0x${string}`,
                abi: ERC1271_ABI as any,
                functionName: 'isValidSignature',
                args: [associationId, approverSignature],
              })) as `0x${string}`;
              if (String(magic).toLowerCase() !== ERC1271_MAGIC) {
                throw new Error(`ERC-1271 signature rejected (magic=${String(magic)})`);
              }
            } catch (e: any) {
              console.warn('[ATP Agent] ERC-1271 preflight failed for approverSignature:', e?.message || e);
            }

            const sar = {
              revokedAt: 0,
              initiatorKeyType: '0x0001',
              approverKeyType: '0x0001',
              initiatorSignature: initiatorSignatureRaw,
              approverSignature,
              record,
            };

            console.log('[ATP Agent] Storing delegation association on-chain (ERC-8092 storeAssociation)', {
              chainId: chainIdForStore,
              associationId,
              initiator: record.initiator,
              approver: record.approver,
            });
            const { txHash } = await storeErc8092AssociationWithSessionDelegation({
              sessionPackage,
              chainId: chainIdForStore,
              sar,
            });
            responseContent.delegationStoredTxHash = txHash;
            responseContent.delegationStoredAssociationId = associationId;
            console.log('[ATP Agent] ✓ Stored delegation association on-chain', { txHash, associationId });
          } catch (storeErr: any) {
            console.warn('[ATP Agent] Failed to store client delegation SAR on-chain:', storeErr);
            responseContent.delegationStoreError = storeErr?.message || String(storeErr);
          }
        }

        console.info("oasf:trust.feedback.authorization: ", agentIdParam, clientAddress, expirySeconds, subdomain ? `subdomain: ${subdomain}` : '');

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
        if ((feedbackAuthResponse as any)?.delegationAssociation) {
          responseContent.delegationAssociation = (feedbackAuthResponse as any).delegationAssociation;
        }

        // If this auth is in response to a stored feedback request, persist it and notify requester
        if (requestRecord && feedbackRequestId && Number.isFinite(feedbackRequestId)) {
          try {
            const db = getD1Database();
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
          } catch (dbErr) {
            console.warn('[ATP Agent] Failed to persist feedbackAuth / notify requester:', dbErr);
          }
        }
      } catch (error: any) {
        console.error('Error creating feedback auth:', error);
        responseContent.error = error?.message || 'Failed to create feedback auth';
        responseContent.skill = skillId;
      }
    } else if (skillId === 'oasf:trust.validate.name' ||
      skillId === 'oasf:trust.validate.account' ||
      skillId === 'oasf:trust.validate.app'
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
          subdomainEqualsEnsValidator: subdomain === 'name-validation',
        });

        // Declare sessionPackage at function scope so it can be reused
        let sessionPackage: SessionPackage | null = null;

        // Track validator validation status (set below for ens-validator, undefined for others)
        let validatorValidated: boolean | undefined = undefined;

        // Special handling for name-validation subdomain
        if (subdomain === 'name-validation') {
          console.log('[ATP Agent] ✅ ENS Validator subdomain detected, running ENS-specific validation logic');
          console.log('[ATP Agent] Subdomain:', subdomain, 'agentIdParam:', agentIdParam);
          
          if (!agentIdParam) {
            responseContent.error = 'agentId is required in payload for validation.respond skill';
            responseContent.success = false;
            res.set(getCorsHeaders());
            return res.status(400).json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            });
          }

          const resolvedAgentId = String(agentIdParam);
          const resolvedChainId = typeof chainIdParam === 'number' ? chainIdParam : Number(chainIdParam);

          // Load session package first (needed for validator logic)
          console.log('[ATP Agent] Attempting to load session package for validator subdomain:', subdomain);
          if (subdomain) {
            try {
              const db = getD1Database();
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

          // Fallback to env path
          if (!sessionPackage) {
            const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
            if (sessionPackagePath) {
              try {
                sessionPackage = loadSessionPackage(sessionPackagePath);
              } catch (loadError: any) {
                console.warn('[ATP Agent] Failed to load session package from env (ens-validator):', loadError?.message || loadError);
              }
            }
          }

          if (!sessionPackage) {
            responseContent.error = `Session package is required for ${subdomain}. Store it in database or set AGENTIC_TRUST_SESSION_PACKAGE_PATH.`;
            responseContent.success = false;
            res.set(getCorsHeaders());
            return res.status(400).json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            });
          }

          // Call ENS validator-specific logic
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
            res.set(getCorsHeaders());
            return res.status(400).json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            });
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

        if (!agentIdParam) {
          responseContent.error = 'agentId is required in payload for validation.respond skill';
          responseContent.success = false;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        const resolvedAgentId = String(agentIdParam);
        const resolvedChainId = typeof chainIdParam === 'number' ? chainIdParam : Number(chainIdParam);

        // Special handling for account-validator subdomain
        if (subdomain === 'account-validator') {
          console.log('[ATP Agent] Smart Account Validator subdomain detected, running smart account-specific validation logic');
          
          if (!sessionPackage) {
            responseContent.error = 'Session package is required for account-validator. Store it in database or set AGENTIC_TRUST_SESSION_PACKAGE_PATH.';
            responseContent.success = false;
            res.set(getCorsHeaders());
            return res.status(400).json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            });
          }

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
            res.set(getCorsHeaders());
            return res.status(400).json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            });
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

        // Special handling for app-validator subdomain
        if (subdomain === 'app-validator') {
          console.log('[ATP Agent] Smart App Validator subdomain detected, running smart app-specific validation logic');
          
          if (!sessionPackage) {
            responseContent.error = 'Session package is required for app-validator. Store it in database or set AGENTIC_TRUST_SESSION_PACKAGE_PATH.';
            responseContent.success = false;
            res.set(getCorsHeaders());
            return res.status(400).json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            });
          }

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
            res.set(getCorsHeaders());
            return res.status(400).json({
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            });
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

        // Load session package from database (reuse if already loaded for validator)
        // Only load if not already loaded by ens-validator logic above
        if (!sessionPackage && subdomain) {
          try {
            const db = getD1Database();
            let baseAgentName = subdomain.trim();
            baseAgentName = baseAgentName.replace(/-8004-agent-eth$/i, '').replace(/-8004-agent$/i, '');
            const agentName = `${baseAgentName}.8004-agent.eth`;
            const baseAgentNameLower = baseAgentName.toLowerCase();
            const ensName = agentName.toLowerCase();
            const ensNameDup = agentName; // Keep original case for one of the checks

            // Use same lookup pattern as other session package lookups (matches database structure)
            // Database may have ens_name as just domain ('8004-agent.eth') or full name ('ens-validator.8004-agent.eth')
            // and agent_name as base name ('name-validation') or full name
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
          const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
          if (sessionPackagePath) {
            try {
              sessionPackage = loadSessionPackage(sessionPackagePath);
            } catch (loadError: any) {
              console.warn('[ATP Agent] Failed to load session package from env (validation.respond):', loadError?.message || loadError);
            }
          }
        }

        if (!sessionPackage) {
          responseContent.error = 'Session package is required for validation.respond. Store it in database or set AGENTIC_TRUST_SESSION_PACKAGE_PATH.';
          responseContent.success = false;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
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
          res.set(getCorsHeaders());
          return res.status(404).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
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
    } else if (skillId === 'atp.feedback.requestapproved') {
      // Approve a feedback request (no on-chain auth), update record and notify requester
      if (subdomain !== 'agents-atp') {
        responseContent.error = 'atp.feedback.requestapproved skill is only available on the agents-atp subdomain';
        responseContent.skill = skillId;
        res.set(getCorsHeaders());
        return res.status(403).json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
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

        const db = getD1Database();
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

        // Notify requester (to the FROM agent)
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
        
        const db = getD1Database();
        
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
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
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
    } else if (skillId === 'atp.agent.get') {
      try {
        const { ens_name, agent_name, agent_account } = payload || {};
        const ensName = typeof ens_name === 'string' ? ens_name.trim() : '';
        const agentName = typeof agent_name === 'string' ? agent_name.trim() : '';
        const agentAccount = typeof agent_account === 'string' ? agent_account.trim().toLowerCase() : '';

        if (!ensName && !agentName && !agentAccount) {
          responseContent.error = 'Provide ens_name, agent_name, or agent_account in payload for atp.agent.get';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        const db = getD1Database();
        await ensureAgentsSchema(db);

        const row = await db
          .prepare(
            `SELECT id, ens_name, agent_name, email_domain, agent_account, chain_id, session_package, agent_card_json, created_at, updated_at
             FROM agents
             WHERE (? != '' AND LOWER(ens_name) = LOWER(?))
                OR (? != '' AND LOWER(agent_name) = LOWER(?))
                OR (? != '' AND LOWER(agent_account) = LOWER(?))
             ORDER BY updated_at DESC
             LIMIT 1`,
          )
          .bind(ensName, ensName, agentName, agentName, agentAccount, agentAccount)
          .first<any>();

        responseContent.skill = skillId;
        (responseContent as any).agent = row || null;
      } catch (error: any) {
        console.error('Error fetching agent:', error);
        responseContent.error = error?.message || 'Failed to fetch agent';
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
          agent_card_json,
        } = payload || {};

        if (!agent_name || typeof agent_name !== 'string') {
          responseContent.error = 'agent_name is required in payload for atp.agent.createOrUpdate skill';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        if (!agent_account || typeof agent_account !== 'string') {
          responseContent.error = 'agent_account is required in payload for atp.agent.createOrUpdate skill';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        console.log('[ATP Agent] Received atp.agent.createOrUpdate:', {
          agent_name,
          agent_account: agent_account.substring(0, 10) + '...',
          ens_name: ens_name || 'undefined',
          session_package_provided: session_package ? 'yes' : 'no',
          session_package_type: typeof session_package,
          agent_card_json_provided: agent_card_json !== undefined ? 'yes' : 'no',
        });

        const db = getD1Database();
        await ensureAgentsSchema(db);

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

        const sessionPackageProvided = Object.prototype.hasOwnProperty.call(payload || {}, 'session_package');
        let sessionPackageValue: string | null = null;
        if (sessionPackageProvided) {
          if (session_package === null) {
            sessionPackageValue = null;
          } else if (typeof session_package === 'string') {
            sessionPackageValue = session_package.trim().length > 0 ? session_package : null;
          } else if (typeof session_package === 'object') {
            sessionPackageValue = JSON.stringify(session_package);
          }
        }

        const agentCardProvided = Object.prototype.hasOwnProperty.call(payload || {}, 'agent_card_json');
        let agentCardJsonValue: string | null = null;
        if (agentCardProvided) {
          if (agent_card_json === null) {
            agentCardJsonValue = null;
          } else if (typeof agent_card_json === 'string') {
            agentCardJsonValue = agent_card_json.trim().length > 0 ? agent_card_json : null;
          } else if (typeof agent_card_json === 'object') {
            agentCardJsonValue = JSON.stringify(agent_card_json);
          } else {
            agentCardJsonValue = String(agent_card_json);
          }
        }

        console.log('[ATP Agent] Processing session_package:', {
          provided: typeof session_package,
          hasValue: session_package !== undefined && session_package !== null,
          finalValue: sessionPackageValue ? `${sessionPackageValue.substring(0, 100)}...` : 'null',
        });
        console.log('[ATP Agent] Processing agent_card_json:', {
          provided: typeof agent_card_json,
          hasField: agentCardProvided,
          finalValue: agentCardProvided ? (agentCardJsonValue ? `${agentCardJsonValue.substring(0, 100)}...` : 'null') : '(unchanged)',
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
            'SELECT id, ens_name, updated_at FROM agents WHERE LOWER(ens_name) = LOWER(?) ORDER BY updated_at DESC LIMIT 1'
          )
            .bind(agentEnsName)
            .first<{ id: number; ens_name: string; updated_at: number }>());

        console.log('[ATP Agent] Lookup result for ens_name:', agentEnsNameLower, '(original:', agentEnsName, ') ->', existing ? `ID ${existing.id} (${existing.ens_name})` : 'NOT FOUND');

        // Use unixepoch() for timestamps (INTEGER)
        const now = Math.floor(Date.now() / 1000);

        if (existing) {
          // Update existing agent
          await db.prepare(
            `UPDATE agents
             SET agent_name = ?,
                 agent_account = ?,
                 email_domain = ?,
                 chain_id = ?,
                 session_package = CASE WHEN ? = 1 THEN ? ELSE session_package END,
                 agent_card_json = CASE WHEN ? = 1 THEN ? ELSE agent_card_json END,
                 updated_at = ?
             WHERE id = ?`
          )
            .bind(
              baseAgentName,
              agent_account.toLowerCase(),
              agentEmailDomain,
              agentChainId,
              sessionPackageProvided ? 1 : 0,
              sessionPackageValue,
              agentCardProvided ? 1 : 0,
              agentCardJsonValue,
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
            'INSERT INTO agents (ens_name, agent_name, email_domain, agent_account, chain_id, session_package, agent_card_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
            .bind(
              agentEnsNameLower,
              baseAgentName,
              agentEmailDomain,
              agent_account.toLowerCase(),
              agentChainId,
              sessionPackageProvided ? sessionPackageValue : null,
              agentCardProvided ? agentCardJsonValue : null,
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
        res.set(getCorsHeaders());
        return res.status(403).json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
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
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        if (!toAgentId) {
          responseContent.error = 'toAgentId (agent ID to give feedback to) is required in payload for atp.feedback.request skill';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        if (!comment || comment.trim().length === 0) {
          responseContent.error = 'comment (reason for feedback) is required in payload for atp.feedback.request skill';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        const db = getD1Database();
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
              now * 1000,
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
              now * 1000,
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
        res.set(getCorsHeaders());
        return res.status(403).json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
      }

      try {
        const clientAddress = payload?.clientAddress || payload?.client_address;

        if (!clientAddress) {
          responseContent.error = 'clientAddress (EOA address) is required in payload for atp.feedback.getRequests skill';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        if (!/^0x[a-fA-F0-9]{40}$/.test(clientAddress)) {
          responseContent.error = 'Invalid clientAddress format. Must be a valid Ethereum address (0x followed by 40 hex characters)';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        const db = getD1Database();
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
        res.set(getCorsHeaders());
        return res.status(403).json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
      }

      try {
        const targetAgentId = payload?.toAgentId || payload?.targetAgentId || payload?.target_agent_id || payload?.agentId;

        if (!targetAgentId) {
          responseContent.error = 'targetAgentId (agent ID) is required in payload for atp.feedback.getRequestsByAgent skill';
          responseContent.skill = skillId;
          res.set(getCorsHeaders());
          return res.status(400).json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          });
        }

        const db = getD1Database();
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

        console.log('[ATP Agent] Found feedback requests:', feedbackRequests.length);

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.feedbackRequests = feedbackRequests;
        responseContent.count = feedbackRequests.length;
        responseContent.message = `Found ${feedbackRequests.length} feedback request(s) for agent ${targetAgentId}`;
      } catch (error: any) {
        console.error('[ATP Agent] Error querying feedback requests:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to query feedback requests';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (
      skillId === 'atp.feedback.markGiven' ||
      skillId === 'atp.inbox.sendMessage' ||
      skillId === 'atp.inbox.listClientMessages' ||
      skillId === 'atp.inbox.listAgentMessages' ||
      skillId === 'atp.inbox.markRead'
    ) {
      // All other admin/inbox skills are only accessible on the agents-atp subdomain
      if (subdomain !== 'agents-atp') {
        responseContent.error = `${skillId} skill is only available on the agents-atp subdomain`;
        responseContent.skill = skillId;
        res.set(getCorsHeaders());
        return res.status(403).json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        });
      }

      // TODO: Implement remaining handlers (markGiven, inbox handlers)
      // These follow the same pattern as worker.ts but use Express response methods
      responseContent.response = `Received request for skill: ${skillId}. Handler implementation in progress.`;
      responseContent.skill = skillId;
    } else if (skillId) {
      if (rpcMode) {
        return res.json(
          jsonRpcError(rpcId, -32601, `Method not found: ${skillId}`, {
            knownMethods: handledSkillIdsForDebug,
          }),
        );
      }
      responseContent.response = `Received request for skill: ${skillId}. This skill is not yet implemented.`;
      responseContent.skill = skillId;
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

    res.set(getCorsHeaders());
    res.json(serializedResponse);
  } catch (error) {
    console.error('Error processing A2A request:', error);
    res.set(getCorsHeaders());
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Handle OPTIONS preflight for A2A
 */
app.options('/api/a2a', (req: Request, res: Response) => {
  res.set(getCorsHeaders());
  res.status(204).send();
});

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`[ATP Agent Server] Server running on port ${PORT}`);
  console.log(`[ATP Agent Server] A2A endpoint: http://localhost:${PORT}/api/a2a`);
  console.log(`[ATP Agent Server] Agent card: http://localhost:${PORT}/.well-known/agent-card.json`);
});

