export const dynamic = 'force-dynamic';

import { updateAgentRegistrationRouteHandler } from '@agentic-trust/core/server';
import { resolveDid8004FromUaid } from '../../_lib/uaid';

const handler = updateAgentRegistrationRouteHandler();

export async function PUT(request: Request, { params }: { params: { uaid: string } }) {
  const { did8004 } = resolveDid8004FromUaid(params.uaid);
  return handler(request, { params: { did8004 } });
}

