/**
 * @agentic-trust/core
 *
 * Core SDK for agentic trust systems
 */
export { AIAgentENSClient, AIAgentL2ENSDurenClient, AIAgentL2ENSNamespaceClient, AIAgentIdentityClient, AIAgentReputationClient, OrgIdentityClient, type GiveFeedbackParams, } from '@erc8004/agentic-trust-sdk';
export { ViemAccountProvider, type AccountProvider, type ChainConfig, type ReadClient, type Signer, type TxSender, type TxRequest, type GasPolicy, type TxSendResult, type PreparedCall, } from '@erc8004/sdk';
export { ViemAdapter } from '@erc8004/sdk';
export { sendSponsoredUserOperation, waitForUserOperationReceipt, deploySmartAccountIfNeeded, isSmartContract, } from './client/bundlerUtils';
export type { AgentCard, AgentSkill, AgentCapabilities, MessageRequest, MessageResponse, } from './server/lib/agent';
export type { AgentProvider, A2ARequest, A2AResponse, ProviderEndpoint, } from './server/lib/a2aProtocolProvider';
export type { VeramoAgent, AuthChallenge, ChallengeVerificationResult, } from './server/lib/veramo';
export type { Challenge, ChallengeRequest, SignedChallenge, VerificationRequest, VerificationResult, } from './server/lib/verification';
export type { ApiClientConfig } from './server/lib/types';
export { createIPFSStorage, getIPFSStorage, isIPFSStorageInitialized, resetIPFSStorage, type IPFSStorage, type IPFSConfig, type UploadResult, } from './storage/ipfs';
export { signAndSendTransaction, extractAgentIdFromReceipt, refreshAgentInIndexer, isWalletProviderAvailable, getWalletAddress, } from './client/walletSigning';
export type { PreparedTransaction, TransactionResult, SignTransactionOptions, } from './client/walletSigning';
export { getDeployedAccountClientByAgentName, getCounterfactualAccountClientByAgentName, } from './client/aaClient';
//# sourceMappingURL=index.d.ts.map