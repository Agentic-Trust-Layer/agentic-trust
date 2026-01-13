/**
 * Smart App Validator - Special validation logic for smart-app-validator subdomain
 * 
 * This validator performs smart app-specific validation checks before processing
 * standard validation responses.
 */

import type { SessionPackage } from '@agentic-trust/core/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export interface SmartAppValidatorContext {
  sessionPackage: SessionPackage;
  agentId: string;
  chainId: number;
  requestHash?: string;
  payload?: any;
}

export interface SmartAppValidatorResult {
  shouldProceed: boolean;
  validated?: boolean; // true if validation was successful, false or undefined if not
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Perform smart app-specific validation logic before standard validation response
 * 
 * @param context - Validation context including session package and agent info
 * @returns Result indicating whether to proceed with standard validation response
 */
export async function processSmartAppValidatorLogic(
  context: SmartAppValidatorContext,
): Promise<SmartAppValidatorResult> {
  const { sessionPackage, agentId, chainId, requestHash, payload } = context;

  try {
    console.log('[Smart App Validator] Processing smart app-specific validation logic', {
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

    // Smart app-specific validation checks
    // Verify agent has required app information
    const agentName = agent.agentName;
    if (!agentName) {
      return {
        shouldProceed: false,
        validated: false, // Validation failed
        error: `Agent ${agentId} has no agentName`,
      };
    }

    // Verify agent has a smart account address
    const agentAccount = agent.agentAccount;
    if (!agentAccount) {
      return {
        shouldProceed: false,
        validated: false, // Validation failed
        error: `Agent ${agentId} has no agentAccount (smart account address)`,
      };
    }

    // Handle CAIP-10 format (chainId:address) or plain address
    let agentAccountPlain: string = agentAccount;
    if (typeof agentAccount === 'string' && agentAccount.includes(':')) {
      // Extract address from CAIP-10 format (e.g., "11155111:0x..." or "eip155:11155111:0x...")
      const parts = agentAccount.split(':');
      const addressPart = parts[parts.length - 1];
      if (addressPart && addressPart.startsWith('0x')) {
        agentAccountPlain = addressPart;
      }
    }

    // Check if agent account is a valid address format
    const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(agentAccountPlain);
    if (!isValidAddress) {
      return {
        shouldProceed: false,
        validated: false, // Validation failed
        error: `Agent ${agentId} has invalid agentAccount format: ${agentAccount}`,
      };
    }

    // Additional smart app-specific validation can be added here
    // For example:
    // - Verify the smart app is deployed and accessible
    // - Check smart app endpoints (A2A, MCP, etc.)
    // - Validate smart app configuration
    // - Verify smart app has required capabilities/skills

    console.log('[Smart App Validator] ✅ Smart app validation checks passed', {
      agentId,
      agentName,
      agentAccount,
    });

    return {
      shouldProceed: true,
      validated: true, // Validation was successful
      metadata: {
        agentName,
        agentAccount,
        chainId,
      },
    };
  } catch (error: any) {
    console.error('[Smart App Validator] Error in smart app validation logic:', error);
    return {
      shouldProceed: false,
      validated: false, // Validation failed
      error: error?.message || 'Failed to perform smart app validation checks',
    };
  }
}

