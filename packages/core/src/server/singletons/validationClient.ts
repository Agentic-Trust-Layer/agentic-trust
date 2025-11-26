/**
 * Validation Client Singleton
 *
 * Manages a singleton instance of AIAgentValidationClient
 * Initialized from environment variables and domain AccountProvider
 */

import { AIAgentValidationClient } from '@agentic-trust/8004-ext-sdk';
import type { AccountProvider } from '@agentic-trust/8004-sdk';
import { getChainEnvVar, requireChainEnvVar, DEFAULT_CHAIN_ID } from '../lib/chainConfig';
import { DomainClient } from './domainClient';
import {
  resolveDomainUserApps,
  resolveValidationAccountProvider,
  type DomainUserApps,
} from './domainAccountProviders';

interface ValidationInitArg {
  userApps?: DomainUserApps;
}

class ValidationDomainClient extends DomainClient<AIAgentValidationClient, number> {
  constructor() {
    super('validation');
  }

  protected async buildClient(
    targetChainId: number,
    initArg?: unknown,
  ): Promise<AIAgentValidationClient> {
    const validationRegistry = requireChainEnvVar(
      'AGENTIC_TRUST_VALIDATION_REGISTRY',
      targetChainId,
    );
    const rpcUrl = requireChainEnvVar('AGENTIC_TRUST_RPC_URL', targetChainId);

    const init = (initArg || {}) as ValidationInitArg;
    const userApps = init.userApps ?? (await resolveDomainUserApps());
    const accountProvider: AccountProvider = await resolveValidationAccountProvider(
      targetChainId,
      rpcUrl,
      userApps,
    );

    const validationClient = await AIAgentValidationClient.create(
      accountProvider as AccountProvider,
      validationRegistry as `0x${string}`,
    );

    return validationClient;
  }
}

const validationDomainClient = new ValidationDomainClient();

export async function getValidationClient(
  chainId?: number,
): Promise<AIAgentValidationClient> {
  const targetChainId: number = chainId || DEFAULT_CHAIN_ID;
  return validationDomainClient.get(targetChainId);
}

export function isValidationClientInitialized(chainId?: number): boolean {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  return validationDomainClient.isInitialized(targetChainId);
}

export function resetValidationClient(chainId?: number): void {
  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  validationDomainClient.reset(targetChainId);
}


