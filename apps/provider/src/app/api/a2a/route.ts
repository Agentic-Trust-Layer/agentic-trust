import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@/lib/client';

/**
 * Force dynamic rendering for this route
 * This route handles A2A requests and needs to be server-rendered
 */
export const dynamic = 'force-dynamic';

/**
 * CORS headers for A2A endpoint
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // Allow all origins, or specify: 'http://localhost:3002'
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

/**
 * Handle OPTIONS preflight requests for CORS
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
}


/**
 * A2A (Agent-to-Agent) API Endpoint
 * Handles incoming A2A messages from other agents
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Extract A2A request data
    const { fromAgentId, toAgentId, message, payload, metadata, skillId, auth } = body;

    // Validate required fields
    if (!fromAgentId || !toAgentId) {
      return NextResponse.json(
        { success: false, error: 'fromAgentId and toAgentId are required' },
        { 
          status: 400,
          headers: getCorsHeaders(),
        }
      );
    }

    // Verify authentication if provided (first connection)
    let authenticatedClientAddress: string | null = null;
    if (auth) {
      const atClient = await getAgenticTrustClient();
      // Base URL of the provider app (for challenge audience validation)
      const providerUrl = process.env.PROVIDER_BASE_URL || '';
      
      // Verify the challenge using AgenticTrustClient (handles Veramo internally)
      const verification = await atClient.verifyChallenge(auth, providerUrl);
      
      if (!verification.valid) {
        return NextResponse.json(
          { success: false, error: `Authentication failed: ${verification.error}` },
          { 
            status: 401,
            headers: getCorsHeaders(),
          }
        );
      }

      // Extract client address from verification result or auth
      authenticatedClientAddress = verification.clientAddress || auth.ethereumAddress || null;

      console.log('Client authenticated:', {
        did: auth.did,
        kid: auth.kid,
        algorithm: auth.algorithm,
        clientAddress: authenticatedClientAddress,
      });
    } else {
      // Authentication is optional for now, but recommended
      console.warn('A2A request received without authentication');
    }

    // Process the A2A message
    // This is where you would implement your agent's business logic
    console.log('Received A2A message:', {
      fromAgentId,
      toAgentId,
      message,
      payload,
      metadata,
      skillId,
      timestamp: new Date().toISOString(),
    });

    // Handle skill-based requests
    const responseContent: Record<string, unknown> = {
      received: true,
      processedAt: new Date().toISOString(),
      echo: message || 'Message received',
      ...(payload && { receivedPayload: payload }),
    };

    // If skillId is provided, handle skill-specific logic
    if (skillId === 'general_movie_chat') {
      // Movie chat skill handler
      const userMessage = message?.toLowerCase() || '';
      
      // Simple keyword-based responses (in a real implementation, this would use an LLM)
      if (userMessage.includes('inception')) {
        responseContent.response = `Inception is a 2010 science fiction film directed by Christopher Nolan. It follows Dom Cobb (Leonardo DiCaprio), a skilled thief who enters people's dreams to steal secrets from their subconscious. The film explores themes of reality, dreams, and the nature of consciousness.`;
        responseContent.skill = 'general_movie_chat';
      } else if (userMessage.includes('matrix') || userMessage.includes('keanu')) {
        responseContent.response = `The Matrix is a 1999 science fiction film directed by the Wachowskis, starring Keanu Reeves as Neo. It's a groundbreaking film that explores themes of reality, simulation, and human consciousness.`;
        responseContent.skill = 'general_movie_chat';
      } else if (userMessage.includes('recommend') || userMessage.includes('sci-fi')) {
        responseContent.response = `Here are some great sci-fi movie recommendations: Blade Runner 2049, Interstellar, The Matrix, Ex Machina, and Arrival.`;
        responseContent.skill = 'general_movie_chat';
      } else {
        responseContent.response = `I'd be happy to help with movie questions! Try asking about specific movies, actors, directors, or request recommendations. For example: "Tell me about Inception" or "Recommend a good sci-fi movie."`;
        responseContent.skill = 'general_movie_chat';
      }
    } else if (skillId === 'agent.feedback.requestAuth') {
      // Feedback request auth skill handler
      try {

        const atClient = await getAgenticTrustClient();
        const clientAddress = payload.clientAddress;


        const {
          agentId: agentIdParam,
          expirySeconds
        } = payload || {};


        // For agent.feedback.requestAuth skill, clientAddress MUST be provided in payload
        if (!clientAddress) {
          responseContent.error = 'clientAddress is required in payload for agent.feedback.requestAuth skill';
          responseContent.skill = skillId;
          return NextResponse.json(
            {
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            },
            {
              status: 400,
              headers: getCorsHeaders(),
            }
          );
        }
        
        try {
          // Get agent instance (we need it for feedback.requestAuth)
          // The agentId should match the session package agentId
          const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
          let agentIdForRequest: string | undefined;
          if (sessionPackagePath) {
            const { loadSessionPackage } = await import('@agentic-trust/core/server');
            const sessionPackage = loadSessionPackage(sessionPackagePath);
            agentIdForRequest = sessionPackage.agentId.toString();
          } else {
            agentIdForRequest = agentIdParam?.toString();
          }
          
          // Get agent by ID to use its feedback.requestAuth method
          const agent = agentIdForRequest ? await atClient.agents.getAgent(agentIdForRequest) : null;
          
          if (!agent) {
            throw new Error('Agent not found. Cannot request feedback auth without agent instance.');
          }
          
          // Request feedback auth - Agent.feedback.requestAuth handles all session package, delegation setup, etc.
          
          const feedbackAuthResponse = await agent.feedback.requestAuth({
            clientAddress,
            agentId: agentIdParam,
            skillId: skillId,
            expirySeconds
          });
          
          // Use the response directly from agent feedback API
          responseContent.feedbackAuth = feedbackAuthResponse.feedbackAuth;
          responseContent.agentId = feedbackAuthResponse.agentId;
          responseContent.clientAddress = feedbackAuthResponse.clientAddress;
          responseContent.skill = feedbackAuthResponse.skill;
        } catch (error: any) {
          console.error('Error creating feedback auth:', error);
          responseContent.error = error?.message || 'Failed to create feedback auth';
          responseContent.skill = skillId;
        }
      
      } catch (error: any) {
        console.error('Error creating feedback auth:', error);
        responseContent.error = error?.message || 'Failed to create feedback auth';
        responseContent.skill = skillId;
      }
    } else if (skillId) {
      // Other skill handlers can be added here
      responseContent.response = `Received request for skill: ${skillId}. This skill is not yet implemented.`;
      responseContent.skill = skillId;
    }

    // Generate a response
    const response = {
      success: true,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      response: responseContent,
    };

    return NextResponse.json(response, {
      headers: getCorsHeaders(),
    });
  } catch (error) {
    console.error('Error processing A2A request:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { 
        status: 500,
        headers: getCorsHeaders(),
      }
    );
  }
}

/**
 * Get A2A endpoint info
 */
export async function GET() {
  const providerId = process.env.PROVIDER_ID || 'default-provider';
  const agentName = process.env.AGENT_NAME || 'Agent Provider';
  
  // Base URL of the provider app (for constructing endpoint URL)
  // Try PROVIDER_BASE_URL first, then NEXT_PUBLIC_BASE_URL, then fallback to localhost
  const providerUrl = process.env.PROVIDER_BASE_URL || 
                     process.env.NEXT_PUBLIC_BASE_URL || 
                     'http://localhost:3001';
  
  return NextResponse.json({
    providerId,
    agentName,
    endpoint: `${providerUrl}/api/a2a`,
    method: 'POST',
    capabilities: ['receive-a2a-messages', 'echo', 'process-payload'],
    version: '1.0.0',
  }, {
    headers: getCorsHeaders(),
  });
}

