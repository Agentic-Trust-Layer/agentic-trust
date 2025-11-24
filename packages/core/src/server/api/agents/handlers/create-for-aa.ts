/**
 * Framework-agnostic handler for creating agents with Account Abstraction
 * 
 * This contains the core business logic that can be used by both Next.js and Express handlers.
 */

import { getAgenticTrustClient } from '../../../lib/agenticTrust';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export interface CreateAgentForAARequest {
  agentName: string;
  agentAccount: string;
  account: string;
  description?: string;
  image?: string;
  agentUrl?: string;
  supportedTrust?: string[];
  endpoints?: Array<{
    name: string;
    endpoint: string;
    version?: string;
    capabilities?: Record<string, any>;
  }>;
  chainId?: number;
}

export interface CreateAgentForAAResponse {
  success: true;
  bundlerUrl: string;
  tokenUri: string;
  chainId: number;
  calls: Array<{
    to: string;
    data: string;
    value: string;
  }>;
}

export interface CreateAgentForAAError {
  error: string;
  message?: string;
}

/**
 * Framework-agnostic handler for creating agents with AA
 */
export async function handleCreateAgentForAA(
  body: unknown,
): Promise<{ status: number; data: CreateAgentForAAResponse | CreateAgentForAAError }> {
  try {
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
    } = (body ?? {}) as Partial<CreateAgentForAARequest>;

    console.log('[api/agents/create-for-aa] Received chainId:', chainId);

    if (!agentName || !agentAccount) {
      return {
        status: 400,
        data: {
          error: 'Missing required fields: agentName and agentAccount are required',
        },
      };
    }

    if (typeof agentAccount !== 'string' || !ADDRESS_REGEX.test(agentAccount)) {
      return {
        status: 400,
        data: {
          error: 'Invalid agentAccount format. Must be a valid Ethereum address (0x...)',
        },
      };
    }

    if (!account || typeof account !== 'string' || !ADDRESS_REGEX.test(account)) {
      return {
        status: 400,
        data: {
          error: 'Missing or invalid account address for agent AA creation',
        },
      };
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

    return {
      status: 200,
      data: {
        success: true,
        bundlerUrl: result.bundlerUrl,
        tokenUri: result.tokenUri,
        chainId: result.chainId,
        calls: result.calls.map((call) => ({
          to: call.to,
          data: call.data,
          value: 'value' in call && typeof call.value === 'bigint' ? call.value.toString() : '0',
        })),
      },
    };
  } catch (error) {
    console.error('Error in create agent route:', error);
    return {
      status: 500,
      data: {
        error: 'Failed to create agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

