/**
 * Association Client Singleton
 *
 * Manages a singleton instance of AssociationsStoreClient
 * Initialized from environment variables and domain AccountProvider
 */

import { AIAgentAssociationClient } from '@agentic-trust/8004-ext-sdk';
import type { AccountProvider } from '@agentic-trust/8004-sdk';
import { getChainEnvVar, requireChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';
import { DomainClient } from './domainClient';
import {
  resolveDomainUserApps,
  resolveValidationAccountProvider, // Reuse validation account provider pattern
  type DomainUserApps,
} from './domainAccountProviders';
// Associations proxy address - defaults from env or hardcoded
function getAssociationsProxyAddress(): string {
  const addr =
    process.env.ASSOCIATIONS_STORE_PROXY ||
    process.env.ASSOCIATIONS_PROXY_ADDRESS ||
    '0xaF7428906D31918dDA2986D1405E2Ded06561E59'; // Default Sepolia deployment
  
  if (!addr.startsWith('0x') || addr.length !== 42) {
    throw new Error(`Invalid ASSOCIATIONS_STORE_PROXY: ${addr}`);
  }
  
  return addr;
}

interface AssociationInitArg {
  userApps?: DomainUserApps;
}

class AssociationDomainClient extends DomainClient<AIAgentAssociationClient, number> {
  constructor() {
    super('association');
  }

  protected async buildClient(
    targetChainId: number,
    initArg?: unknown,
  ): Promise<AIAgentAssociationClient> {
    // Get associations proxy address (defaults to Sepolia deployment)
    const associationsProxyAddress = getAssociationsProxyAddress();
    const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);

    // Create AccountProvider for associations (similar to validation)
    const init = (initArg || {}) as AssociationInitArg;
    const userApps = init.userApps ?? (await resolveDomainUserApps());
    const accountProvider: AccountProvider = await resolveValidationAccountProvider(
      targetChainId,
      rpcUrl,
      userApps,
    );

    const associationClient = await AIAgentAssociationClient.create(
      accountProvider as AccountProvider,
      associationsProxyAddress as `0x${string}`,
    );

    return associationClient;
  }
}

const associationDomainClient = new AssociationDomainClient();

export async function getAssociationsClient(
  chainId?: number,
): Promise<AIAgentAssociationClient> {
  const targetChainId: number = chainId || DEFAULT_CHAIN_ID;
  return associationDomainClient.get(targetChainId);
}

export function isAssociationsClientInitialized(chainId?: number): boolean {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  return associationDomainClient.isInitialized(targetChainId);
}

export function resetAssociationsClient(chainId?: number): void {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  associationDomainClient.reset(targetChainId);
}
