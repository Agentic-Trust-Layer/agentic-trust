import { NextResponse } from 'next/server';

/**
 * Agent Card endpoint (/.well-known/agent-card.json)
 * A2A standard endpoint for agent discovery
 * Returns the agent card with capabilities, skills, and endpoint information
 */
export async function GET() {
  const providerId = process.env.PROVIDER_ID || 'default-provider';
  const agentName = process.env.AGENT_NAME || 'Agent Provider';
  const agentDescription = process.env.AGENT_DESCRIPTION || 'A sample agent provider for A2A communication';
  
  // Get base URL for the provider
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
  
  // Get agent ID from environment or use default
  const agentId = parseInt(process.env.AGENT_ID || '11', 10);
  const agentAddress = process.env.AGENT_ADDRESS || 'eip155:11155111:0x80fAA3740fDb03D7536C7fEef94f6F34Ea932bd3';
  const agentSignature = process.env.AGENT_SIGNATURE || '0x4d6ff18c69d1306363b4728dfecbf6f71c552936c8cb3c5b47d255f0f20719f042e25d6b70258856a91c1c9c07ab7cb5ee5402fe0c6ff39109f2b63329993afe1b';

  const agentCard = {
    name: agentName,
    description: agentDescription,
    url: baseUrl,
    provider: {
      organization: process.env.PROVIDER_ORGANIZATION || 'A2A Samples',
      url: process.env.PROVIDER_URL || 'https://example.com/a2a-samples',
    },
    version: process.env.AGENT_VERSION || '0.0.2',
    capabilities: {
      streaming: process.env.CAPABILITY_STREAMING === 'true',
      pushNotifications: process.env.CAPABILITY_PUSH_NOTIFICATIONS === 'true',
      stateTransitionHistory: process.env.CAPABILITY_STATE_HISTORY === 'true',
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [
      {
        id: 'general_movie_chat',
        name: 'General Movie Chat',
        description: 'Answer general questions or chat about movies, actors, directors.',
        tags: ['movies', 'actors', 'directors'],
        examples: [
          'Tell me about the plot of Inception.',
          'Recommend a good sci-fi movie.',
          'Who directed The Matrix?',
          'What other movies has Scarlett Johansson been in?',
          'Find action movies starring Keanu Reeves',
          'Which came out first, Jurassic Park or Terminator 2?',
        ],
        inputModes: ['text'],
        outputModes: ['text', 'task-status'],
      },
      {
        id: 'agent.feedback.requestAuth',
        name: 'agent.feedback.requestAuth',
        tags: ['erc8004', 'feedback', 'auth', 'a2a'],
        examples: ['Client requests feedbackAuth after receiving results'],
        inputModes: ['text'],
        outputModes: ['text'],
        description: 'Issue a signed ERC-8004 feedbackAuth for a client to submit feedback',
      },
    ],
    registrations: [
      {
        agentId,
        agentAddress,
        signature: agentSignature,
      },
    ],
    trustModels: ['feedback'],
    supportsAuthenticatedExtendedCard: false,
    feedbackDataURI: '',
  };

  return NextResponse.json(agentCard, {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/**
 * Handle OPTIONS preflight requests for CORS
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

