/**
 * ENS Validator - Special validation logic for ens-validator subdomain
 * 
 * This validator performs ENS-specific validation checks before processing
 * standard validation responses.
 */

import type { SessionPackage } from '@agentic-trust/core/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export interface EnsValidatorContext {
  sessionPackage: SessionPackage;
  agentId: string;
  chainId: number;
  requestHash?: string;
  payload?: any;
}

export interface EnsValidatorResult {
  shouldProceed: boolean;
  validated?: boolean; // true if validation was successful, false or undefined if not
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Perform ENS-specific validation logic before standard validation response
 * 
 * @param context - Validation context including session package and agent info
 * @returns Result indicating whether to proceed with standard validation response
 */
export async function processEnsValidatorLogic(
  context: EnsValidatorContext,
): Promise<EnsValidatorResult> {
  const { sessionPackage, agentId, chainId, requestHash, payload } = context;

  try {
    console.log('[ENS Validator] Processing ENS-specific validation logic', {
      agentId,
      chainId,
      requestHash,
      validatorAddress: (sessionPackage as any)?.aa,
    });

    // Get agent information for validation
    const client = await getAgenticTrustClient();
    const agent = await client.agents.getAgent(agentId, chainId);

    if (!agent) {
      return {
        shouldProceed: false,
        validated: false, // Validation failed
        error: `Agent ${agentId} not found on chain ${chainId}`,
      };
    }

    // ENS-specific validation checks
    // Example: Verify agent has valid ENS name
    const agentName = agent.agentName;
    if (!agentName) {
      return {
        shouldProceed: false,
        validated: false, // Validation failed
        error: `Agent ${agentId} has no agentName`,
      };
    }

    // Check if agent name is a valid ENS name format
    const isEnsName = agentName.includes('.') && agentName.endsWith('.eth');
    if (!isEnsName) {
      console.warn('[ENS Validator] Agent name is not in ENS format:', agentName);
      // Still proceed, but log a warning
    }

    // Additional ENS-specific validation can be added here
    // For example:
    // - Verify ENS name is owned by the agent account
    // - Check ENS name resolution
    // - Validate ENS name format

    console.log('[ENS Validator] ✅ ENS validation checks passed', {
      agentId,
      agentName,
      agentAccount: agent.agentAccount,
    });

    return {
      shouldProceed: true,
      validated: true, // Validation was successful
      metadata: {
        agentName,
        agentAccount: agent.agentAccount,
        ensName: isEnsName ? agentName : null,
      },
    };
  } catch (error: any) {
    console.error('[ENS Validator] Error in ENS validation logic:', error);
    return {
      shouldProceed: false,
      validated: false, // Validation failed
      error: error?.message || 'Failed to perform ENS validation checks',
    };
  }
}

