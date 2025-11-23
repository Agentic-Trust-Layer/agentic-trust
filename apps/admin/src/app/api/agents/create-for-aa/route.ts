export const dynamic = 'force-dynamic';

/**
 * Next.js API Route for creating agents with Account Abstraction
 * 
 * This route uses the library-provided handler from @agentic-trust/core/server
 * No custom logic needed - just re-export the handler from the library.
 */
export { createAgentForAAHandler as POST } from '@agentic-trust/core/server';
