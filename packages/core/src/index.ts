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

// Session package utilities are server-only and should be imported from '@agentic-trust/core/server'
// They are NOT exported here to prevent browser bundling issues (uses Node.js 'fs' module)

// Export bundler utilities
export {
  sendSponsoredUserOperation,
  waitForUserOperationReceipt,
  deploySmartAccountIfNeeded,
  isSmartContract,
} from './client/bundlerUtils';

// Agent/type definitions (type-only exports for convenience)
export type {
  AgentCard,
  AgentSkill,
  AgentCapabilities,
  MessageRequest,
  MessageResponse,
} from './server/lib/agent';

export type {
  AgentProvider,
  A2ARequest,
  A2AResponse,
  ProviderEndpoint,
} from './server/lib/a2aProtocolProvider';

export type {
  VeramoAgent,
  AuthChallenge,
  ChallengeVerificationResult,
} from './server/lib/veramo';

export type {
  Challenge,
  ChallengeRequest,
  SignedChallenge,
  VerificationRequest,
  VerificationResult,
} from './server/lib/verification';

export type { ApiClientConfig } from './server/lib/types';

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

// Note: Server-only functionality is exported from '@agentic-trust/core/server'

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
