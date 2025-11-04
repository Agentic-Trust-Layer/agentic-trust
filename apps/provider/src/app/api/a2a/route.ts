import { NextRequest, NextResponse } from 'next/server';
import { verifyChallenge, nonceStore } from '@/lib/verification';
import { getProviderClient } from '@/lib/client';
import { createFeedbackAuth } from '@agentic-trust/core';
import { http, createWalletClient } from 'viem';

/**
 * Get Veramo agent from AgenticTrustClient
 * The client creates and manages its own Veramo agent internally
 */
async function getVeramoAgent() {
  const client = await getProviderClient();
  return client.veramo.getAgent();
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
    let authenticatedClientAddress: string | null = null;
    if (auth) {
      const agent = await getVeramoAgent();
      // Base URL of the provider app (for challenge audience validation)
      const providerUrl = process.env.PROVIDER_BASE_URL || '';
      
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
      const verification = await verifyChallenge(agent, auth, providerUrl);
      
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

      // Extract client address from auth if available
      if (auth.ethereumAddress) {
        authenticatedClientAddress = auth.ethereumAddress;
      } else if (auth.did?.startsWith('did:ethr:')) {
        // Extract address from ethr DID
        const addressMatch = auth.did.match(/did:ethr:0x[a-fA-F0-9]{40}/);
        if (addressMatch) {
          authenticatedClientAddress = addressMatch[0].replace('did:ethr:', '');
        }
      }

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
        const client = await getProviderClient();
        
        // Check if reputation client is initialized
        if (!client.reputation.isInitialized()) {
          responseContent.error = 'Reputation client not initialized. Configure session package in environment variables.';
          responseContent.skill = skillId;
        } else {
          // Get reputation client
          const reputationClient = client.reputation.getClient();
          
          // Extract parameters from payload
          const {
            clientAddress: payloadClientAddress,
            agentId: agentIdParam,
            indexLimitOverride,
            expirySeconds,
            chainIdOverride,
          } = payload || {};


          console.info("payloadClientAddress", payloadClientAddress);
          console.info("agentIdParam", agentIdParam);
          console.info("indexLimitOverride", indexLimitOverride);
          console.info("expirySeconds", expirySeconds);
          console.info("chainIdOverride", chainIdOverride);
          
          // For agent.feedback.requestAuth skill, clientAddress MUST be provided in payload
          if (!payloadClientAddress) {
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
          
          const clientAddress = payloadClientAddress;
          
          // Load session package early to get both clientAddress fallback and agent account
          const { loadSessionPackage, buildDelegationSetup, buildAgentAccountFromSession } = await import('@agentic-trust/core');
          
          const sessionPackagePath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
          
          if (!sessionPackagePath) {
            console.error('Session package path not configured');
            responseContent.error = 'Session package path not configured';
            responseContent.skill = skillId;
          } else {
            const sessionPackage = loadSessionPackage(sessionPackagePath);
            
            // clientAddress should already be validated above (line 194), but double-check for safety
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
            
            const delegationSetup = buildDelegationSetup(sessionPackage);
            
            // Get agent account from session package
            console.info("buildAgentAccountFromSession ")
            const agentAccount = await buildAgentAccountFromSession(sessionPackage);
            
            console.info("createWalletClient ")
            // Create wallet client for signing
            const walletClient = createWalletClient({
              account: agentAccount,
              chain: delegationSetup.chain,
              transport: http(delegationSetup.rpcUrl),
            });
            
            // Use agentId from session package if not provided in payload
            const agentId = agentIdParam ? BigInt(agentIdParam) : BigInt(sessionPackage.agentId);
            
            // Get reputation registry (from delegation setup or env override)
            const reputationRegistry = delegationSetup.reputationRegistry;
            console.info("reputationRegistry ")
            
            // Create feedback auth
            const signature = await createFeedbackAuth(
              {
                publicClient: delegationSetup.publicClient,
                reputationRegistry,
                agentId,
                clientAddress: clientAddress as `0x${string}`,
                signer: agentAccount,
                walletClient: walletClient as any,
                indexLimitOverride: indexLimitOverride ? BigInt(indexLimitOverride) : undefined,
                expirySeconds,
                chainIdOverride: chainIdOverride ? BigInt(chainIdOverride) : undefined,
              },
              reputationClient
            );
            
            responseContent.signature = signature;
            responseContent.agentId = agentId.toString();
            responseContent.clientAddress = clientAddress;
            responseContent.skill = skillId;
          }
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
  const providerUrl = process.env.PROVIDER_BASE_URL || 'http://localhost:3001';
  
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

