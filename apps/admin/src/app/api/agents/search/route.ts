export const dynamic = 'force-dynamic';

import {
  searchAgentsGetRouteHandler,
  searchAgentsPostRouteHandler,
} from '@agentic-trust/core/server';

export const GET = searchAgentsGetRouteHandler();
export const POST = searchAgentsPostRouteHandler();