export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { prepareValidationRequestRouteHandler } from '@agentic-trust/core/server';
import { resolveDid8004FromUaidOrDid } from '../../_lib/uaid';

const handler = prepareValidationRequestRouteHandler();

export async function POST(
  request: NextRequest,
  { params }: { params: { uaid: string } },
) {
  const { did8004 } = resolveDid8004FromUaidOrDid(params.uaid);
  return handler(request, { params: { did8004 } });
}

