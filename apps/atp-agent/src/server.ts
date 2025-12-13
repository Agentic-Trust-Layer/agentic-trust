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
} from '@agentic-trust/core/server';
import { parseDid8004 } from '@agentic-trust/core';
import { getD1Database } from './lib/d1-wrapper';

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
    note: 'Try /.well-known/agent.json or /api/a2a for agent endpoints.',
  });
});

/**
 * Agent endpoint (/.well-known/agent.json)
 * A2A standard endpoint for agent discovery
 */
app.get('/.well-known/agent.json', (req: Request, res: Response) => {
  const subdomain = (req as any).providerSubdomain as string | null | undefined;
  const agentName = process.env.AGENT_NAME || 'ATP Agent';
  const agentDescription = process.env.AGENT_DESCRIPTION || 'An ATP agent for A2A communication';
  
  const providerUrl = process.env.PROVIDER_BASE_URL || '';
  
  const agentId = parseInt(process.env.AGENT_ID || '0', 10);
  const agentAddress = process.env.AGENT_ADDRESS || '';
  const agentSignature = process.env.AGENT_SIGNATURE || '';

  const agentCard = {
    name: subdomain ? `${agentName} (${subdomain})` : agentName,
    description: agentDescription,
    url: providerUrl,
    provider: {
      organization: process.env.PROVIDER_ORGANIZATION || 'ATP',
      url: process.env.PROVIDER_BASE_URL,
    },
    version: process.env.AGENT_VERSION || '0.1.0',
    capabilities: {
      streaming: process.env.CAPABILITY_STREAMING === 'true',
      pushNotifications: process.env.CAPABILITY_PUSH_NOTIFICATIONS === 'true',
      stateTransitionHistory: process.env.CAPABILITY_STATE_HISTORY === 'true',
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: (() => {
      const baseSkills = [
        {
          id: 'agent.feedback.requestAuth',
          name: 'agent.feedback.requestAuth',
          tags: ['erc8004', 'feedback', 'auth', 'a2a'],
          examples: ['Client requests feedbackAuth after receiving results'],
          inputModes: ['text'],
          outputModes: ['text'],
          description: 'Issue a signed ERC-8004 feedbackAuth for a client to submit feedback',
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
            description: 'Request to give feedback to an agent. Requires clientAddress (EOA), targetAgentId (agent ID to give feedback to), and comment (reason for feedback) in payload.',
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
            description: 'Mark a feedback request as having feedback given, storing the tx hash. Requires feedbackRequestId and txHash in payload.',
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
            description: 'Send a message via the inbox system. Requires body, and at least one destination (toClientAddress, toAgentDid, or toAgentName).',
          },
          {
            id: 'atp.inbox.listClientMessages',
            name: 'atp.inbox.listClientMessages',
            tags: ['erc8004', 'inbox', 'query', 'a2a'],
            examples: ['List messages for a client address', 'Get all messages for a wallet'],
            inputModes: ['text', 'json'],
            outputModes: ['text', 'json'],
            description: 'List messages for a client address (both sent and received). Requires clientAddress (EOA) in payload.',
          },
          {
            id: 'atp.inbox.listAgentMessages',
            name: 'atp.inbox.listAgentMessages',
            tags: ['erc8004', 'inbox', 'query', 'a2a'],
            examples: ['List messages for an agent DID', 'Get all messages for an agent'],
            inputModes: ['text', 'json'],
            outputModes: ['text', 'json'],
            description: 'List messages for an agent DID (both sent and received). Requires agentDid in payload.',
          },
          {
            id: 'atp.inbox.markRead',
            name: 'atp.inbox.markRead',
            tags: ['erc8004', 'inbox', 'update', 'a2a'],
            examples: ['Mark a message as read'],
            inputModes: ['text', 'json'],
            outputModes: ['text', 'json'],
            description: 'Mark a message as read. Requires messageId in payload.',
          },
        ];
      }
      return baseSkills;
    })(),
    registrations: [
      {
        agentId,
        agentAddress,
        signature: agentSignature,
      },
    ],
    trustModels: ['feedback'],
    supportsAuthenticatedExtendedCard: false,
    feedbackDataURI: '',
  };

  res.set({
    'Content-Type': 'application/json',
    ...getCorsHeaders(),
  });
  res.json(agentCard);
});

/**
 * Handle OPTIONS preflight for agent-card
 */
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
    const body = req.body;

    // Extract A2A request data
    const { fromAgentId, toAgentId, message, payload, metadata, skillId, auth } = body;

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
      const providerUrl = process.env.PROVIDER_BASE_URL || '';

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
    if (skillId === 'agent.feedback.requestAuth') {
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
          responseContent.error = 'clientAddress is required in payload for agent.feedback.requestAuth skill';
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
            
            // Construct the full agent_name and ENS name for lookup: "xyzalliance-arn.8004-agent.eth"
            const agentName = `${baseAgentName}.8004-agent.eth`;
            const ensName = agentName; // Same format
            
            console.log('[ATP Agent] Looking up agent in database by subdomain:', subdomain);
            console.log('[ATP Agent] Extracted base agent name:', baseAgentName);
            console.log('[ATP Agent] Constructed agent_name for lookup:', agentName);
            
            // Try lookup by agent_name first (most reliable, matches database format)
            let agentRecord = await db.prepare(
              'SELECT session_package FROM agents WHERE agent_name = ?'
            )
              .bind(agentName)
              .first<{ session_package: string | null }>();

            if (agentRecord?.session_package) {
              try {
                sessionPackage = JSON.parse(agentRecord.session_package) as SessionPackage;
                console.log('[ATP Agent] ✓ Loaded session package from database by agent_name:', agentName);
              } catch (parseError) {
                console.error('[ATP Agent] Failed to parse session package from database (by agent_name):', parseError);
              }
            } else {
              console.warn('[ATP Agent] No agent record found by agent_name:', agentName);
              
              // Try lookup by ens_name (might have duplicate suffix in database like "xyzalliance-arn.8004-agent.eth.8004-agent.eth")
              agentRecord = await db.prepare(
                'SELECT session_package FROM agents WHERE ens_name = ? OR ens_name = ?'
              )
                .bind(ensName, `${ensName}.8004-agent.eth`) // Also try with duplicate suffix
                .first<{ session_package: string | null }>();
              
              if (agentRecord?.session_package) {
                try {
                  sessionPackage = JSON.parse(agentRecord.session_package) as SessionPackage;
                  console.log('[ATP Agent] ✓ Loaded session package from database by ens_name');
                } catch (parseError) {
                  console.error('[ATP Agent] Failed to parse session package from database (by ens_name):', parseError);
                }
              } else {
                console.warn('[ATP Agent] No agent record found by ens_name either:', ensName);
                
                // Create agent record if it doesn't exist
                console.log('[ATP Agent] Creating new agent record in database:', { ensName, agentName, baseAgentName });
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
                  if (agentName.includes('.')) {
                    const parts = agentName.split('.');
                    if (parts.length >= 2) {
                      emailDomain = parts.slice(-2).join('.');
                    }
                  }
                  
                  // Check if record already exists (race condition check)
                  const existingCheck = await db.prepare(
                    'SELECT id FROM agents WHERE ens_name = ?'
                  )
                    .bind(ensName)
                    .first<{ id: number }>();
                  
                  if (!existingCheck) {
                    await db.prepare(
                      'INSERT INTO agents (ens_name, agent_name, email_domain, agent_account, chain_id, session_package, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                    )
                      .bind(
                        ensName,
                        baseAgentName, // Use base agent name (without .8004-agent.eth suffix)
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
        console.log('[ATP Agent] Setting session package on agent instance');
        agent.setSessionPackage(sessionPackage);

        console.info("agent.feedback.requestAuth: ", agentIdParam, clientAddress, expirySeconds, subdomain ? `subdomain: ${subdomain}` : '');

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

        await db
          .prepare(
            'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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

        const db = getD1Database();

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

        // Check if agent exists by ens_name (unique identifier)
        const existing = await db.prepare(
          'SELECT id FROM agents WHERE ens_name = ?'
        )
          .bind(agentEnsName)
          .first<{ id: number }>();

        // Use unixepoch() for timestamps (INTEGER)
        const now = Math.floor(Date.now() / 1000);

        if (existing) {
          // Update existing agent
          await db.prepare(
            'UPDATE agents SET agent_name = ?, agent_account = ?, email_domain = ?, chain_id = ?, session_package = ?, updated_at = ? WHERE ens_name = ?'
          )
            .bind(
              agent_name,
              agent_account.toLowerCase(),
              agentEmailDomain,
              agentChainId,
              session_package || null,
              now,
              agentEnsName
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
              agentEnsName,
              agent_name,
              agentEmailDomain,
              agent_account.toLowerCase(),
              agentChainId,
              session_package || null,
              now,
              now
            )
            .run();

          responseContent.action = 'created';
          responseContent.agentId = result.meta.last_row_id;
          responseContent.message = 'Agent created successfully';
        }

        responseContent.ens_name = agentEnsName;
        responseContent.agent_name = agent_name;
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

          await db
            .prepare(
              'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
              'feedback_request',
              String(feedbackRequestId),
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
  console.log(`[ATP Agent Server] Agent: http://localhost:${PORT}/.well-known/agent.json`);
});

