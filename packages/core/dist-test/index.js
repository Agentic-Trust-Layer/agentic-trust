/**
 * @agentic-trust/core
 *
 * Core SDK for agentic trust systems
 */
// ERC-8004 Agentic Trust SDK exports
// Re-export all ERC-8004 functionality for convenience
export { AIAgentENSClient, AIAgentL2ENSDurenClient, AIAgentL2ENSNamespaceClient, AIAgentIdentityClient, AIAgentReputationClient, OrgIdentityClient, } from '@erc8004/agentic-trust-sdk';
// Export AccountProvider types from erc8004-sdk for convenience
export { ViemAccountProvider, } from '@erc8004/sdk';
// Legacy export for backward compatibility (deprecated - use ViemAccountProvider instead)
export { ViemAdapter } from '@erc8004/sdk';
// Session package utilities are server-only and should be imported from '@agentic-trust/core/server'
// They are NOT exported here to prevent browser bundling issues (uses Node.js 'fs' module)
// Export bundler utilities
export { sendSponsoredUserOperation, waitForUserOperationReceipt, deploySmartAccountIfNeeded, isSmartContract, } from './client/bundlerUtils';
// Export IPFS storage
export { createIPFSStorage, getIPFSStorage, isIPFSStorageInitialized, resetIPFSStorage, } from './storage/ipfs';
// Note: Server-only functionality is exported from '@agentic-trust/core/server'
// Export client-side wallet signing utilities
export { signAndSendTransaction, extractAgentIdFromReceipt, refreshAgentInIndexer, isWalletProviderAvailable, getWalletAddress, } from './client/walletSigning';
export { getDeployedAccountClientByAgentName, getCounterfactualAccountClientByAgentName, } from './client/aaClient';
//# sourceMappingURL=index.js.map