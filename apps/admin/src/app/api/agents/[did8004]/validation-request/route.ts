export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { prepareValidationRequestRouteHandler } from '@agentic-trust/core/server';

const handler = prepareValidationRequestRouteHandler();

export async function POST(
  request: NextRequest,
  { params }: { params: { did8004: string } },
) {
  // Next.js passes params as { did8004: string }, but handler expects { params: RouteParams }
  return handler(request, { params });
}

