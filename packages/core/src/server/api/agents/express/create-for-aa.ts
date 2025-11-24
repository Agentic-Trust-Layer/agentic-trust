/**
 * Express-compatible handler for creating agents with Account Abstraction
 * 
 * Usage in your Express app:
 * 
 * ```typescript
 * import express from 'express';
 * import { createAgentForAAExpressHandler } from '@agentic-trust/core/server/api/agents/express';
 * 
 * const app = express();
 * app.use(express.json());
 * 
 * app.post('/api/agents/create-for-aa', createAgentForAAExpressHandler);
 * ```
 */

// Express types - using any to avoid requiring express as a dependency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Request = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Response = any;
import { handleCreateAgentForAA } from '../handlers/create-for-aa';

/**
 * Express handler for creating agents with AA
 */
export async function createAgentForAAExpressHandler(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const result = await handleCreateAgentForAA(req.body);
    res.status(result.status).json(result.data);
  } catch (error) {
    console.error('Unexpected error in Express handler:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

