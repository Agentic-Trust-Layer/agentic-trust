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

export type {
  ApiClientConfig,
} from './lib/types';

export {
  fetchAgentCard,
} from './lib/agentCard';

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
  type AgentRegistrationJSON,
} from './lib/registration';

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
  type DiscoverAgent,
} from './lib/discover';
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

export {
  addToL1OrgPK,
  setL1NameInfoPK,
  type AddToL1OrgPKParams,
  type SetL1NameInfoPKParams,
  type ExecuteEnsTxResult,
} from './lib/ensActions';

// Session package utilities (Node.js fs access)
export type { SessionPackage, DelegationSetup } from './lib/sessionPackage';
export {
  loadSessionPackage,
  validateSessionPackage,
  buildDelegationSetup,
} from './lib/sessionPackage';

// AA utilities that rely on server-side contexts
export { buildAgentAccountFromSession } from './lib/sessionPackage';
