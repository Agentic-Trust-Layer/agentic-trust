export const dynamic = 'force-dynamic';

import { requestFeedbackAuthRouteHandler } from '@agentic-trust/core/server';
import { resolveDid8004FromUaid } from '../../_lib/uaid';

const handler = requestFeedbackAuthRouteHandler();

export async function GET(request: Request, { params }: { params: { uaid: string } }) {
  const { did8004 } = resolveDid8004FromUaid(params.uaid);
  return handler(request, { params: { did8004 } });
}

export async function POST(request: Request, { params }: { params: { uaid: string } }) {
  const { did8004 } = resolveDid8004FromUaid(params.uaid);
  return handler(request, { params: { did8004 } });
}

