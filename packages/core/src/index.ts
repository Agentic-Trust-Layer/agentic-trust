/**
 * @agentic-trust/core
 * 
 * Core SDK for agentic trust systems
 */

// Core AgenticTrust client exports
export { AgenticTrustClient, createVeramoAgentForClient } from './client';
export { fetchAgentCard } from './client/agentCard';
export { Agent } from './client';

// API route handlers (reusable across apps)
export { handleCreateAgent } from './api/agents/create';
export type { CreateAgentRequestBody } from './api/agents/create';
export { handleGetAgentInfo } from './api/agents/getAgentInfo';
export type { AgentInfoResponse } from './api/agents/getAgentInfo';
export type { 
  MessageRequest, 
  MessageResponse, 
  AgentCard, 
  AgentSkill, 
  AgentCapabilities,
} from './client';
export type {
  ApiClientConfig,
  AgentProvider,
  A2ARequest,
  A2AResponse,
  ProviderEndpoint,
  AgentRegistration,
  VeramoAgent,
  AuthChallenge,
  ChallengeVerificationResult,
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

// Export AccountProvider types from erc8004-sdk for convenience
export {
  ViemAccountProvider,
  type AccountProvider,
  type ChainConfig,
  type ReadClient,
  type Signer,
  type TxSender,
  type TxRequest,
  type GasPolicy,
  type TxSendResult,
  type PreparedCall,
} from '@erc8004/sdk';

// Legacy export for backward compatibility (deprecated - use ViemAccountProvider instead)
export { ViemAdapter } from '@erc8004/sdk';

// Export session package utilities
export type { SessionPackage, DelegationSetup } from './client';
export {
  loadSessionPackage,
  validateSessionPackage,
  buildDelegationSetup,
  buildAgentAccountFromSession,
} from './client';

// Export feedback auth utilities
export { createFeedbackAuth } from './client/agentFeedback';
export type { RequestAuthParams } from './client/agentFeedback';

// Export reputation client singleton
export {
  getReputationClient,
  isReputationClientInitialized,
  resetReputationClient,
} from './client/reputationClient';

// Export client app singleton
export {
  getClientApp,
  getClientAddress,
  isClientAppInitialized,
  resetClientApp,
} from './client/clientApp';

// Export provider app singleton
export {
  getProviderApp,
  getProviderAgentId,
  isProviderAppInitialized,
  resetProviderApp,
} from './client/providerApp';

// Export identity client singleton
export {
  getIdentityClient,
  isIdentityClientInitialized,
  resetIdentityClient,
} from './client/identityClient';

// Export admin app singleton
export {
  getAdminApp,
  getAdminAddress,
  isAdminAppInitialized,
  resetAdminApp,
} from './client/adminApp';

// Export IPFS storage
export {
  createIPFSStorage,
  getIPFSStorage,
  isIPFSStorageInitialized,
  resetIPFSStorage,
  type IPFSStorage,
  type IPFSConfig,
  type UploadResult,
} from './storage/ipfs';

// Export ERC-8004 registration JSON utilities
export {
  uploadRegistration,
  getRegistration,
  createRegistrationJSON,
  type AgentRegistrationJSON,
} from './client/registration';

// Note: getAgentsGraphQLClient is intentionally NOT exported
// Apps should use AgenticTrustClient.agents.getAgentFromGraphQL() instead
// Internal singleton utilities remain internal

// Re-export AI Agent GraphQL Client types from SDK
export type {
  AIAgentGraphQLClient,
  AIAgentGraphQLClientConfig,
  AgentData,
  ListAgentsResponse,
  GetAgentResponse,
  SearchAgentsResponse,
  RefreshAgentResponse,
} from '@erc8004/agentic-trust-sdk';

// Export client-side wallet signing utilities
export {
  signAndSendTransaction,
  extractAgentIdFromReceipt,
  refreshAgentInIndexer,
  isWalletProviderAvailable,
  getWalletAddress,
} from './client/walletSigning';
export type {
  PreparedTransaction,
  TransactionResult,
  SignTransactionOptions,
} from './client/walletSigning';
