/**
 * Client-side wallet signing utilities (client-only entry point)
 * 
 * This is a client-only export that can be safely imported in browser code
 */

export {
  signAndSendTransaction,
  extractAgentIdFromReceipt,
  refreshAgentInIndexer,
  isWalletProviderAvailable,
  getWalletAddress,
  createAgentWithWalletForEOA,
  createAgentWithWalletForAA,
  updateAgentRegistrationWithWalletForAA,
  getCounterfactualAccountClientByAgentName,
  getDeployedAccountClientByAgentName,
  getCounterfactualAAAddressByAgentName,
} from './walletSigning';

export type {
  PreparedTransaction,
  TransactionResult,
  SignTransactionOptions,
  CreateAgentWithWalletOptions,
  CreateAgentResult,
  UpdateAgentRegistrationWithWalletOptions,
} from './walletSigning';

