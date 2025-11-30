import {
  DEFAULT_CHAIN_ID,
  processValidationRequestsWithSessionPackage,
  type SessionPackage,
  type ValidationResult,
} from '@agentic-trust/core/server';

export async function processValidationRequests(
  sessionPackage: SessionPackage,
  chainId: number = DEFAULT_CHAIN_ID,
  agentIdFilter?: string,
  requestHashFilter?: string,
): Promise<ValidationResult[]> {
  console.log(`[Provider Validation] Delegating validation processing to core (chainId=${chainId})`);
  return processValidationRequestsWithSessionPackage({
    sessionPackage,
    chainId,
    agentIdFilter,
    requestHashFilter,
  });
}

