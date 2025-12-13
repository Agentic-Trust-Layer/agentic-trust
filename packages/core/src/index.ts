/**
 * @agentic-trust/core
 * 
 * Core SDK for agentic trust systems
 */

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
} from '@agentic-trust/8004-ext-sdk';

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
} from '@agentic-trust/8004-sdk';

// Export validation types from erc8004-sdk
export type {
  ValidationStatus,
} from '@agentic-trust/8004-sdk';

export {
  // Preferred Did-then-method names only
  buildDid8004,
  parseDid8004,
  resolveDid8004,
  type BuildDid8004Options,
  type ParsedDid8004,
} from './shared/did8004';

export {
  buildDidEns,
  buildDidEnsFromAgentAndOrg,
  parseDidEns,
  type ParsedDidEns,
  type BuildDidEnsOptions,
} from './shared/didEns';

export {
  buildDidEthr,
  parseDidEthr,
  type ParsedDidEthr,
  type BuildDidEthrOptions,
} from './shared/didEthr';

// Chain / Web3Auth config helpers (safe for both client and server)
export {
  DEFAULT_CHAIN_ID,
  getChainRpcUrl,
  getChainBundlerUrl,
  isPrivateKeyMode,
  getEnsOrgName,
  getWeb3AuthClientId,
  getWeb3AuthNetwork,
  getChainDisplayMetadata,
  getSupportedChainIds,
  getWeb3AuthChainSettings,
  getChainIdHex,
} from './server/lib/chainConfig';

// Legacy export for backward compatibility (deprecated - use ViemAccountProvider instead)
export { ViemAdapter } from '@agentic-trust/8004-sdk';

// Session package utilities are server-only and should be imported from '@agentic-trust/core/server'
// They are NOT exported here to prevent browser bundling issues (uses Node.js 'fs' module)

// Export bundler utilities
export {
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
  deploySmartAccountIfNeeded,
  isSmartContract,
} from './client/accountClient';

// Agent/type definitions (type-only exports for convenience)
export type {
  AgentCard,
  AgentSkill,
  AgentCapabilities,
  MessageRequest,
  MessageResponse,
} from './server/lib/agent';


export type { ApiClientConfig } from './server/lib/types';

export type { SessionPackage } from './shared/sessionPackage';

export { generateSessionPackage } from './client/sessionPackageBuilder';



// Note: Server-only functionality is exported from '@agentic-trust/core/server'

// Export client-side wallet signing utilities
export {
  signAndSendTransaction,
  extractAgentIdFromReceipt,
  refreshAgentInIndexer,
  isWalletProviderAvailable,
  getWalletAddress,
  getDeployedAccountClientByAgentName,
  getCounterfactualAccountClientByAgentName,
  getCounterfactualSmartAccountAddressByAgentName,
  getCounterfactualAAAddressByAgentName,
  createAgentWithWallet,
  updateAgentRegistrationWithWallet,
  giveFeedbackWithWallet,
  requestNameValidationWithWallet,
  requestAccountValidationWithWallet,
  requestAppValidationWithWallet,
  requestAIDValidationWithWallet,
} from './client/walletSigning';
export type {
  PreparedTransaction,
  TransactionResult,
  SignTransactionOptions,
  CreateAgentWithWalletOptions,
  CreateAgentResult,
  UpdateAgentRegistrationWithWalletOptions,
  GiveFeedbackWithWalletOptions,
  RequestValidationWithWalletOptions,
} from './client/walletSigning';

// Client-side agent API helpers (HTTP-based)
export {
  createAgent,
  updateAgentRegistration,
} from './api/agents/client';
export type {
  CreateAgentClientInput,
  CreateAgentClientResult,
  UpdateAgentRegistrationClientInput,
  UpdateAgentRegistrationClientResult,
} from './api/agents/client';

export {
  createAgentDirect,
} from './api/agents/directClient';
export type {
  CreateAgentDirectClientInput,
  CreateAgentDirectClientResult,
} from './api/agents/directClient';

// Validation request utilities (server-side)
export {
  createValidatorAccountAbstraction,
} from './server/lib/validations';


