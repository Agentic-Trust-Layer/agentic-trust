/**
 * @agentic-trust/core
 * 
 * Core SDK for agentic trust systems
 */

export { AgenticTrustClient, createVeramoAgentForClient } from './client';
export { fetchAgentCard } from './client/agentCard';
export { Agent } from './client';
export type { 
  MessageRequest, 
  MessageResponse, 
  AgentCard, 
  AgentSkill, 
  AgentCapabilities,
  AgentData,
  ListAgentsResponse,
} from './client';
export type {
  ApiClientConfig,
  AgentProvider,
  A2ARequest,
  A2AResponse,
  ProviderEndpoint,
  AgentRegistration,
  VeramoAgent,
  Challenge,
  ChallengeRequest,
  SignedChallenge,
  VerificationRequest,
  VerificationResult,
} from './client';
