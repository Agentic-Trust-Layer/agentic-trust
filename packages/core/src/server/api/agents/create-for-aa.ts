/**
 * Next.js API Route Handler for creating agents with Account Abstraction
 * 
 * This handler can be directly exported and used in Next.js apps.
 * The client-side function `createAgentWithWalletForAA` from `@agentic-trust/core/client`
 * automatically calls this endpoint at `/api/agents/create-for-aa`.
 * 
 * Usage in your Next.js app:
 * 
 * ```typescript
 * // In app/api/agents/create-for-aa/route.ts
 * export { createAgentForAAHandler as POST } from '@agentic-trust/core/server';
 * 
 * // Or using the direct import:
 * // export { POST } from '@agentic-trust/core/server/api/agents/create-for-aa';
 * ```
 * 
 * Then in your React component:
 * 
 * ```typescript
 * import { createAgentWithWalletForAA } from '@agentic-trust/core/client';
 * 
 * const result = await createAgentWithWalletForAA({
 *   agentData: {
 *     agentName: 'my-agent',
 *     agentAccount: '0x...',
 *     description: 'My agent description',
 *   },
 * });
 * ```
 * 
 * The client function handles:
 * - Wallet connection and account detection
 * - Chain selection and switching
 * - AA account client creation
 * - UserOperation submission via bundler
 * - Agent ID extraction and indexer refresh
 */

// Next.js types - these require Next.js to be installed in the consuming app
// Using any to avoid build-time dependency issues in the library
// In Next.js apps, these will be properly typed
import { getAgenticTrustClient } from '../../lib/agenticTrust';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NextRequest = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NextResponse = require('next/server').NextResponse as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NextResponseType = any;

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export async function POST(request: NextRequest): Promise<NextResponseType> {
  try {
    const body = await request.json();
    const {
      agentName,
      agentAccount,
      account,
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
      chainId,
    } = body ?? {};

    console.log('[api/agents/create-for-aa] Received chainId:', chainId);

    if (!agentName || !agentAccount) {
      return NextResponse.json(
        {
          error: 'Missing required fields: agentName and agentAccount are required',
        },
        { status: 400 }
      );
    }

    if (typeof agentAccount !== 'string' || !ADDRESS_REGEX.test(agentAccount)) {
      return NextResponse.json(
        {
          error: 'Invalid agentAccount format. Must be a valid Ethereum address (0x...)',
        },
        { status: 400 }
      );
    }

    if (!account || typeof account !== 'string' || !ADDRESS_REGEX.test(account)) {
      return NextResponse.json(
        {
          error: 'Missing or invalid account address for agent AA creation',
        },
        { status: 400 }
      );
    }

    const client = await getAgenticTrustClient();
    const result = await client.agents.createAgentForAA({
      agentName,
      agentAccount: agentAccount as `0x${string}`,
      description,
      image,
      agentUrl,
      supportedTrust,
      endpoints,
      chainId: chainId ? Number(chainId) : undefined,
    });

    return NextResponse.json({
      success: true as const,
      bundlerUrl: result.bundlerUrl,
      tokenUri: result.tokenUri,
      chainId: result.chainId,
      calls: result.calls,
    });
  } catch (error) {
    console.error('Error in create agent route:', error);
    return NextResponse.json(
      {
        error: 'Failed to create agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

