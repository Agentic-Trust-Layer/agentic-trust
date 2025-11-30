/**
 * Express.js Agent Provider Server
 * 
 * This is an Express-only application (not Next.js) that uses @agentic-trust/core
 * for agent management, A2A protocol, and ERC-8004 feedback authentication.
 * 
 * The core package is framework-agnostic and works with Express without requiring Next.js.
 */

// Load environment variables from .env file
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file from the provider app root directory (where package.json is)
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
import { processValidationRequests } from './validation';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Extract subdomain (e.g. "abc" from "abc.localhost" or "abc.localhosthost")
 * so the provider app can route based on the first label.
 *
 * The base domain can be configured via PROVIDER_BASE_DOMAIN (default: "localhost").
 */
function extractSubdomain(hostname: string | undefined, baseDomain: string): string | null {
  if (!hostname) return null;

  // Strip port if present (e.g. "abc.localhost:3001")
  const hostNoPort = hostname.split(':')[0].toLowerCase();
  const base = baseDomain.toLowerCase();

  if (!hostNoPort.endsWith(base)) {
    // Host doesn't match the configured base domain; treat as no subdomain
    return null;
  }

  const withoutBase = hostNoPort.slice(0, -base.length); // e.g. "abc." from "abc.localhost"
  const trimmed = withoutBase.replace(/\.$/, ''); // remove trailing dot if any

  if (!trimmed) return null;

  // For now, use the entire left part as the "subdomain key"
  return trimmed;
}

// Attach providerSubdomain and resolve ENS-based agent account (abc.8004-agent.eth) per request
app.use(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    console.log('[Provider Server] Incoming request host:', req.hostname);
    const baseDomain = process.env.PROVIDER_BASE_DOMAIN || 'localhost';
    const subdomain = extractSubdomain(req.hostname, baseDomain);

    (req as any).providerSubdomain = subdomain;

    let providerEnsName: string | null = null;
    let providerAgentAccount: string | null = null;

    if (subdomain) {
      providerEnsName = `${subdomain}.8004-agent.eth`;
      try {
        const ensClient = await getENSClient(); // default chain (Sepolia) for ENS
        providerAgentAccount = await ensClient.getAgentAccountByName(providerEnsName);
      } catch (err) {
        console.error(
          '[Provider Server] Error resolving ENS account for',
          providerEnsName,
          err,
        );
      }
    }

    (req as any).providerEnsName = providerEnsName;
    (req as any).providerAgentAccount = providerAgentAccount;

    if (process.env.NODE_ENV === 'development') {
      console.log(
        '[Provider Server] Routing context:',
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
    console.error('[Provider Server] Error in subdomain/ENS middleware:', error);
    next(error);
  }
});

// Mount Agentic Trust agent management routes (create/update registration)
// Adapter to satisfy the lightweight ExpressRouterLike interface expected by mountAgentApiRoutes
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
      // Expose subdomain as tenantId so core APIs can route per-tenant/agent
      return {
        requestId,
        tenantId: subdomain ?? undefined,
      };
    },
  },
);

// Debug: Log environment variable availability at module load time
if (typeof process !== 'undefined') {
  const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA;
  console.log('[Provider Server] Module load - AGENTIC_TRUST_RPC_URL_SEPOLIA:', rpcUrl ? `SET (${rpcUrl.substring(0, 20)}...)` : 'NOT SET');
}

// Pre-initialize the AgenticTrustClient when the module loads
// This ensures the client is ready to serve A2A requests without requiring a browser visit
let clientInitPromise: Promise<void> | null = null;
if (typeof process !== 'undefined') {
  clientInitPromise = (async () => {
    try {
      console.log('[Provider Server] Pre-initializing AgenticTrustClient...');
      await getAgenticTrustClient();
      console.log('[Provider Server] AgenticTrustClient initialized successfully');
    } catch (error) {
      console.error('[Provider Server] Failed to pre-initialize AgenticTrustClient:', error);
      // Don't throw - we'll initialize on first request if this fails
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
 * Simple root handler so it's obvious the server is reachable and
 * which host/subdomain was used.
 */
app.get('/', (req: Request, res: Response) => {
  const subdomain = (req as any).providerSubdomain as string | null | undefined;
  res.json({
    message: 'Agent Provider is running',
    host: req.hostname,
    subdomain: subdomain || null,
    note: 'Try /.well-known/agent-card.json or /api/a2a for agent endpoints.',
  });
});

/**
 * Middleware to wait for client initialization
 */
async function waitForClientInit(req: Request, res: Response, next: NextFunction) {
  if (clientInitPromise) {
    try {
      await clientInitPromise;
    } catch (error) {
      console.warn('[Provider Server] Pre-initialization failed, will initialize on demand:', error);
    }
  }
  next();
}

/**
 * Agent Card endpoint (/.well-known/agent-card.json)
 * A2A standard endpoint for agent discovery
 */
app.get('/.well-known/agent-card.json', (req: Request, res: Response) => {
  const subdomain = (req as any).providerSubdomain as string | null | undefined;
  const agentName = process.env.AGENT_NAME || 'Agent Provider';
  const agentDescription = process.env.AGENT_DESCRIPTION || 'A sample agent provider for A2A communication';
  
  const providerUrl = process.env.PROVIDER_BASE_URL || '';
  
  const agentId = parseInt(process.env.AGENT_ID || '0', 10);
  const agentAddress = process.env.AGENT_ADDRESS || '';
  const agentSignature = process.env.AGENT_SIGNATURE || '';

  const agentCard = {
    // Optionally include subdomain in the name so different wildcard hosts can be distinguished
    name: subdomain ? `${agentName} (${subdomain})` : agentName,
    description: agentDescription,
    url: providerUrl,
    provider: {
      organization: process.env.PROVIDER_ORGANIZATION || 'A2A Samples',
      url: process.env.PROVIDER_BASE_URL,
    },
    version: process.env.AGENT_VERSION || '0.0.2',
    capabilities: {
      streaming: process.env.CAPABILITY_STREAMING === 'true',
      pushNotifications: process.env.CAPABILITY_PUSH_NOTIFICATIONS === 'true',
      stateTransitionHistory: process.env.CAPABILITY_STATE_HISTORY === 'true',
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [
      {
        id: 'general_movie_chat',
        name: 'General Movie Chat',
        description: 'Answer general questions or chat about movies, actors, directors.',
        tags: ['movies', 'actors', 'directors'],
        examples: [
          'Tell me about the plot of Inception.',
          'Recommend a good sci-fi movie.',
          'Who directed The Matrix?',
          'What other movies has Scarlett Johansson been in?',
          'Find action movies starring Keanu Reeves',
          'Which came out first, Jurassic Park or Terminator 2?',
        ],
        inputModes: ['text'],
        outputModes: ['text', 'task-status'],
      },
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
        id: 'agent.validation.respond',
        name: 'agent.validation.respond',
        tags: ['erc8004', 'validation', 'ens', 'a2a'],
        examples: ['Process ENS validation requests for agents'],
        inputModes: ['text'],
        outputModes: ['text'],
        description: 'Process validation requests by validating ENS names and submitting validation responses',
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
  // Log request details for debugging
  const subdomain = (req as any).providerSubdomain as string | null | undefined;
  const rpcUrlStatus = process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA ? 'SET' : 'NOT SET';
  console.log('========================================');
  console.log('[A2A Route] POST request received at', new Date().toISOString());
  console.log('[A2A Route] Host:', req.hostname, 'subdomain:', subdomain || '(none)');
  console.log('[A2A Route] AGENTIC_TRUST_RPC_URL_SEPOLIA:', rpcUrlStatus);
  if (process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA) {
    console.log('[A2A Route] RPC URL value:', process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA.substring(0, 40) + '...');
  }
  console.log('========================================');

  try {
    const body = req.body;

    // Extract A2A request data
    const { fromAgentId, toAgentId, message, payload, metadata, skillId, auth } = body;

    // Validate required fields
    // For skill-based requests (like agent.feedback.requestAuth), fromAgentId and toAgentId are not required
    if (!skillId && (!fromAgentId || !toAgentId)) {
      res.set(getCorsHeaders());
      return res.status(400).json({
        success: false,
        error: 'fromAgentId and toAgentId are required (unless skillId is provided)',
      });
    }

    // Verify authentication if provided (first connection)
    let authenticatedClientAddress: string | null = null;
    if (auth) {
      const atClient = await getAgenticTrustClient();
      const providerUrl = process.env.PROVIDER_BASE_URL || '';

      // Verify the challenge using AgenticTrustClient (handles Veramo internally)
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

    // If skillId is provided, handle skill-specific logic
    if (skillId === 'general_movie_chat') {
      // Movie chat skill handler
      const userMessage = message?.toLowerCase() || '';

      if (userMessage.includes('inception')) {
        responseContent.response = `Inception is a 2010 science fiction film directed by Christopher Nolan. It follows Dom Cobb (Leonardo DiCaprio), a skilled thief who enters people's dreams to steal secrets from their subconscious. The film explores themes of reality, dreams, and the nature of consciousness.`;
        responseContent.skill = 'general_movie_chat';
      } else if (userMessage.includes('matrix') || userMessage.includes('keanu')) {
        responseContent.response = `The Matrix is a 1999 science fiction film directed by the Wachowskis, starring Keanu Reeves as Neo. It's a groundbreaking film that explores themes of reality, simulation, and human consciousness.`;
        responseContent.skill = 'general_movie_chat';
      } else if (userMessage.includes('recommend') || userMessage.includes('sci-fi')) {
        responseContent.response = `Here are some great sci-fi movie recommendations: Blade Runner 2049, Interstellar, The Matrix, Ex Machina, and Arrival.`;
        responseContent.skill = 'general_movie_chat';
      } else {
        responseContent.response = `I'd be happy to help with movie questions! Try asking about specific movies, actors, directors, or request recommendations. For example: "Tell me about Inception" or "Recommend a good sci-fi movie."`;
        responseContent.skill = 'general_movie_chat';
      }
    } else if (skillId === 'agent.feedback.requestAuth') {
      // Feedback request auth skill handler
      try {
        const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA;
        const rpcUrlStatus = rpcUrl ? 'SET' : 'NOT SET';
        const relevantEnvVars = Object.keys(process.env).filter(k => k.includes('RPC') || k.includes('SEPOLIA'));

        responseContent.debug = {
          rpcUrlStatus,
          rpcUrlPreview: rpcUrl ? rpcUrl.substring(0, 40) + '...' : null,
          relevantEnvVars,
          directCheck: process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA ? 'FOUND' : 'NOT_FOUND',
        };

        console.error('========================================');
        console.error('[A2A Route] Request time - AGENTIC_TRUST_RPC_URL_SEPOLIA:', rpcUrlStatus);
        if (!rpcUrl) {
          console.error('[A2A Route] Available RPC/SEPOLIA env vars:', relevantEnvVars);
          console.error('[A2A Route] All AGENTIC_TRUST env vars:', Object.keys(process.env).filter(k => k.startsWith('AGENTIC_TRUST')));
        }
        console.error('========================================');

        if (!rpcUrl) {
          responseContent.error = `RPC URL not found in process.env. Status: ${rpcUrlStatus}. Available vars: ${relevantEnvVars.join(', ')}`;
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

        try {
          // Load SessionPackage based on subdomain (or use default from env var)
          // This allows different SessionPackages for different subdomains
          let sessionPackage: SessionPackage | null = null;
          let agentIdForRequest: string | undefined;

          if (subdomain) {
            // TODO: Implement your app-specific logic to load SessionPackage based on subdomain
            // Example: const sessionPackagePath = `/path/to/sessionPackages/${subdomain}.json.secret`;
            // sessionPackage = loadSessionPackage(sessionPackagePath);
            // For now, fall back to env var if subdomain-based loading is not implemented
            const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
            if (sessionPackagePath) {
              sessionPackage = loadSessionPackage(sessionPackagePath);
            }
          } else {
            // No subdomain, use default from env var
            const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
            if (sessionPackagePath) {
              sessionPackage = loadSessionPackage(sessionPackagePath);
            }
          }

          if (sessionPackage) {
            agentIdForRequest = sessionPackage.agentId.toString();
          } else {
            agentIdForRequest = agentIdParam?.toString();
          }

          const agent = agentIdForRequest ? await atClient.agents.getAgent(agentIdForRequest) : null;

          if (!agent) {
            throw new Error('Agent not found. Cannot request feedback auth without agent instance.');
          }

          // Set SessionPackage on agent instance if loaded dynamically
          // This will be used by requestAuth() instead of the singleton providerApp
          if (sessionPackage) {
            agent.setSessionPackage(sessionPackage);
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
      } catch (error: any) {
        console.error('Error creating feedback auth:', error);
        responseContent.error = error?.message || 'Failed to create feedback auth';
        responseContent.skill = skillId;
      }
    } else if (skillId === 'agent.validation.respond') {
      responseContent.skill = skillId;
      const agentIdParam =
        payload?.agentId ??
        payload?.agentID ??
        metadata?.agentId ??
        metadata?.agentID ??
        null;
      if (!agentIdParam) {
        responseContent.error = 'agentId is required in payload for agent.validation.respond skill';
      } else {
        const agentId = String(agentIdParam);
        const chainId =
          typeof payload?.chainId === 'number'
            ? payload.chainId
            : typeof metadata?.chainId === 'number'
              ? metadata.chainId
              : DEFAULT_CHAIN_ID;
        const requestHash = payload?.requestHash as string | undefined;
        
        try {
          // Load SessionPackage based on subdomain (or use default from env var)
          // This uses the same sessionPackage that feedbackAuth uses
          let sessionPackage: SessionPackage | null = null;

          if (subdomain) {
            // TODO: Implement your app-specific logic to load SessionPackage based on subdomain
            // Example: const sessionPackagePath = `/path/to/sessionPackages/${subdomain}.json.secret`;
            // sessionPackage = loadSessionPackage(sessionPackagePath);
            // For now, fall back to env var if subdomain-based loading is not implemented
            const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
            if (sessionPackagePath) {
              sessionPackage = loadSessionPackage(sessionPackagePath);
            }
          } else {
            // No subdomain, use default from env var
            const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
            if (sessionPackagePath) {
              sessionPackage = loadSessionPackage(sessionPackagePath);
            }
          }

          if (!sessionPackage) {
            throw new Error('SessionPackage is required for validation. Set AGENTIC_TRUST_SESSION_PACKAGE_PATH environment variable.');
          }

          console.log(`[Provider A2A] Processing validation request via internal validation service`);
          console.log(`[Provider A2A] Agent ID: ${agentId}, Chain ID: ${chainId}, Request Hash: ${requestHash || 'ALL'}`);
          
          // Process validation requests using internal validation service with sessionPackage
          const validationResults = await processValidationRequests(
            sessionPackage,
            chainId,
            agentId,
            requestHash,
          );
          
          // Format response similar to the external validator service
          const successCount = validationResults.filter(r => r.success).length;
          const failureCount = validationResults.filter(r => !r.success).length;
          
          responseContent.validationResult = {
            success: true,
            chainId,
            processed: validationResults.length,
            successful: successCount,
            failed: failureCount,
            results: validationResults,
          };
          
          // Also fetch validation summary
          try {
            const summary = await getAgentValidationsSummary(chainId, agentId);
            responseContent.validationSummary = summary;
          } catch (summaryError) {
            responseContent.summaryError =
              summaryError instanceof Error
                ? summaryError.message
                : 'Failed to load validation summary';
          }
        } catch (validationError: any) {
          console.error('[Provider A2A] Error processing validation request:', validationError);
          responseContent.error =
            validationError instanceof Error
              ? validationError.message
              : 'Failed to process validation request';
        }
      }
    } else if (skillId) {
      responseContent.response = `Received request for skill: ${skillId}. This skill is not yet implemented.`;
      responseContent.skill = skillId;
    }

    // Generate a response
    const response = {
      success: true,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      response: responseContent,
    };

    res.set(getCorsHeaders());
    res.json(response);
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
  console.log(`[Provider Server] Server running on port ${PORT}`);
  console.log(`[Provider Server] A2A endpoint: http://localhost:${PORT}/api/a2a`);
  console.log(`[Provider Server] Agent card: http://localhost:${PORT}/.well-known/agent-card.json`);
});

