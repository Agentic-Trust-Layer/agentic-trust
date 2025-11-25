export const dynamic = 'force-dynamic';

// Use the same core search handlers as admin, with a namespace import to
// avoid potential type drift until the core package types are fully rebuilt.
import * as CoreServer from '@agentic-trust/core/server';

export const GET = (CoreServer as any).searchAgentsGetRouteHandler();
export const POST = (CoreServer as any).searchAgentsPostRouteHandler();


