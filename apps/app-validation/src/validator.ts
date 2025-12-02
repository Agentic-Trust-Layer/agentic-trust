/**
 * ENS Validation Service
 * 
 * Processes ENS validation requests by:
 * 1. Reading validation requests for the validator address
 * 2. Checking if agent ENS name exists and is owned by agent account
 * 3. Submitting validation responses with score 100 for valid agents
 * 
 * Uses AgenticTrustClient and validatorApp for all operations.
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
  getENSClient,
  DEFAULT_CHAIN_ID,
  type ValidationStatus,
  getChainBundlerUrl,
  getChainById,
} from '@agentic-trust/core/server';
import { sendSponsoredUserOperation, waitForUserOperationReceipt } from '@agentic-trust/core';
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
  // Note: This uses the ENS validator private key to calculate the AA address
  // The validatorApp uses AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY for signing
  console.log(`[Validator] Getting validator private key from environment...`);
  const validatorEnsPrivateKey = process.env.AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY;
  if (!validatorEnsPrivateKey) {
    console.error(`[Validator] ❌ ERROR: AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY not set`);
    throw new Error('AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY environment variable is not set (needed for validator AA address)');
  }
  console.log(`[Validator] ✓ Validator private key found (length: ${validatorEnsPrivateKey.length})`);

  console.log(`[Validator] Creating validator account abstraction...`);
  const { address: validatorAddress, accountClient: validatorAccountClient } = await createValidatorAccountAbstraction(
    'app-validator',
    validatorEnsPrivateKey,
    chainId,
  );
  console.log(`[Validator] ✓ Validator AA address: ${validatorAddress}`);

  console.log(`[Validator] ========================================`);
  console.log(`[Validator] Starting validation processing`);
  console.log(`[Validator] Chain ID: ${chainId}`);
  console.log(`[Validator] Validator AA Address: ${validatorAddress}`);
  console.log(`[Validator] Validator App Address (signing) ens: ${validatorApp.address}`);
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

      // Get ENS client
      console.log(`[Validator] Initializing ENS client...`);
      const ensClient = await getENSClient(chainId);
      if (!ensClient) {
        errorCount++;
        const error = `ENS client not available for chain ${chainId}`;
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

      // Validate ENS name exists and is owned by agent account
      console.log(`[Validator] Validating ENS name "${agentName}"...`);
      console.log(`[Validator] Agent account address from agent info: ${agentAccount}`);
      
      // Get account address from ENS name (addr text record)
      console.log(`[Validator] Resolving ENS name "${agentName}" to account address (addr text record)...`);
      const ensAccount = await ensClient.getAgentAccountByName(agentName);
      console.log(`[Validator] ENS name "${agentName}" resolves to address: ${ensAccount || 'null'}`);
      console.log(`[Validator] Comparing addresses:`);
      console.log(`[Validator]   - Agent account: ${agentAccount}`);
      console.log(`[Validator]   - ENS account (addr):  ${ensAccount || 'null'}`);
      if (!ensAccount) {
        errorCount++;
        const error = `ENS name "${agentName}" does not resolve to an account address`;
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
      console.log(`[Validator] ✓ ENS name resolves to: ${ensAccount}`);

      // Verify ENS account matches agent account
      const addressesMatch = ensAccount.toLowerCase() === agentAccount.toLowerCase();
      console.log(`[Validator] Address comparison: ${addressesMatch ? 'MATCH ✓' : 'MISMATCH ✗'}`);
      if (!addressesMatch) {
        errorCount++;
        const error = `ENS name "${agentName}" resolves to ${ensAccount}, but agent account is ${agentAccount}`;
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
      console.log(`[Validator] ✓ Account ownership verified: ENS "${agentName}" resolves to ${ensAccount}, which matches agent account ${agentAccount}`);

      // Prepare validation response transaction
      console.log(`[Validator] Preparing validation response transaction (score: 100)...`);
      const validationClientTyped = validationClient as any; // Type assertion to access prepareValidationResponseTx
      const txRequest = await validationClientTyped.prepareValidationResponseTx({
        requestHash,
        response: 100, // Score 100 for valid agents
        tag: 'app-validation',
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

