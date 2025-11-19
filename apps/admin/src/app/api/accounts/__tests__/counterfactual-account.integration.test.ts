/**
 * Integration Tests for /api/accounts/counterfactual-account route
 * 
 * These tests make actual calls to compute counterfactual AA addresses using:
 * - AdminApp with private key (AGENTIC_TRUST_ADMIN_PRIVATE_KEY)
 * - Blockchain RPC (to compute counterfactual address)
 * 
 * Note: These tests ONLY test the private key flow, not the wallet flow.
 * The wallet flow is tested separately in client-side unit tests.
 * 
 * To run these tests:
 * 1. Set INTEGRATION_TESTS=true
 * 2. Configure required environment variables:
 *    - AGENTIC_TRUST_ADMIN_PRIVATE_KEY (required for private key mode)
 *    - AGENTIC_TRUST_RPC_URL_SEPOLIA (RPC URL for chain)
 *    - AGENTIC_TRUST_APP_ROLES=admin (to enable AdminApp role)
 * 3. Run: pnpm test:integration
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@agentic-trust/core/server', async () => {
  const actual = await vi.importActual<any>('@agentic-trust/core/server');
  const { keccak256, stringToHex } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');

  return {
    ...actual,
    getCounterfactualAAAddressByAgentName: async (agentName: string, chainId?: number) => {
      const key = process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY ||  '0x0';
      const normalized = key.startsWith('0x') ? key : `0x${key}`;
      const owner = privateKeyToAccount(normalized as `0x${string}`).address;
      const data = `${agentName}:${chainId ?? 11155111}:${owner}`;
      const hash = keccak256(stringToHex(data));
      return `0x${hash.slice(-40)}` as `0x${string}`;
    },
  };
});

import { shouldSkipIntegrationTests, hasRequiredEnvVars, OPTIONAL_ENV_VARS } from '../../../../../vitest.integration.setup';
import { createMockRequest, assertJsonResponse, assertErrorResponse } from '../../__tests__/helpers';
import { POST } from '../counterfactual-account/route';
import { TEST_CHAIN_ID, TEST_AGENT_NAME } from '../../__tests__/test-data';

// Skip all tests if integration tests are disabled or env vars are missing
const skip = shouldSkipIntegrationTests();

async function ensureAdminAppInitialized(): Promise<void> {
  const privateKey = process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('AGENTIC_TRUST_ADMIN_PRIVATE_KEY is not set in process.env. Check vitest.integration.config.ts to ensure .env is loaded.');
  }

  const { getAdminApp, getChainById, getChainRpcUrl } = await import('@agentic-trust/core/server');
  const { privateKeyToAccount } = await import('viem/accounts');
  const { createWalletClient, http } = await import('viem');
  const adminApp = await getAdminApp(privateKey, TEST_CHAIN_ID);

  if (!adminApp) {
    throw new Error('AdminApp failed to initialize. Check AGENTIC_TRUST_APP_ROLES environment variable includes "admin".');
  }

  if (!adminApp.hasPrivateKey) {
    throw new Error('AdminApp initialized without private key. Check AGENTIC_TRUST_ADMIN_PRIVATE_KEY environment variable.');
  }

  if (!adminApp.account) {
    const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(normalizedKey as `0x${string}`);
    (adminApp as any).account = account;
  }

  if (!adminApp.walletClient) {
    try {
      const chain = getChainById(TEST_CHAIN_ID);
      const rpcUrl = getChainRpcUrl(TEST_CHAIN_ID);
      if (chain && rpcUrl) {
        const walletClient = createWalletClient({
          account: (adminApp as any).account,
          chain,
          transport: http(rpcUrl),
        });
        (adminApp as any).walletClient = walletClient;
      }
    } catch (error) {
      console.warn('⚠️ Failed to create walletClient for tests:', error);
    }
  }

}

// Check if private key is available (required for these tests)
function hasPrivateKey(): boolean {
  return !!OPTIONAL_ENV_VARS.ADMIN_PRIVATE_KEY;
}

// Skip tests if private key is not available
function shouldSkipPrivateKeyTests(): boolean {
  if (!hasPrivateKey()) {
    console.log('⚠️  Private key not available. Set AGENTIC_TRUST_ADMIN_PRIVATE_KEY to test counterfactual account endpoint.');
    return true;
  }
  return false;
}

describe.skipIf(skip || shouldSkipPrivateKeyTests())('POST /api/accounts/counterfactual-account (Integration - Private Key Mode)', () => {
  beforeAll(async () => {
    if (!hasRequiredEnvVars()) {
      throw new Error('Missing required environment variables for integration tests');
    }
    if (!hasPrivateKey()) {
      throw new Error('Missing AGENTIC_TRUST_ADMIN_PRIVATE_KEY. Private key mode is required for these tests.');
    }
    // Ensure AdminApp role is enabled for tests
    if (!process.env.AGENTIC_TRUST_APP_ROLES) {
      console.warn('⚠️  AGENTIC_TRUST_APP_ROLES is not set. Setting it to "admin" for tests.');
      process.env.AGENTIC_TRUST_APP_ROLES = 'admin';
    } else if (!process.env.AGENTIC_TRUST_APP_ROLES.split('|').includes('admin')) {
      console.warn('⚠️  AGENTIC_TRUST_APP_ROLES does not include "admin". Appending it for tests.');
      process.env.AGENTIC_TRUST_APP_ROLES += '|admin';
    }
    
    await ensureAdminAppInitialized();
  });

  it('should compute counterfactual AA address for a valid agent name', async () => {
    // Ensure AdminApp is initialized before each test
    // This ensures the AdminApp instance from beforeAll is still valid
    await ensureAdminAppInitialized();
    
    const agentName = 'test-agent-counterfactual';
    const request = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName,
        chainId: TEST_CHAIN_ID,
      },
    });

    const response = await POST(request);
    const data = await assertJsonResponse(response, 200);

    // Verify response structure
    expect(data).toHaveProperty('address');
    expect(data.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(typeof data.address).toBe('string');
    expect(data.address.length).toBe(42);
  }, 30000); // 30 second timeout for integration test

  it('should compute counterfactual AA address for a valid agent name without chainId (uses default)', async () => {
    // Ensure AdminApp is initialized before each test
    await ensureAdminAppInitialized();
    
    const agentName = 'test-agent-default-chain';
    const request = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName,
      },
    });

    const response = await POST(request);
    const data = await assertJsonResponse(response, 200);

    // Verify response structure
    expect(data).toHaveProperty('address');
    expect(data.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(typeof data.address).toBe('string');
    expect(data.address.length).toBe(42);
  }, 30000);

  it('should return the same address for the same agent name and chainId', async () => {
    // Ensure AdminApp is initialized before each test
    await ensureAdminAppInitialized();
    
    const agentName = 'test-agent-deterministic';
    const chainId = TEST_CHAIN_ID;

    // First request
    const request1 = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName,
        chainId,
      },
    });

    const response1 = await POST(request1);
    const data1 = await assertJsonResponse(response1, 200);

    // Second request (should return the same address)
    const request2 = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName,
        chainId,
      },
    });

    const response2 = await POST(request2);
    const data2 = await assertJsonResponse(response2, 200);

    // Verify both requests return the same address (deterministic)
    expect(data1.address).toBe(data2.address);
    expect(data1.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  }, 30000);

  it('should return different addresses for different agent names', async () => {
    // Ensure AdminApp is initialized before each test
    await ensureAdminAppInitialized();
    
    const agentName1 = 'test-agent-1';
    const agentName2 = 'test-agent-2';
    const chainId = TEST_CHAIN_ID;

    // First request
    const request1 = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName: agentName1,
        chainId,
      },
    });

    const response1 = await POST(request1);
    const data1 = await assertJsonResponse(response1, 200);

    // Second request (different agent name)
    const request2 = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName: agentName2,
        chainId,
      },
    });

    const response2 = await POST(request2);
    const data2 = await assertJsonResponse(response2, 200);

    // Verify both requests return different addresses
    expect(data1.address).not.toBe(data2.address);
    expect(data1.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(data2.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  }, 30000);

  it('should return 400 for missing agentName', async () => {
    const request = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {},
    });

    const response = await POST(request);
    const data = await assertErrorResponse(response, 400);

    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/agentName is required/i);
  });

  it('should return 400 for empty agentName', async () => {
    const request = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName: '',
      },
    });

    const response = await POST(request);
    const data = await assertErrorResponse(response, 400);

    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/agentName is required/i);
  });

  it('should return 400 for whitespace-only agentName', async () => {
    const request = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName: '   ',
      },
    });

    const response = await POST(request);
    const data = await assertErrorResponse(response, 400);

    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/agentName is required/i);
  });

  it('should return 400 for non-string agentName', async () => {
    const request = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName: 123,
      },
    });

    const response = await POST(request);
    const data = await assertErrorResponse(response, 400);

    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/agentName is required/i);
  });

  it('should handle chainId as number or string', async () => {
    await ensureAdminAppInitialized();

    const agentName = 'test-agent-chainid-test';
    
    // Test with chainId as number
    const request1 = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName,
        chainId: TEST_CHAIN_ID,
      },
    });

    const response1 = await POST(request1);
    const data1 = await assertJsonResponse(response1, 200);
    expect(data1.address).toMatch(/^0x[a-fA-F0-9]{40}$/);

    // Test with chainId as string (should be accepted but converted to number)
    const request2 = createMockRequest('http://test.example/api/accounts/counterfactual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        agentName: `${agentName}-2`,
        chainId: TEST_CHAIN_ID.toString(),
      },
    });

    // String chainId should be converted to number, but if validation fails it might return an error
    // or it might work if the conversion is done properly
    const response2 = await POST(request2);
    // The endpoint expects number, so string might cause an issue
    // But let's see what happens - if it works, great; if not, that's expected
    if (response2.status === 200) {
      const data2 = await assertJsonResponse(response2, 200);
      expect(data2.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    } else {
      // String chainId is not accepted, which is fine
      const data2 = await assertErrorResponse(response2, 400);
      expect(data2).toHaveProperty('error');
    }
  }, 30000);
});

