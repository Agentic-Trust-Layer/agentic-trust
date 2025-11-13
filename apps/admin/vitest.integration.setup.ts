/**
 * Integration Test Setup
 * 
 * This file runs before all integration tests and sets up the testing environment.
 * Integration tests make actual calls to backends (blockchain, IPFS, GraphQL).
 * 
 * Note: Web3Auth is NOT needed for integration tests because:
 * 1. Integration tests run in Node.js (server-side), not browser
 * 2. Web3Auth requires browser environment (window, localStorage, etc.)
 * 3. Current integration tests test public API endpoints (no auth required)
 * 
 * For authenticated routes, use private key mode (AGENTIC_TRUST_ADMIN_PRIVATE_KEY)
 * or session cookies instead of Web3Auth.
 */

import { vi, beforeAll, afterAll } from 'vitest';

// Check if integration tests should run
// Set INTEGRATION_TESTS=true to enable integration tests
export const INTEGRATION_TESTS_ENABLED = process.env.INTEGRATION_TESTS === 'true';

// Required environment variables for integration tests
// Note: Some variables are chain-specific (have chain suffix), others are chain-agnostic
export const REQUIRED_ENV_VARS = {
  // Chain-specific: RPC URL for Sepolia testnet
  RPC_URL: process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA,
  // Chain-specific: Identity Registry contract address on Sepolia
  IDENTITY_REGISTRY: process.env.AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA,
  // Chain-agnostic: Discovery API endpoint (works for all chains)
  DISCOVERY_URL: process.env.AGENTIC_TRUST_DISCOVERY_URL,
  // Chain-agnostic: Discovery API key (works for all chains)
  DISCOVERY_API_KEY: process.env.AGENTIC_TRUST_DISCOVERY_API_KEY,
  // Optional: Private key for authenticated routes (not required for public endpoints)
  // ADMIN_PRIVATE_KEY: process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY,
};

// Optional environment variables (not required for current integration tests)
// These are only needed if testing authenticated routes
export const OPTIONAL_ENV_VARS = {
  // Private key for server-side authentication (optional)
  ADMIN_PRIVATE_KEY: process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY,
  // Web3Auth client ID (not needed for server-side tests, only for client-side tests)
  // WEB3AUTH_CLIENT_ID: process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID,
};

// Check if all required environment variables are set
export function hasRequiredEnvVars(): boolean {
  return !!(
    REQUIRED_ENV_VARS.RPC_URL &&
    REQUIRED_ENV_VARS.DISCOVERY_URL &&
    REQUIRED_ENV_VARS.DISCOVERY_API_KEY &&
    REQUIRED_ENV_VARS.IDENTITY_REGISTRY
  );
}

// Skip integration tests if not enabled or missing env vars
export function shouldSkipIntegrationTests(): boolean {
  if (!INTEGRATION_TESTS_ENABLED) {
    console.log('⚠️  Integration tests disabled. Set INTEGRATION_TESTS=true to enable.');
    return true;
  }
  
  if (!hasRequiredEnvVars()) {
    console.log('⚠️  Missing required environment variables for integration tests.');
    console.log('');
    console.log('Required (chain-specific):');
    console.log('  - AGENTIC_TRUST_RPC_URL_SEPOLIA (RPC URL for Sepolia testnet)');
    console.log('  - AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA (Identity Registry contract address)');
    console.log('');
    console.log('Required (chain-agnostic):');
    console.log('  - AGENTIC_TRUST_DISCOVERY_URL (GraphQL endpoint, works for all chains)');
    console.log('  - AGENTIC_TRUST_DISCOVERY_API_KEY (API key, works for all chains)');
    console.log('');
    console.log('See apps/admin/ENV-VARIABLES.md for more information.');
    return true;
  }
  
  return false;
}

// Set up environment for integration tests
beforeAll(() => {
  if (shouldSkipIntegrationTests()) {
    console.log('⏭️  Skipping integration tests');
  } else {
    console.log('✅ Running integration tests with real backends');
    console.log('✅ Environment variables loaded from .env file');
    // Log which env vars are loaded (without showing values for security)
    const loadedVars = Object.keys(REQUIRED_ENV_VARS).filter(
      (key) => REQUIRED_ENV_VARS[key as keyof typeof REQUIRED_ENV_VARS]
    );
    console.log(`✅ Loaded ${loadedVars.length} required environment variables`);
    
    // Log optional env vars if present
    if (OPTIONAL_ENV_VARS.ADMIN_PRIVATE_KEY) {
      console.log('✅ Private key mode enabled (for authenticated routes)');
    } else {
      console.log('ℹ️  Private key mode not enabled (using public endpoints only)');
    }
    
    // Note: Web3Auth is not needed for server-side integration tests
    // Web3Auth requires browser environment and is only used in client-side code
    console.log('ℹ️  Web3Auth is not needed for server-side integration tests');
  }
});

// Cleanup after all tests
afterAll(() => {
  // Add any cleanup logic here if needed
});

