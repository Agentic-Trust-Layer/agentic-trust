/**
 * Server-only exports for @agentic-trust/core
 *
 * This entry point aggregates utilities that are safe to use in Node.js / server contexts only.
 * Import from `@agentic-trust/core/server` instead of the base package when you need these helpers.
 */

// API route handlers (server-side only)
export { handleResolveAccount } from './lib/resolveAccount';
export type { ResolveAccountRequestBody, ResolveAccountResponse } from './lib/resolveAccount';

// Server singletons & utilities
export {
  AgenticTrustClient,
} from './singletons/agenticTrustClient';

export {
  getAgenticTrustClient,
} from './lib/agenticTrust';

export type {
  ApiClientConfig,
} from './lib/types';

export {
  fetchA2AAgentCard,
} from './lib/a2aAgentCard';

export {
  Agent,
} from './lib/agent';

export type {
  AgentCard,
  AgentSkill,
  AgentCapabilities,
  MessageRequest,
  MessageResponse,
} from './lib/agent';

export {
  AgentsAPI,
} from './lib/agents';

export type {
  DiscoverParams,
  DiscoverAgentsOptions,
  ListAgentsOptions,
  ListAgentsResponse,
} from './lib/agents';

export {
  createFeedbackAuth,
} from './lib/agentFeedback';

export type {
  RequestAuthParams,
} from './lib/agentFeedback';

export {
  uploadRegistration,
  getRegistration,
  createRegistrationJSON,
} from './lib/agentRegistration';

export {
  type AgentRegistrationInfo,
} from './models/agentRegistrationInfo';


export {
  getAgentAccountByAgentName,
  extractAgentAccountFromDiscovery,
  getCounterfactualAAAddressByAgentName,
  type AgentAccountResolution,
} from './lib/accounts';

export {
  getAdminApp,
  getAdminAddress,
  isAdminAppInitialized,
  resetAdminApp,
  hasAdminPrivateKey,
} from './userApps/adminApp';

export {
  getClientApp,
  getClientAddress,
  isClientAppInitialized,
  resetClientApp,
} from './userApps/clientApp';

export {
  getProviderApp,
  getProviderAgentId,
  isProviderAppInitialized,
  resetProviderApp,
} from './userApps/providerApp';

export {
  getDiscoveryClient,
  isDiscoveryClientInitialized,
  resetDiscoveryClient,
} from './singletons/discoveryClient';

// API helpers for server routes (discovery/search)
export {
  discoverAgents,
  type DiscoverRequest,
  type DiscoverResponse,
} from './lib/discover';
export type { AgentInfo } from './models/agentInfo';
export type {
  AgentDetail,
  AgentIdentifier,
} from './models/agentDetail';
export {
  buildAgentDetail,
} from './lib/agent';
export {
  getIdentityClient,
  isIdentityClientInitialized,
  resetIdentityClient,
} from './singletons/identityClient';

export {
  getAccountOwner,
  getAccountOwnerByDidEthr,
  parseEthrDid,
  type ParsedEthrDid,
} from './lib/accounts';

export {
  getENSClient,
  isENSClientInitialized,
  resetENSClient,
  isENSAvailable,
  isENSNameAvailable,
  addAgentNameToL1Org,
  addAgentNameToL2Org,
  prepareL1AgentNameInfoCalls,
  prepareL2AgentNameInfoCalls,
  
} from './singletons/ensClient';

export type {
  AddAgentToOrgL1Params,
  AddAgentToOrgL1Result,
  AddAgentToOrgL2Params,
  AddAgentToOrgL2Result,
} from './singletons/ensClient';

export {
  getReputationClient,
  isReputationClientInitialized,
  resetReputationClient,
} from './singletons/reputationClient';

export {
  getChainEnvVar,
  getChainEnvVarDetails,
  getChainEnvVarNames,
  requireChainEnvVar,
  getChainById,
  getSupportedChainIds,
  isChainSupported,
  getChainConfig,
  getChainRpcUrl,
  getChainBundlerUrl,
  isPrivateKeyMode,
  getEnsOrgName,
  getEnsOrgAddress,
  getEnsPrivateKey,
  getWeb3AuthClientId,
  getWeb3AuthNetwork,
  getChainDisplayMetadata,
  getWeb3AuthChainSettings,
  getChainIdHex,
  DEFAULT_CHAIN_ID,
  sepolia,
  baseSepolia,
  optimismSepolia,
  type SupportedChainId,
} from './lib/chainConfig';

// Export IPFS storage (server-backed implementation)
export {
  createIPFSStorage,
  getIPFSStorage,
  isIPFSStorageInitialized,
  resetIPFSStorage,
  type IPFSStorage,
  type IPFSConfig,
  type UploadResult,
} from './lib/ipfs';

export {
  addToL1OrgPK,
  setL1NameInfoPK,
  type AddToL1OrgPKParams,
  type SetL1NameInfoPKParams,
  type ExecuteEnsTxResult,
} from './lib/names';

// Session package utilities (Node.js fs access)
export type { SessionPackage, DelegationSetup } from './lib/sessionPackage';
export {
  loadSessionPackage,
  validateSessionPackage,
  buildDelegationSetup,
} from './lib/sessionPackage';



export type {
  AgentProvider,
  A2ARequest,
  A2AResponse,
  ProviderEndpoint,
} from './lib/a2aProtocolProvider';



export type {
  Challenge,
  ChallengeRequest,
  SignedChallenge,
  VerificationRequest,
  VerificationResult,
} from './lib/verification';

// AA utilities that rely on server-side contexts
export { buildAgentAccountFromSession } from './lib/sessionPackage';
