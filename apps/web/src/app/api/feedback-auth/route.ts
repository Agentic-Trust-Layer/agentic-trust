export const dynamic = 'force-dynamic';

/**
 * Server-side API route for requesting feedbackAuth from a provider
 * Calls the provider's A2A endpoint to get feedback authorization
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const clientAddress = searchParams.get('clientAddress')?.trim();
    const agentId = searchParams.get('agentId')?.trim();
    const chainId = searchParams.get('chainId')?.trim();
    const indexLimit = searchParams.get('indexLimit') ? parseInt(searchParams.get('indexLimit')!, 10) : 1;
    const expirySec = searchParams.get('expirySec') ? parseInt(searchParams.get('expirySec')!, 10) : 3600;

    if (!clientAddress || !clientAddress.startsWith('0x') || clientAddress.length !== 42) {
      return NextResponse.json(
        { error: 'clientAddress must be a 0x-prefixed 20-byte address' },
        { status: 400 }
      );
    }

    if (!agentId || !chainId) {
      return NextResponse.json(
        { error: 'Both agentId and chainId are required' },
        { status: 400 }
      );
    }

    const atClient = await getAgenticTrustClient();

    const resolvedAgentId = agentId;
    const resolvedChainId = parseInt(chainId, 10);

    // Get agent by ID
    const agent = await atClient.agents.getAgent(agentId, resolvedChainId);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Get A2A endpoint using agent's getEndpoint method
    const endpointInfo = await agent.getEndpoint();
    if (!endpointInfo || !endpointInfo.endpoint) {
      return NextResponse.json(
        { error: 'Agent does not have an A2A endpoint' },
        { status: 500 }
      );
    }

    // Use the endpoint directly (it should already be the full A2A endpoint URL)
    const a2aUrl = endpointInfo.endpoint;
    
    // Build request body matching provider's expected format
    // Provider expects: skillId at top level, payload.clientAddress (required), payload.agentId (optional), payload.expirySeconds (optional)
    const payload: {
      clientAddress: string;
      agentId?: string | number;
      expirySeconds?: number;
    } = {
      clientAddress,
    };

    // Add agentId if available (convert to number if it's numeric)
    if (resolvedAgentId) {
      const agentIdNum = parseInt(resolvedAgentId, 10);
      payload.agentId = !isNaN(agentIdNum) ? agentIdNum : resolvedAgentId;
    }

    // Add expirySeconds if provided
    if (expirySec && expirySec > 0) {
      payload.expirySeconds = expirySec;
    }

    const requestBody = {
      skillId: 'agent.feedback.requestAuth',
      payload,
    };

    console.log('Calling A2A endpoint:', a2aUrl);
    console.log('Request body:', JSON.stringify(requestBody, null, 2));
    console.log('Resolved agent info:', { resolvedAgentId, resolvedChainId });

    const resp = await fetch(a2aUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '');
      console.error('Provider A2A error:', resp.status, errorText);
      return NextResponse.json(
        { error: `Provider responded with ${resp.status}: ${errorText}` },
        { status: resp.status }
      );
    }

    const data = await resp.json();

    // Extract feedbackAuth from response
    // The provider returns it in response.response.feedbackAuth
    const feedbackAuthId = data?.response?.feedbackAuth || data?.feedbackAuth || data?.feedbackAuthId || null;

    if (!feedbackAuthId) {
      console.error('No feedbackAuth in response:', data);
      return NextResponse.json(
        { error: 'No feedbackAuth returned by provider', details: data },
        { status: 500 }
      );
    }

    return NextResponse.json({
      feedbackAuthId,
      agentId: resolvedAgentId,
      chainId: resolvedChainId,
    });
  } catch (error: unknown) {
    console.error('Error getting feedback auth:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Failed to get feedback auth',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}
