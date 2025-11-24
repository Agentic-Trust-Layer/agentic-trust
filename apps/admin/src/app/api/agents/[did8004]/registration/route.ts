export const dynamic = 'force-dynamic';

/**
 * Next.js API Route for updating agent registration with Account Abstraction
 * 
 * This route uses the library-provided handler from @agentic-trust/core/server
 * No custom logic needed - just re-export the handler from the library.
 */
import { updateAgentRegistrationRouteHandler } from '@agentic-trust/core/server';

export const PUT = updateAgentRegistrationRouteHandler();


