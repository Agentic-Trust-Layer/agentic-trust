export const dynamic = 'force-dynamic';

import { getValidationsRouteHandler } from '@agentic-trust/core/server';
import { resolveDid8004FromUaidOrDid } from '../../_lib/uaid';

const handler = getValidationsRouteHandler();

export async function GET(request: Request, { params }: { params: { uaid: string } }) {
  const { did8004 } = resolveDid8004FromUaidOrDid(params.uaid);
  return handler(request, { params: { did8004 } });
}

