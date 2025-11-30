/**
 * ENS Validation Service for Provider App
 * 
 * Processes ENS validation requests by:
 * 1. Reading validation requests for the validator address
 * 2. Checking if agent ENS name exists and is owned by agent account
 * 3. Submitting validation responses with score 100 for valid agents
 * 
 * Uses AgenticTrustClient and validatorApp for all operations.
 */

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
  type SessionPackage,
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
  sessionPackage: SessionPackage,
  chainId: number = DEFAULT_CHAIN_ID,
  agentIdFilter?: string,
  requestHashFilter?: string,
): Promise<ValidationResult[]> {
  console.log(`[Provider Validation] ========================================`);
  console.log(`[Provider Validation] processValidationRequests() called`);
  console.log(`[Provider Validation] Chain ID parameter: ${chainId}`);
  if (agentIdFilter) {
    console.log(`[Provider Validation] Agent filter: ${agentIdFilter}`);
  }
  if (requestHashFilter) {
    console.log(`[Provider Validation] Request hash filter: ${requestHashFilter}`);
  }
  console.log(`[Provider Validation] ========================================`);
  
  const results: ValidationResult[] = [];

  // Note: We're using sessionPackage private key instead of AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY
  // The validatorApp is optional - we use validatorAccountClient from createValidatorAccountAbstraction for signing
  console.log(`[Provider Validation] Getting validator app for chain ${chainId} (optional, for validation client)...`);
  const validatorApp = await getValidatorApp(chainId);
  if (validatorApp) {
    console.log(`[Provider Validation] ✓ Validator app available: ${validatorApp.address}`);
  } else {
    console.log(`[Provider Validation] ⚠️  Validator app not available (using sessionPackage private key instead)`);
  }

  // Get validator private key from sessionPackage (same as feedbackAuth uses)
  console.log(`[Provider Validation] Getting validator private key from sessionPackage...`);
  const validatorPrivateKey = sessionPackage.sessionKey.privateKey;
  if (!validatorPrivateKey) {
    console.error(`[Provider Validation] ❌ ERROR: sessionPackage.sessionKey.privateKey not found`);
    throw new Error('sessionPackage.sessionKey.privateKey is required for validator operations');
  }
  console.log(`[Provider Validation] ✓ Validator private key found from sessionPackage (length: ${validatorPrivateKey.length})`);

  console.log(`[Provider Validation] Creating validator account abstraction...`);
  const { address: validatorAddress, accountClient: validatorAccountClient } = await createValidatorAccountAbstraction(
    'validator-ens',
    validatorPrivateKey,
    chainId,
  );
  console.log(`[Provider Validation] ✓ Validator AA address: ${validatorAddress}`);

  console.log(`[Provider Validation] ========================================`);
  console.log(`[Provider Validation] Starting validation processing`);
  console.log(`[Provider Validation] Chain ID: ${chainId}`);
  console.log(`[Provider Validation] Validator AA Address: ${validatorAddress}`);
  console.log(`[Provider Validation] Validator App Address (signing): ${validatorApp?.address || 'N/A (using sessionPackage)'}`);
  console.log(`[Provider Validation] ========================================`);

  // Get validation client (will use validatorApp's account provider automatically)
  console.log(`[Provider Validation] Initializing validation client...`);
  let validationClient;
  try {
    validationClient = await getValidationRegistryClient(chainId);
    console.log(`[Provider Validation] ✓ Validation client initialized successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Provider Validation] ❌ ERROR: Failed to initialize validation client: ${errorMessage}`);
    throw error;
  }

  // Get all validation requests for this validator
  console.log(`[Provider Validation] Fetching validation requests for validator ${validatorAddress}...`);
  let requestHashes: string[] = [];
  try {
    requestHashes = await validationClient.getValidatorRequests(validatorAddress);
    console.log(`[Provider Validation] ✓ Found ${requestHashes.length} total validation request(s)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Provider Validation] ❌ ERROR: Failed to fetch validation requests: ${errorMessage}`);
    throw error;
  }
  
  if (requestHashes.length === 0) {
    console.log(`[Provider Validation] No validation requests to process`);
    return results;
  }

  // Filter by requestHash if provided
  if (requestHashFilter) {
    const filtered = requestHashes.filter(hash => hash.toLowerCase() === requestHashFilter.toLowerCase());
    if (filtered.length === 0) {
      console.log(`[Provider Validation] No validation requests match the provided requestHash: ${requestHashFilter}`);
      return results;
    }
    requestHashes = filtered;
    console.log(`[Provider Validation] Filtered to ${requestHashes.length} request(s) matching requestHash: ${requestHashFilter}`);
  }

  // Process each request
  let processedCount = 0;
  let skippedCount = 0;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < requestHashes.length; i++) {
    const requestHash = requestHashes[i];
    processedCount++;
    
    console.log(`[Provider Validation] ----------------------------------------`);
    console.log(`[Provider Validation] Processing request ${processedCount}/${requestHashes.length}`);
    console.log(`[Provider Validation] Request Hash: ${requestHash}`);
    
    try {
      // Get validation status
      console.log(`[Provider Validation] Fetching validation status...`);
      const status: ValidationStatus = await validationClient.getValidationStatus(requestHash);
      console.log(`[Provider Validation] Status: agentId=${status.agentId}, response=${status.response}, validator=${status.validatorAddress}`);

      // Skip if already processed (response !== 0 means it's been processed)
      if (status.response !== 0) {
        skippedCount++;
        console.log(`[Provider Validation] ⏭️  SKIPPED: Request already processed (response: ${status.response})`);
        continue;
      }

      // Skip if validator address doesn't match (shouldn't happen, but check anyway)
      if (status.validatorAddress.toLowerCase() !== validatorAddress.toLowerCase()) {
        skippedCount++;
        console.log(`[Provider Validation] ⏭️  SKIPPED: Validator address mismatch (expected: ${validatorAddress}, got: ${status.validatorAddress})`);
        continue;
      }

      const agentId = status.agentId.toString();
      if (agentIdFilter && agentId !== agentIdFilter) {
        skippedCount++;
        console.log(
          `[Provider Validation] ⏭️  SKIPPED: Agent mismatch (request agentId=${agentId}, filter=${agentIdFilter})`,
        );
        continue;
      }
      console.log(`[Provider Validation] ✓ Processing validation for agent ${agentId}`);

      // Get agent information using core library
      console.log(`[Provider Validation] Fetching agent information...`);
      const client = await getAgenticTrustClient();
      const agent = await client.agents.getAgent(agentId, chainId);

      if (!agent) {
        errorCount++;
        const error = `Agent ${agentId} not found`;
        console.error(`[Provider Validation] ❌ ERROR: ${error}`);
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
        console.error(`[Provider Validation] ❌ ERROR: ${error}`);
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
        console.error(`[Provider Validation] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }

      console.log(`[Provider Validation] Agent Info: name="${agentName}", account="${agentAccount}"`);

      // Get ENS client
      console.log(`[Provider Validation] Initializing ENS client...`);
      const ensClient = await getENSClient(chainId);
      if (!ensClient) {
        errorCount++;
        const error = `ENS client not available for chain ${chainId}`;
        console.error(`[Provider Validation] ❌ ERROR: ${error}`);
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
      console.log(`[Provider Validation] Validating ENS name "${agentName}"...`);
      console.log(`[Provider Validation] Agent account address from agent info: ${agentAccount}`);
      
      // Get account address from ENS name (addr text record)
      console.log(`[Provider Validation] Resolving ENS name "${agentName}" to account address (addr text record)...`);
      const ensAccount = await ensClient.getAgentAccountByName(agentName);
      console.log(`[Provider Validation] ENS name "${agentName}" resolves to address: ${ensAccount || 'null'}`);
      console.log(`[Provider Validation] Comparing addresses:`);
      console.log(`[Provider Validation]   - Agent account: ${agentAccount}`);
      console.log(`[Provider Validation]   - ENS account (addr):  ${ensAccount || 'null'}`);
      if (!ensAccount) {
        errorCount++;
        const error = `ENS name "${agentName}" does not resolve to an account address`;
        console.error(`[Provider Validation] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }
      console.log(`[Provider Validation] ✓ ENS name resolves to: ${ensAccount}`);

      // Verify ENS account matches agent account
      const addressesMatch = ensAccount.toLowerCase() === agentAccount.toLowerCase();
      console.log(`[Provider Validation] Address comparison: ${addressesMatch ? 'MATCH ✓' : 'MISMATCH ✗'}`);
      if (!addressesMatch) {
        errorCount++;
        const error = `ENS name "${agentName}" resolves to ${ensAccount}, but agent account is ${agentAccount}`;
        console.error(`[Provider Validation] ❌ ERROR: ${error}`);
        results.push({
          requestHash,
          agentId,
          chainId,
          success: false,
          error,
        });
        continue;
      }
      console.log(`[Provider Validation] ✓ Account ownership verified: ENS "${agentName}" resolves to ${ensAccount}, which matches agent account ${agentAccount}`);

      // Prepare validation response transaction
      console.log(`[Provider Validation] Preparing validation response transaction (score: 100)...`);
      const validationClientTyped = validationClient as any; // Type assertion to access prepareValidationResponseTx
      const txRequest = await validationClientTyped.prepareValidationResponseTx({
        requestHash,
        response: 100, // Score 100 for valid agents
        tag: 'ens-validation',
      });
      console.log(`[Provider Validation] ✓ Transaction prepared: to=${txRequest.to}, data length=${txRequest.data?.length || 0}`);

      // Get bundler URL and chain
      // Debug: Check if env var is available before calling getChainBundlerUrl
      const bundlerEnvVar = chainId === 11155111 ? 'AGENTIC_TRUST_BUNDLER_URL_SEPOLIA' : `AGENTIC_TRUST_BUNDLER_URL_${chainId}`;
      const bundlerEnvValue = process.env[bundlerEnvVar];
      console.log(`[Provider Validation] Checking bundler URL: ${bundlerEnvVar}=${bundlerEnvValue ? `<set (length: ${bundlerEnvValue.length})>` : '<missing>'}`);
      
      const bundlerUrl = getChainBundlerUrl(chainId);
      if (!bundlerUrl) {
        throw new Error(`Bundler URL not configured for chain ${chainId}. Set ${bundlerEnvVar} environment variable.`);
      }
      const chain = getChainById(chainId) as Chain;
      console.log(`[Provider Validation] Bundler URL: ${bundlerUrl}`);

      // Send validation response via bundler using validator account abstraction
      console.log(`[Provider Validation] Sending validation response via bundler...`);
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
      console.log(`[Provider Validation] ✓ UserOperation sent: ${userOpHash}`);

      // Wait for receipt
      console.log(`[Provider Validation] Waiting for UserOperation receipt...`);
      const receipt = await waitForUserOperationReceipt({
        bundlerUrl,
        chain: chain as any,
        hash: userOpHash,
      });
      const txHash = receipt?.transactionHash || receipt?.receipt?.transactionHash || userOpHash;
      console.log(`[Provider Validation] ✓ Receipt received: ${txHash}`);

      successCount++;
      console.log(`[Provider Validation] ✅ SUCCESS: Validation response submitted`);
      console.log(`[Provider Validation] Transaction Hash: ${txHash}`);

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
      console.error(`[Provider Validation] ❌ ERROR: Exception during processing`);
      console.error(`[Provider Validation] Error: ${errorMessage}`);
      if (error instanceof Error && error.stack) {
        console.error(`[Provider Validation] Stack: ${error.stack}`);
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
  console.log(`[Provider Validation] ========================================`);
  console.log(`[Provider Validation] Processing Complete`);
  console.log(`[Provider Validation] Total Requests: ${requestHashes.length}`);
  console.log(`[Provider Validation] Processed: ${processedCount}`);
  console.log(`[Provider Validation] Skipped: ${skippedCount}`);
  console.log(`[Provider Validation] Successful: ${successCount}`);
  console.log(`[Provider Validation] Errors: ${errorCount}`);
  console.log(`[Provider Validation] ========================================`);

  return results;
}

