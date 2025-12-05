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
  createAgentWithWallet,
  updateAgentRegistrationWithWallet,
  giveFeedbackWithWallet,
  requestNameValidationWithWallet,
  requestAccountValidationWithWallet,
  requestAppValidationWithWallet,
  requestAIDValidationWithWallet,
  getCounterfactualAccountClientByAgentName,
  getDeployedAccountClientByAgentName,
  getCounterfactualAAAddressByAgentName,
} from './walletSigning';
export {
  createAgentDirect,
} from '../api/agents/directClient';

export type {
  PreparedTransaction,
  TransactionResult,
  SignTransactionOptions,
  CreateAgentWithWalletOptions,
  CreateAgentResult,
  UpdateAgentRegistrationWithWalletOptions,
  GiveFeedbackWithWalletOptions,
  RequestValidationWithWalletOptions,
} from './walletSigning';
export type {
  CreateAgentDirectClientInput,
  CreateAgentDirectClientResult,
} from '../api/agents/directClient';

