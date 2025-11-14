/**
 * ERC8004 Agentic Trust SDK
 * 
 * A TypeScript SDK for managing AI agents with ENS integration,
 * identity management, and reputation systems on Ethereum L1 and L2.
 * 
 * Uses AccountProvider (Ports & Adapters pattern) for chain I/O.
 */

export { AIAgentENSClient } from './AIAgentENSClient';
export { AIAgentL2ENSDurenClient } from './AIAgentL2ENSDurenClient';
export { AIAgentL2ENSNamespaceClient } from './AIAgentL2ENSNamespaceClient';
export { AIAgentIdentityClient } from './AIAgentIdentityClient';
export { AIAgentReputationClient, type GiveFeedbackParams } from './AIAgentReputationClient';
export { OrgIdentityClient } from './OrgIdentityClient';
export {
  AIAgentDiscoveryClient,
  type AIAgentDiscoveryClientConfig,
  type AgentData,
  type ListAgentsResponse,
  type GetAgentResponse,
  type SearchAgentsResponse,
  type SearchAgentsAdvancedOptions,
  type RefreshAgentResponse,
} from './AIAgentDiscoveryClient';

// Re-export AccountProvider types from @agentic-trust/8004-sdk for convenience
export type {
  AccountProvider,
  ChainConfig,
  ReadClient,
  Signer,
  TxSender,
  TxRequest,
  GasPolicy,
  TxSendResult,
  PreparedCall,
} from '@agentic-trust/8004-sdk';

export {
  ViemAccountProvider,
  type ViemAccountProviderOptions,
} from '@agentic-trust/8004-sdk';

export {
  build8004Did,
  parse8004Did,
  type Parsed8004Did,
  type Build8004DidOptions,
} from './utils/erc8004Did';

export {
  buildEnsDid,
  buildEnsDidFromAgentAndOrg,
  parseEnsDid,
  type ParsedEnsDid,
  type BuildEnsDidOptions,
} from './utils/ensDid';

export {
  buildEthrDid,
  parseEthrDid,
  type ParsedEthrDid,
  type BuildEthrDidOptions,
} from './utils/ethrDid';
