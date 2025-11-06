/**
 * @agentic-trust/core/server
 * 
 * Server-only exports for @agentic-trust/core
 * These should NOT be imported in client-side code (browser)
 */

// Export session package utilities (server-only, uses Node.js 'fs')
export type { SessionPackage, DelegationSetup } from './client/sessionPackage';
export {
  loadSessionPackage,
  validateSessionPackage,
  buildDelegationSetup,
  buildAgentAccountFromSession,
} from './client/sessionPackage';

