export type AgentOperationKind = 'create' | 'update';
export type AgentOperationMode = 'aa' | 'eoa';

export interface AgentOperationCall {
  to: string;
  data: string;
  value: string;
}

export interface AgentPreparedTransactionPayload {
  to: string;
  data: string;
  value: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
  chainId: number;
}

export interface AgentOperationPlan {
  success: true;
  operation: AgentOperationKind;
  mode: AgentOperationMode;
  chainId: number;
  cid?: string;
  identityRegistry?: string;
  tokenUri?: string;
  bundlerUrl?: string;
  calls: AgentOperationCall[];
  transaction?: AgentPreparedTransactionPayload | null;
  agentId?: string;
  txHash?: string;
}

export interface DirectCreateAgentPayload {
  mode: AgentOperationMode;
  agentName: string;
  agentAccount: string;
  description?: string;
  image?: string;
  agentUrl?: string;
  supportedTrust?: string[];
  endpoints?: Array<{
    name: string;
    endpoint: string;
    version?: string;
    capabilities?: Record<string, any>;
  }>;
  chainId?: number;
  ensOptions?: Record<string, unknown>;
}

export interface CreateAgentPayload {
  mode: AgentOperationMode;
  agentName: string;
  agentAccount: string;
  account?: string;
  description?: string;
  image?: string;
  agentUrl?: string;
  supportedTrust?: string[];
  endpoints?: Array<{
    name: string;
    endpoint: string;
    version?: string;
    capabilities?: Record<string, any>;
  }>;
  chainId?: number;
}

export interface UpdateAgentRegistrationPayload {
  did8004: string;
  registration: unknown;
  mode?: AgentOperationMode;
}

export interface RequestFeedbackAuthPayload {
  clientAddress: string;
  agentId: string;
  chainId?: number;
  indexLimit?: number;
  expirySeconds?: number;
}

export interface RequestFeedbackAuthResult {
  feedbackAuthId: string;
  agentId: string;
  chainId: number;
}

