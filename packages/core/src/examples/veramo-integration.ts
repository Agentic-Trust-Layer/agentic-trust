/**
 * Example: Creating AgenticTrustClient with Veramo Agent
 * 
 * This example shows how to create an AgenticTrustClient with a Veramo agent.
 * The Veramo agent is required and automatically connected during construction.
 */

import { AgenticTrustClient, type VeramoAgent } from '../index';
import type { TAgent } from '@veramo/core';
import type {
  IKeyManager,
  IDIDManager,
  ICredentialIssuer,
  ICredentialVerifier,
  IResolver,
} from '@veramo/core';

// Example type for your Veramo agent
type YourVeramoAgent = TAgent<
  IKeyManager & IDIDManager & ICredentialIssuer & ICredentialVerifier & IResolver
>;

/**
 * Example function showing how to create a client with your Veramo agent
 */
export async function createClientWithAgentExample(
  veramoAgent: YourVeramoAgent
): Promise<AgenticTrustClient> {
  // Create the client - agent is automatically connected
  const client = await AgenticTrustClient.create({
    apiKey: process.env.AGENTIC_TRUST_API_KEY,
    veramoAgent: veramoAgent, // Optional - will be created if not provided
  });

  // Agent is immediately available
  const agent = client.veramo.getAgent();

  // Example: Use the agent to resolve a DID
  const did = 'did:agent:client:1:0x123...';
  const didDocument = await agent.resolveDid({ didUrl: did });

  // Example: Use the agent to create a credential
  // const credential = await agent.createVerifiableCredential({ ... });

  // Example: Use the agent for key management
  // const key = await agent.keyManagerGet({ kid: '...' });

  console.log('AgenticTrustClient created with Veramo agent!');
  return client;
}

/**
 * Complete example setup combining both
 */
export async function setupAgentWithClient(agent: YourVeramoAgent) {
  // 1. Create your Veramo agent (as shown in your example)
  // const agent = createAgent({ plugins: [...] });

  // 2. Create AgenticTrustClient with agent - it's automatically connected
  const client = AgenticTrustClient.create({
    apiKey: process.env.AGENTIC_TRUST_API_KEY,
    veramoAgent: agent, // Required - automatically connected
  });

  return client;
}

