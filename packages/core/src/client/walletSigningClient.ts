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
} from './walletSigning';

export type {
  PreparedTransaction,
  TransactionResult,
  SignTransactionOptions,
  CreateAgentWithWalletOptions,
  CreateAgentResult,
} from './walletSigning';

