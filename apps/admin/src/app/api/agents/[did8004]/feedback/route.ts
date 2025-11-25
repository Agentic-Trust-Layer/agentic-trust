export const dynamic = 'force-dynamic';

import {
  getFeedbackRouteHandler,
  prepareFeedbackRouteHandler,
} from '@agentic-trust/core/server';

export const GET = getFeedbackRouteHandler();
export const POST = prepareFeedbackRouteHandler();


