/**
 * Next.js API Route Handler for updating agent registration with Account Abstraction
 * 
 * This handler can be directly exported and used in Next.js apps.
 * The client-side function `updateAgentRegistrationWithWalletForAA` from `@agentic-trust/core/client`
 * automatically calls this endpoint at `/api/agents/[did:8004]/registration`.
 * 
 * Usage in your Next.js app:
 * 
 * ```typescript
 * // In app/api/agents/[did:8004]/registration/route.ts
 * export { updateAgentRegistrationHandler as PUT } from '@agentic-trust/core/server';
 * ```
 * 
 * Then in your React component:
 * 
 * ```typescript
 * import { updateAgentRegistrationWithWalletForAA } from '@agentic-trust/core/client';
 * 
 * const result = await updateAgentRegistrationWithWalletForAA({
 *   did8004: 'did:8004:11155111:123',
 *   chain: sepolia,
 *   accountClient: agentAccountClient,
 *   registration: { name: 'Updated Agent', description: '...' },
 * });
 * ```
 * 
 * The client function handles:
 * - Registration JSON serialization
 * - API call to prepare update calls
 * - UserOperation submission via bundler
 * - Receipt waiting and confirmation
 */

// Next.js types - these require Next.js to be installed in the consuming app
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NextRequest = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NextResponse = require('next/server').NextResponse as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NextResponseType = any;

import { getAgenticTrustClient } from '../../lib/agenticTrust';
import { uploadRegistration } from '../../lib/agentRegistration';
import { parseDid8004 } from '../../../shared/did8004';

// Handle different encodings of the colon in the route parameter (Next.js may encode it differently)
const DID_PARAM_KEYS = ['did:8004', 'did:8004', 'did:8004'] as const;

function getDidParam(params: Record<string, string | undefined>): string {
  for (const key of DID_PARAM_KEYS) {
    const value = params[key];
    if (value) {
      return decodeURIComponent(value);
    }
  }
  throw new Error('Missing did:8004 parameter');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Record<string, string | undefined> },
): Promise<NextResponseType> {
  try {
    const agentDid = getDidParam(params);

    let parsed;
    try {
      parsed = parseDid8004(agentDid);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid 8004 DID';
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message },
        { status: 400 },
      );
    }

    const body = await request.json();
    const registrationRaw = body?.registration;

    if (!registrationRaw) {
      return NextResponse.json(
        { error: 'Missing registration payload in request body' },
        { status: 400 },
      );
    }

    let registration: unknown;
    if (typeof registrationRaw === 'string') {
      try {
        registration = JSON.parse(registrationRaw);
      } catch (error) {
        return NextResponse.json(
          {
            error: 'Invalid registration JSON string',
            message: error instanceof Error ? error.message : 'Failed to parse JSON',
          },
          { status: 400 },
        );
      }
    } else if (typeof registrationRaw === 'object') {
      registration = registrationRaw;
    } else {
      return NextResponse.json(
        { error: 'registration must be a JSON object or stringified JSON' },
        { status: 400 },
      );
    }

    // Upload updated registration JSON to IPFS using core helper
    const uploadResult = await uploadRegistration(registration as any);

    // Prepare agent update calls via AgenticTrustClient (client-side AA/bundler execution)
    const client = await getAgenticTrustClient();
    const prepared = await client.prepareUpdateAgent({
      agentId: parsed.agentId,
      chainId: parsed.chainId,
      tokenUri: uploadResult.tokenUri,
    });

    const jsonSafeCalls = (prepared.calls || []).map((call: any) => ({
      to: call.to as string,
      data: call.data as string,
      value:
        typeof call.value === 'bigint'
          ? call.value.toString()
          : call.value ?? '0',
    }));

    return NextResponse.json({
      success: true,
      cid: uploadResult.cid,
      tokenUri: uploadResult.tokenUri,
      chainId: prepared.chainId,
      identityRegistry: prepared.identityRegistry,
      bundlerUrl: prepared.bundlerUrl,
      calls: jsonSafeCalls,
    });
  } catch (error: unknown) {
    console.error('Error updating agent registration:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to update agent registration',
        message,
        details: process.env.NODE_ENV === 'development' ? stack : undefined,
      },
      { status: 500 },
    );
  }
}

