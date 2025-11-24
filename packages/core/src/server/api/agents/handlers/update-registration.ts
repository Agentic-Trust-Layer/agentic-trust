/**
 * Framework-agnostic handler for updating agent registration with Account Abstraction
 * 
 * This contains the core business logic that can be used by both Next.js and Express handlers.
 */

import { getAgenticTrustClient } from '../../../lib/agenticTrust';
import { uploadRegistration } from '../../../lib/agentRegistration';
import { parseDid8004 } from '../../../../shared/did8004';

export interface UpdateAgentRegistrationRequest {
  registration: unknown;
}

export interface UpdateAgentRegistrationResponse {
  success: true;
  cid: string;
  tokenUri: string;
  chainId: number;
  identityRegistry: string;
  bundlerUrl: string;
  calls: Array<{
    to: string;
    data: string;
    value: string;
  }>;
}

export interface UpdateAgentRegistrationError {
  error: string;
  message?: string;
  details?: string;
}

/**
 * Framework-agnostic handler for updating agent registration
 */
export async function handleUpdateAgentRegistration(
  agentDid: string,
  body: unknown,
): Promise<{ status: number; data: UpdateAgentRegistrationResponse | UpdateAgentRegistrationError }> {
  try {
    let parsed;
    try {
      parsed = parseDid8004(agentDid);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'Invalid 8004 DID';
      return {
        status: 400,
        data: {
          error: 'Invalid 8004 DID',
          message,
        },
      };
    }

    const { registration: registrationRaw } = (body ?? {}) as Partial<UpdateAgentRegistrationRequest>;

    if (!registrationRaw) {
      return {
        status: 400,
        data: {
          error: 'Missing registration payload in request body',
        },
      };
    }

    let registration: unknown;
    if (typeof registrationRaw === 'string') {
      try {
        registration = JSON.parse(registrationRaw);
      } catch (error) {
        return {
          status: 400,
          data: {
            error: 'Invalid registration JSON string',
            message: error instanceof Error ? error.message : 'Failed to parse JSON',
          },
        };
      }
    } else if (typeof registrationRaw === 'object') {
      registration = registrationRaw;
    } else {
      return {
        status: 400,
        data: {
          error: 'registration must be a JSON object or stringified JSON',
        },
      };
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

    return {
      status: 200,
      data: {
        success: true,
        cid: uploadResult.cid,
        tokenUri: uploadResult.tokenUri,
        chainId: prepared.chainId,
        identityRegistry: prepared.identityRegistry,
        bundlerUrl: prepared.bundlerUrl,
        calls: jsonSafeCalls,
      },
    };
  } catch (error: unknown) {
    console.error('Error updating agent registration:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    return {
      status: 500,
      data: {
        error: 'Failed to update agent registration',
        message,
        details: process.env.NODE_ENV === 'development' ? stack : undefined,
      },
    };
  }
}

