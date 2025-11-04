import { NextRequest, NextResponse } from 'next/server';
import { createVeramoAgent } from '@/lib/veramo';
import { verifyChallenge, nonceStore } from '@/lib/verification';

// Cache Veramo agent instance
let veramoAgent: Awaited<ReturnType<typeof createVeramoAgent>> | null = null;

async function getVeramoAgent() {
  if (!veramoAgent) {
    veramoAgent = await createVeramoAgent();
  }
  return veramoAgent;
}

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
    if (auth) {
      const agent = await getVeramoAgent();
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
      
      // Extract nonce from challenge
      const challengeLines = auth.challenge.split('\n');
      const nonceLine = challengeLines.find((line: string) => line.startsWith('nonce='));
      const nonce = nonceLine?.split('=')[1];

      if (nonce) {
        // Check for replay attacks
        if (nonceStore.has(nonce)) {
          return NextResponse.json(
            { success: false, error: 'Replay attack detected: nonce already used' },
            { 
              status: 401,
              headers: getCorsHeaders(),
            }
          );
        }
      }

      // Verify the challenge
      const verification = await verifyChallenge(agent, auth, baseUrl);
      
      if (!verification.valid) {
        return NextResponse.json(
          { success: false, error: `Authentication failed: ${verification.error}` },
          { 
            status: 401,
            headers: getCorsHeaders(),
          }
        );
      }

      // Add nonce to store to prevent replay
      if (nonce) {
        nonceStore.add(nonce);
      }

      console.log('Client authenticated:', {
        did: auth.did,
        kid: auth.kid,
        algorithm: auth.algorithm,
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
    let responseContent: any = {
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
  
  // In production, this would be the actual URL where this provider is hosted
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');
  
  return NextResponse.json({
    providerId,
    agentName,
    endpoint: `${baseUrl}/api/a2a`,
    method: 'POST',
    capabilities: ['receive-a2a-messages', 'echo', 'process-payload'],
    version: '1.0.0',
  }, {
    headers: getCorsHeaders(),
  });
}

