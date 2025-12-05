/**
 * AID Validation Service
 * 
 * Processes AID (Agent Identity & Discovery) validation requests by:
 * 1. Reading validation requests for the validator address
 * 2. Extracting A2A and MCP endpoints from agent registration data
 * 3. Extracting domain names from endpoint URLs
 * 4. Validating domains have proper AID records using @agentcommunity/aid-engine
 * 5. Submitting validation responses with score 100 for valid agents
 * 
 * Uses AgenticTrustClient, validatorApp, and @agentcommunity/aid-engine for all operations.
 * 
 * AID Documentation: https://docs.agentcommunity.org/aid
 * AID Package: @agentcommunity/aid
 * AID Repository: https://github.com/agentcommunity/agent-interface-discovery
 */

// Load environment variables from .env file (if not already loaded)
// This ensures env vars are available even if this module is imported directly
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of the current file (src/validator.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from the validator app root directory (one level up from src/)
const envPath = resolve(__dirname, '..', '.env');
console.log(`[Validator] Loading .env from: ${envPath}`);
const result = config({ path: envPath });

if (result.error) {
  console.warn(`[Validator] Warning: Could not load .env file: ${result.error.message}`);
} else if (result.parsed) {
  const loadedVars = Object.keys(result.parsed);
  console.log(`[Validator] Loaded ${loadedVars.length} environment variables from .env`);
  // Log specific bundler URL to verify it's loaded
  const bundlerUrl = result.parsed.AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
  if (bundlerUrl) {
    console.log(`[Validator] ✓ AGENTIC_TRUST_BUNDLER_URL_SEPOLIA is set (length: ${bundlerUrl.length})`);
  } else {
    console.warn(`[Validator] ⚠️  AGENTIC_TRUST_BUNDLER_URL_SEPOLIA not found in .env file`);
    // List all AGENTIC_TRUST vars that were loaded for debugging
    const agenticTrustVars = Object.keys(result.parsed).filter(key => key.startsWith('AGENTIC_TRUST'));
    console.log(`[Validator] Loaded AGENTIC_TRUST vars: ${agenticTrustVars.join(', ')}`);
  }
}

import {
  getAgenticTrustClient,
  getValidationRegistryClient,
  getValidatorApp,
  createValidatorAccountAbstraction,
  getRegistration,
  DEFAULT_CHAIN_ID,
  type ValidationStatus,
  getChainBundlerUrl,
  getChainById,
} from '@agentic-trust/core/server';
import { sendSponsoredUserOperation, waitForUserOperationReceipt } from '@agentic-trust/core';
import { runCheck, type CheckOptions } from '@agentcommunity/aid-engine';
import type { Chain } from 'viem';

export interface ValidationResult {
  requestHash: string;
  agentId: string;
  chainId: number;
  success: boolean;
  error?: string;
  txHash?: string;
}

/**
 * Process validation requests for a validator
 */
export async function processValidationRequests(
  chainId: number = DEFAULT_CHAIN_ID,
  agentIdFilter?: string,
): Promise<ValidationResult[]> {
  console.log(`[Validator] ========================================`);
  console.log(`[Validator] processValidationRequests() called`);
  console.log(`[Validator] Chain ID parameter: ${chainId}`);
  if (agentIdFilter) {
    console.log(`[Validator] Agent filter: ${agentIdFilter}`);
  }
  console.log(`[Validator] ========================================`);
  
  const results: ValidationResult[] = [];

  // Get validator app (uses AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY)
  console.log(`[Validator] Getting validator app for chain ${chainId}...`);
  const validatorApp = await getValidatorApp(chainId);
  if (!validatorApp) {
    console.error(`[Validator] ❌ ERROR: ValidatorApp is not initialized`);
    throw new Error('ValidatorApp is not initialized. Set AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY and AGENTIC_TRUST_APP_ROLES=validator');
  }
  console.log(`[Validator] ✓ Validator app initialized: ${validatorApp.address}`);

  // Get validator address (AA address from AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY)
  // Note: This uses the AID validator private key to calculate the AA address
  // The validatorApp uses AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY for signing
  console.log(`[Validator] Getting validator private key from environment...`);
  const validatorAidPrivateKey = process.env.AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY;
  if (!validatorAidPrivateKey) {
    console.error(`[Validator] ❌ ERROR: AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY not set`);
    throw new Error('AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY environment variable is not set (needed for validator AA address)');
  }
  console.log(`[Validator] ✓ Validator private key found (length: ${validatorAidPrivateKey.length})`);

  console.log(`[Validator] Creating validator account abstraction...`);
  const { address: validatorAddress, accountClient: validatorAccountClient } = await createValidatorAccountAbstraction(
    'aid-validator',
    validatorAidPrivateKey,
    chainId,
  );
  console.log(`[Validator] ✓ Validator AA address: ${validatorAddress}`);

  console.log(`[Validator] ========================================`);
  console.log(`[Validator] Starting validation processing`);
  console.log(`[Validator] Chain ID: ${chainId}`);
    console.log(`[Validator] Validator AA Address: ${validatorAddress}`);
    console.log(`[Validator] Validator App Address (signing) aid: ${validatorApp.address}`);
  console.log(`[Validator] ========================================`);

  // Get validation client (will use validatorApp's account provider automatically)
  console.log(`[Validator] Initializing validation client...`);
  let validationClient;
  try {
    validationClient = await getValidationRegistryClient(chainId);
    console.log(`[Validator] ✓ Validation client initialized successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Validator] ❌ ERROR: Failed to initialize validation client: ${errorMessage}`);
    throw error;
  }

  // Get all validation requests for this validator
  console.log(`[Validator] Fetching validation requests for validator ${validatorAddress}...`);
  let requestHashes: string[] = [];
  try {
    requestHashes = await validationClient.getValidatorRequests(validatorAddress);
    console.log(`[Validator] ✓ Found ${requestHashes.length} total validation request(s)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Validator] ❌ ERROR: Failed to fetch validation requests: ${errorMessage}`);
    throw error;
  }
  
  if (requestHashes.length === 0) {
    console.log(`[Validator] No validation requests to process`);
    return results;
  }

  // Process each request
  let processedCount = 0;
  let skippedCount = 0;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < requestHashes.length; i++) {
    const requestHash = requestHashes[i];
    processedCount++;
    
    console.log(`[Validator] ----------------------------------------`);
    console.log(`[Validator] Processing request ${processedCount}/${requestHashes.length}`);
    console.log(`[Validator] Request Hash: ${requestHash}`);
    
    try {
      // Get validation status
      console.log(`[Validator] Fetching validation status...`);
      const status: ValidationStatus = await validationClient.getValidationStatus(requestHash);
      console.log(`[Validator] Status: agentId=${status.agentId}, response=${status.response}, validator=${status.validatorAddress}`);

      // Skip if already processed (response !== 0 means it's been processed)
      if (status.response !== 0) {
        skippedCount++;
        console.log(`[Validator] ⏭️  SKIPPED: Request already processed (response: ${status.response})`);
        continue;
      }

      // Skip if validator address doesn't match (shouldn't happen, but check anyway)
      if (status.validatorAddress.toLowerCase() !== validatorAddress.toLowerCase()) {
        skippedCount++;
        console.log(`[Validator] ⏭️  SKIPPED: Validator address mismatch (expected: ${validatorAddress}, got: ${status.validatorAddress})`);
        continue;
      }

      const agentId = status.agentId.toString();
      if (agentIdFilter && agentId !== agentIdFilter) {
        skippedCount++;
        console.log(
          `[Validator] ⏭️  SKIPPED: Agent mismatch (request agentId=${agentId}, filter=${agentIdFilter})`,
        );
        continue;
      }
      console.log(`[Validator] ✓ Processing validation for agent ${agentId}`);

      // Get agent information using core library
      console.log(`[Validator] Fetching agent information...`);
      const client = await getAgenticTrustClient();
      const agent = await client.agents.getAgent(agentId, chainId);

      if (!agent) {
        errorCount++;
        const error = `Agent ${agentId} not found`;
        console.error(`[Validator] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }

      // Get agent name from agent info
      const agentName = agent.agentName;
      if (!agentName) {
        errorCount++;
        const error = `Agent ${agentId} has no agentName`;
        console.error(`[Validator] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }

      // Get agent account address
      const agentAccount = agent.agentAccount;
      if (!agentAccount) {
        errorCount++;
        const error = `Agent ${agentId} has no agentAccount`;
        console.error(`[Validator] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }

      console.log(`[Validator] Agent Info: name="${agentName}", account="${agentAccount}"`);

      // Extract A2A and MCP endpoints from agent data
      console.log(`[Validator] Extracting agent endpoints...`);
      console.log(`[Validator] ************ Agent: `, agent.data.tokenUri);
      
      // Get tokenUri to fetch registration
      const tokenUri = agent.data.tokenUri;
      if (!tokenUri) {
        errorCount++;
        const error = `Agent ${agentId} has no tokenUri`;
        console.error(`[Validator] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }

      // Get registration from tokenUri
      let registration;
      try {
        registration = await getRegistration(tokenUri);
        console.log(`[Validator] ✓ Registration loaded from tokenUri`);
      } catch (error) {
        errorCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorText = `Failed to load registration from tokenUri: ${errorMessage}`;
        console.error(`[Validator] ❌ ERROR: ${errorText}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error: errorText,
        });
        continue;
      }

      // Extract endpoints from registration
      const endpoints = registration.endpoints || [];
      console.log(`[Validator] Found ${endpoints.length} endpoint(s) in registration`);

      // Also check agent.a2aEndpoint as fallback
      const a2aEndpoint = agent.a2aEndpoint || endpoints.find((ep: any) => ep.name === 'A2A' || ep.name === 'a2a')?.endpoint;
      const mcpEndpoint = endpoints.find((ep: any) => ep.name === 'MCP' || ep.name === 'mcp')?.endpoint;

      if (!a2aEndpoint && !mcpEndpoint) {
        errorCount++;
        const error = `Agent ${agentId} has no A2A or MCP endpoints in registration`;
        console.error(`[Validator] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }

      const endpointsToCheck: string[] = [];
      if (a2aEndpoint) {
        endpointsToCheck.push(a2aEndpoint);
        console.log(`[Validator] A2A endpoint: ${a2aEndpoint}`);
      }
      if (mcpEndpoint) {
        endpointsToCheck.push(mcpEndpoint);
        console.log(`[Validator] MCP endpoint: ${mcpEndpoint}`);
      }

      // Extract domains from endpoints
      const domainsToValidate = new Set<string>();
      for (const endpoint of endpointsToCheck) {
        try {
          const url = new URL(endpoint);
          const hostname = url.hostname;
          
          // Use the full hostname (including subdomain) for AID validation
          // For subdomains like local-church.8004-agent.io, validate local-church.8004-agent.io
          // For base domains like 8004-agent.io, validate 8004-agent.io
          // AID records are at _agent.<full-domain>, so we need the full domain including subdomain
          const parts = hostname.split('.');
          if (parts.length >= 2) {
            // If it's a subdomain (3+ parts), use the full hostname
            // If it's a base domain (2 parts), use the hostname as-is
            if (parts.length >= 3) {
              // Subdomain: use full hostname (e.g., local-church.8004-agent.io)
              domainsToValidate.add(hostname);
              console.log(`[Validator] Extracted subdomain "${hostname}" from endpoint "${endpoint}"`);
            } else {
              // Base domain: use hostname (e.g., 8004-agent.io)
              domainsToValidate.add(hostname);
              console.log(`[Validator] Extracted domain "${hostname}" from endpoint "${endpoint}"`);
            }
          } else {
            domainsToValidate.add(hostname);
            console.log(`[Validator] Using hostname "${hostname}" as domain from endpoint "${endpoint}"`);
          }
        } catch (error) {
          console.warn(`[Validator] ⚠️  Failed to parse endpoint URL: ${endpoint}`, error);
        }
      }

      if (domainsToValidate.size === 0) {
        errorCount++;
        const error = `No valid domains extracted from endpoints`;
        console.error(`[Validator] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }

      // Validate each domain using AID
      console.log(`[Validator] Validating ${domainsToValidate.size} domain(s) using AID...`);
      const validationErrors: string[] = [];

      for (const domain of domainsToValidate) {
        console.log(`[Validator] Checking AID record for domain: ${domain}`);
        try {
          const checkOptions: CheckOptions = {
            timeoutMs: 5000,
            allowFallback: true,
            wellKnownTimeoutMs: 2000,
            showDetails: false,
            probeProtoSubdomain: false,
            probeProtoEvenIfBase: false,
            dumpWellKnownPath: null,
            checkDowngrade: false,
            previousCacheEntry: undefined,
          };

          const report = await runCheck(domain, checkOptions);
          
          // Check if validation passed (exitCode 0 means success)
          if (report.exitCode !== 0) {
            const errorMsg = (report as any).error 
              ? `AID validation failed for ${domain}: ${(report as any).error.message || (report as any).error} (code: ${(report as any).error.code || report.exitCode})`
              : `AID validation failed for ${domain}: Exit code ${report.exitCode}`;
            validationErrors.push(errorMsg);
            console.error(`[Validator] ❌ ${errorMsg}`);
          } else {
            console.log(`[Validator] ✓ AID validation passed for ${domain}`);
            const record = (report as any).record;
            if (record) {
              console.log(`[Validator]   URI: ${record.uri || 'N/A'}`);
              if (record.pka) {
                console.log(`[Validator]   PKA: ${record.pka.keyId || record.pka || 'N/A'}`);
              }
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorMsg = `AID validation error for ${domain}: ${errorMessage}`;
          validationErrors.push(errorMsg);
          console.error(`[Validator] ❌ ${errorMsg}`);
        }
      }

      if (validationErrors.length > 0) {
        errorCount++;
        const error = validationErrors.join('; ');
        console.error(`[Validator] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }

      console.log(`[Validator] ✓ All domains validated successfully with AID`);

      // Prepare validation response transaction
      console.log(`[Validator] Preparing validation response transaction (score: 100)...`);
      const validationClientTyped = validationClient as any; // Type assertion to access prepareValidationResponseTx
      const txRequest = await validationClientTyped.prepareValidationResponseTx({
        requestHash,
        response: 100, // Score 100 for valid agents
        tag: 'aid-validation',
      });
      console.log(`[Validator] ✓ Transaction prepared: to=${txRequest.to}, data length=${txRequest.data?.length || 0}`);

      // Get bundler URL and chain
      // Debug: Check if env var is available before calling getChainBundlerUrl
      const bundlerEnvVar = chainId === 11155111 ? 'AGENTIC_TRUST_BUNDLER_URL_SEPOLIA' : `AGENTIC_TRUST_BUNDLER_URL_${chainId}`;
      const bundlerEnvValue = process.env[bundlerEnvVar];
      console.log(`[Validator] Checking bundler URL: ${bundlerEnvVar}=${bundlerEnvValue ? `<set (length: ${bundlerEnvValue.length})>` : '<missing>'}`);
      
      const bundlerUrl = getChainBundlerUrl(chainId);
      if (!bundlerUrl) {
        throw new Error(`Bundler URL not configured for chain ${chainId}. Set ${bundlerEnvVar} environment variable.`);
      }
      const chain = getChainById(chainId) as Chain;
      console.log(`[Validator] Bundler URL: ${bundlerUrl}`);

      // Send validation response via bundler using validator account abstraction
      console.log(`[Validator] Sending validation response via bundler...`);
      const userOpHash = await sendSponsoredUserOperation({
        bundlerUrl,
        chain: chain as any,
        accountClient: validatorAccountClient,
        calls: [{
          to: txRequest.to,
          data: txRequest.data,
          value: txRequest.value || 0n,
        }],
      });
      console.log(`[Validator] ✓ UserOperation sent: ${userOpHash}`);

      // Wait for receipt
      console.log(`[Validator] Waiting for UserOperation receipt...`);
      const receipt = await waitForUserOperationReceipt({
        bundlerUrl,
        chain: chain as any,
        hash: userOpHash,
      });
      const txHash = receipt?.transactionHash || receipt?.receipt?.transactionHash || userOpHash;
      console.log(`[Validator] ✓ Receipt received: ${txHash}`);

      successCount++;
      console.log(`[Validator] ✅ SUCCESS: Validation response submitted`);
      console.log(`[Validator] Transaction Hash: ${txHash}`);

      results.push({
        requestHash,
        agentId,
        chainId,
        success: true,
        txHash,
      });
    } catch (error) {
      errorCount++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Validator] ❌ ERROR: Exception during processing`);
      console.error(`[Validator] Error: ${errorMessage}`);
      if (error instanceof Error && error.stack) {
        console.error(`[Validator] Stack: ${error.stack}`);
      }
      results.push({
        requestHash,
        agentId: 'unknown',
        chainId,
        success: false,
        error: errorMessage,
      });
    }
  }

  // Summary
  console.log(`[Validator] ========================================`);
  console.log(`[Validator] Processing Complete`);
  console.log(`[Validator] Total Requests: ${requestHashes.length}`);
  console.log(`[Validator] Processed: ${processedCount}`);
  console.log(`[Validator] Skipped: ${skippedCount}`);
  console.log(`[Validator] Successful: ${successCount}`);
  console.log(`[Validator] Errors: ${errorCount}`);
  console.log(`[Validator] ========================================`);

  return results;
}

