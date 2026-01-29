export const dynamic = 'force-dynamic';

import { getFeedbackRouteHandler, prepareFeedbackRouteHandler } from '@agentic-trust/core/server';
import { resolveDid8004FromUaidOrDid } from '../../_lib/uaid';

const getHandler = getFeedbackRouteHandler();
const postHandler = prepareFeedbackRouteHandler();

export async function GET(request: Request, { params }: { params: { uaid: string } }) {
  const { did8004 } = resolveDid8004FromUaidOrDid(params.uaid);
  return getHandler(request, { params: { did8004 } });
}

export async function POST(request: Request, { params }: { params: { uaid: string } }) {
  const { did8004 } = resolveDid8004FromUaidOrDid(params.uaid);
  return postHandler(request, { params: { did8004 } });
}

