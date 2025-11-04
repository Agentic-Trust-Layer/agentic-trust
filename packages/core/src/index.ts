/**
 * @agentic-trust/core
 * 
 * Core SDK for agentic trust systems
 */

// Core AgenticTrust client exports
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

// ERC-8004 Agentic Trust SDK exports
// Re-export all ERC-8004 functionality for convenience
export {
  AIAgentENSClient,
  AIAgentL2ENSDurenClient,
  AIAgentL2ENSNamespaceClient,
  AIAgentIdentityClient,
  AIAgentReputationClient,
  OrgIdentityClient,
  type GiveFeedbackParams,
} from '@erc8004/agentic-trust-sdk';
