/**
 * Express-compatible handler for updating agent registration with Account Abstraction
 * 
 * Usage in your Express app:
 * 
 * ```typescript
 * import express from 'express';
 * import { updateAgentRegistrationExpressHandler } from '@agentic-trust/core/server/api/agents/express';
 * 
 * const app = express();
 * app.use(express.json());
 * 
 * // For route: /api/agents/:did8004/registration
 * app.put('/api/agents/:did8004/registration', updateAgentRegistrationExpressHandler);
 * ```
 * 
 * Note: The route parameter should be URL-encoded, e.g., `did%3A8004%3A11155111%3A123`
 */

// Express types - using any to avoid requiring express as a dependency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Request = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Response = any;
import { handleUpdateAgentRegistration } from '../handlers/update-registration';

/**
 * Express handler for updating agent registration
 */
export async function updateAgentRegistrationExpressHandler(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    // Extract did:8004 from route params
    // Express will decode it automatically
    const agentDid = req.params.did8004 || req.params['did:8004'];
    
    if (!agentDid) {
      res.status(400).json({
        error: 'Missing did:8004 parameter',
      });
      return;
    }

    const result = await handleUpdateAgentRegistration(agentDid, req.body);
    res.status(result.status).json(result.data);
  } catch (error) {
    console.error('Unexpected error in Express handler:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

