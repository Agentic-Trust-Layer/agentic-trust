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
  getAgentValidationsSummary,
  DEFAULT_CHAIN_ID,
  type SessionPackage,
} from '@agentic-trust/core/server';
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
    note: 'Try /.well-known/agent-card.json or /api/a2a for agent endpoints.',
  });
});

/**
 * Agent Card endpoint (/.well-known/agent-card.json)
 * A2A standard endpoint for agent discovery
 */
app.get('/.well-known/agent-card.json', (req: Request, res: Response) => {
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
    skills: [
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
    ],
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
app.options('/.well-known/agent-card.json', (req: Request, res: Response) => {
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
        const clientAddress = payload.clientAddress;
        const { agentId: agentIdParam, expirySeconds } = payload || {};

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
              }
            }
          } catch (dbError) {
            console.error('[ATP Agent] Error loading session package from database:', dbError);
          }
        }

        // Fallback to environment variable if database lookup failed (optional, don't throw if missing)
        if (!sessionPackage) {
          const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
          if (sessionPackagePath) {
            try {
              // Only try to load if the path is provided and file might exist
              // loadSessionPackage will throw if file doesn't exist, so we catch it
              sessionPackage = loadSessionPackage(sessionPackagePath);
              console.log('[ATP Agent] Loaded session package from environment variable');
            } catch (loadError: any) {
              // Don't fail if environment variable file doesn't exist - database is primary source
              console.warn('[ATP Agent] Failed to load session package from environment variable (this is OK if using database):', loadError?.message || loadError);
            }
          } else {
            console.log('[ATP Agent] No AGENTIC_TRUST_SESSION_PACKAGE_PATH environment variable set - using database only');
          }
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

        if (sessionPackage) {
          console.log('[ATP Agent] Setting session package on agent instance');
          agent.setSessionPackage(sessionPackage);
        } else {
          console.warn('[ATP Agent] WARNING: No session package loaded - requestAuth will fall back to getProviderApp() which requires AGENTIC_TRUST_SESSION_PACKAGE_PATH');
        }

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
      } catch (error: any) {
        console.error('Error creating feedback auth:', error);
        responseContent.error = error?.message || 'Failed to create feedback auth';
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
  console.log(`[ATP Agent Server] Agent card: http://localhost:${PORT}/.well-known/agent-card.json`);
});

