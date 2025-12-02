/**
 * Express.js ENS Validation Server
 * 
 * Simple Express service that processes ENS validation requests.
 * Reads validation requests from the contract and validates agent ENS names.
 */

// Load environment variables from .env file
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of the current file (src/server.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from the validator app root directory (one level up from src/)
const envPath = resolve(__dirname, '..', '.env');
console.log(`[Validator Server] Loading .env from: ${envPath}`);
const result = config({ path: envPath });

if (result.error) {
  console.warn(`[Validator Server] Warning: Could not load .env file: ${result.error.message}`);
} else {
  const loadedVars = Object.keys(result.parsed || {});
  console.log(`[Validator Server] Loaded ${loadedVars.length} environment variables from .env`);
  if (loadedVars.length > 0) {
    console.log(`[Validator Server] Loaded vars: ${loadedVars.join(', ')}`);
  }
}

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { processValidationRequests } from './validator.js';
import { DEFAULT_CHAIN_ID } from '@agentic-trust/core/server';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3003;

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Process validation requests endpoint
 * Triggers validation processing for all unprocessed requests
 */
app.post('/api/validate', async (req: Request, res: Response) => {
  console.log(`[Validator Server] ========================================`);
  console.log(`[Validator Server] POST /api/validate endpoint called`);
  console.log(`[Validator Server] Request body:`, JSON.stringify(req.body, null, 2));
  console.log(`[Validator Server] ========================================`);
  
  try {
    const chainId = req.body.chainId ? Number(req.body.chainId) : DEFAULT_CHAIN_ID;
    const agentIdFilter =
      typeof req.body.agentId === 'string' && req.body.agentId.trim().length > 0
        ? req.body.agentId.trim()
        : undefined;
    console.log(`[Validator Server] Resolved chainId: ${chainId}`);
    if (agentIdFilter) {
      console.log(`[Validator Server] Filtering to agentId: ${agentIdFilter}`);
    }

    console.log(`[Validator Server] Calling processValidationRequests(${chainId}, ${agentIdFilter ?? 'ALL'})...`);
    const results = await processValidationRequests(chainId, agentIdFilter);
    console.log(`[Validator Server] processValidationRequests() returned ${results.length} results`);

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    console.log(
      `[Validator Server] Processing complete: ${successCount} successful, ${failureCount} failed`,
    );

    res.json({
      success: true,
      chainId,
      agentId: agentIdFilter,
      processed: results.length,
      successful: successCount,
      failed: failureCount,
      results,
    });
  } catch (error) {
    console.error('[Validator Server] Error processing validation requests:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Convenience endpoint to process validations for a specific agent via URL param
 */
app.post('/api/validate/agent/:agentId', async (req: Request, res: Response) => {
  const agentId = req.params.agentId;
  if (!agentId) {
    return res.status(400).json({ success: false, error: 'agentId parameter is required' });
  }
  try {
    const chainId = req.body.chainId ? Number(req.body.chainId) : DEFAULT_CHAIN_ID;
    const results = await processValidationRequests(chainId, agentId);
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;
    res.json({
      success: true,
      chainId,
      agentId,
      processed: results.length,
      successful: successCount,
      failed: failureCount,
      results,
    });
  } catch (error) {
    console.error('[Validator Server] Error processing agent-specific validation requests:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get validation status endpoint
 */
app.get('/api/status', async (req: Request, res: Response) => {
  try {
    const chainId = req.query.chainId ? Number(req.query.chainId) : DEFAULT_CHAIN_ID;

    // Get validator address (AA address from AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY)
    const validatorPrivateKey = process.env.AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY;
    if (!validatorPrivateKey) {
      return res.status(500).json({
        error: 'AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY not configured (needed for validator AA address)',
      });
    }

    const { createValidatorAccountAbstraction } = await import('@agentic-trust/core/server');
    const { address: validatorAddress } = await createValidatorAccountAbstraction(
      'name-validator',
      validatorPrivateKey,
      chainId,
    );

    const { getValidationRegistryClient } = await import('@agentic-trust/core/server');
    const validationRegistryClient = await getValidationRegistryClient(chainId);

    const requestHashes = await validationRegistryClient.getValidatorRequests(validatorAddress);

    const pending: unknown[] = [];
    const completed: unknown[] = [];

    for (const hash of requestHashes) {
      try {
        const status = await validationRegistryClient.getValidationStatus(hash);
        if (status.response === 0) {
          pending.push({
            requestHash: hash,
            agentId: status.agentId.toString(),
            validatorAddress: status.validatorAddress,
          });
        } else {
          completed.push({
            requestHash: hash,
            agentId: status.agentId.toString(),
            validatorAddress: status.validatorAddress,
            response: status.response,
          });
        }
      } catch {
        // Ignore invalid entries
      }
    }

    res.json({
      validatorAddress,
      chainId,
      totalRequests: requestHashes.length,
      pending: pending.length,
      completed: completed.length,
      pendingRequests: pending,
      completedRequests: completed,
    });
  } catch (error) {
    console.error('[Validator Server] Error getting status:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`[Validator Server] ========================================`);
  console.log(`[Validator Server] Server started successfully`);
  console.log(`[Validator Server] Port: ${PORT}`);
  console.log(`[Validator Server] Health check: http://localhost:${PORT}/health`);
  console.log(`[Validator Server] Process validations: POST http://localhost:${PORT}/api/validate`);
  console.log(`[Validator Server] Get status: GET http://localhost:${PORT}/api/status`);
  console.log(`[Validator Server] ========================================`);

  // Optionally process validation requests on startup if AUTO_PROCESS env var is set
  const autoProcess = process.env.AGENTIC_TRUST_VALIDATOR_AUTO_PROCESS === 'true';
  if (autoProcess) {
    console.log(`[Validator Server] AUTO_PROCESS enabled - processing validation requests on startup...`);
    try {
      const results = await processValidationRequests();
      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;
      console.log(`[Validator Server] Startup processing complete: ${successCount} successful, ${failureCount} failed`);
    } catch (error) {
      console.error(`[Validator Server] Error during startup processing:`, error);
    }
  } else {
    console.log(`[Validator Server] AUTO_PROCESS disabled - call POST /api/validate to process requests`);
  }
});

// Log any unhandled errors
process.on('unhandledRejection', (error) => {
  console.error(`[Validator Server] Unhandled rejection:`, error);
});

process.on('uncaughtException', (error) => {
  console.error(`[Validator Server] Uncaught exception:`, error);
  process.exit(1);
});

