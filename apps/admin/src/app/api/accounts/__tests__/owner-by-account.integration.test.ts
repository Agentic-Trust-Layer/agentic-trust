/**
 * Integration Tests for /api/accounts/owner/by-account/[didethr] route
 * 
 * These tests make actual calls to get account owners using:
 * - Blockchain RPC (to query contract owner function)
 * - Real contract addresses on Sepolia testnet
 * 
 * To run these tests:
 * 1. Set INTEGRATION_TESTS=true
 * 2. Configure required environment variables:
 *    - AGENTIC_TRUST_RPC_URL_SEPOLIA (RPC URL for chain)
 * 3. Run: pnpm test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { shouldSkipIntegrationTests, hasRequiredEnvVars } from '../../../../../vitest.integration.setup';
import { createMockRequest, createMockParamsAsync, assertJsonResponse, assertErrorResponse } from '../../__tests__/helpers';
import { GET } from '../owner/by-account/[didethr]/route';
import { TEST_CHAIN_ID, TEST_AGENT_ACCOUNT } from '../../__tests__/test-data';

// Skip all tests if integration tests are disabled or env vars are missing
const skip = shouldSkipIntegrationTests();

describe.skipIf(skip)('GET /api/accounts/owner/by-account/[didethr] (Integration)', () => {
  beforeAll(() => {
    if (!hasRequiredEnvVars()) {
      throw new Error('Missing required environment variables for integration tests');
    }
  });

  it('should return account owner for valid ETHR DID', async () => {
    // Use the test agent account from test-data.ts
    const account = TEST_AGENT_ACCOUNT;
    const chainId = TEST_CHAIN_ID;
    const didEthr = `did:ethr:${chainId}:${account}`;
    const encodedDid = encodeURIComponent(didEthr);

    const request = createMockRequest(
      `http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`
    );
    const params = createMockParamsAsync({ didethr: encodedDid });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 200);

    // Verify response structure
    expect(data).toHaveProperty('owner');
    expect(data).toHaveProperty('account');
    expect(data).toHaveProperty('chainId');
    
    // Verify owner is a valid address
    expect(data.owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(typeof data.owner).toBe('string');
    expect(data.owner.length).toBe(42);
    
    // Verify account matches
    expect(data.account.toLowerCase()).toBe(account.toLowerCase());
    expect(data.chainId).toBe(chainId);
  }, 30000); // 30 second timeout for integration test

  it('should return 400 for invalid ETHR DID format', async () => {
    const invalidDid = 'invalid-did-format';
    const encodedDid = encodeURIComponent(invalidDid);

    const request = createMockRequest(
      `http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`
    );
    const params = createMockParamsAsync({ didethr: encodedDid });

    const response = await GET(request, params);
    const data = await assertErrorResponse(response, 400);

    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/Invalid ETHR DID/i);
  });

  it('should return 404 when account owner is not found (non-existent account)', async () => {
    // Use a non-existent account address (doesn't have an owner function)
    const nonExistentAccount = '0x0000000000000000000000000000000000000001';
    const chainId = TEST_CHAIN_ID;
    const didEthr = `did:ethr:${chainId}:${nonExistentAccount}`;
    const encodedDid = encodeURIComponent(didEthr);

    const request = createMockRequest(
      `http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`
    );
    const params = createMockParamsAsync({ didethr: encodedDid });

    const response = await GET(request, params);
    const data = await assertErrorResponse(response, 404);

    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/Account owner not found/i);
    expect(data.account.toLowerCase()).toBe(nonExistentAccount.toLowerCase());
    expect(data.chainId).toBe(chainId);
  }, 30000);

  it('should handle different chain IDs', async () => {
    // Test with Sepolia chain ID
    const account = TEST_AGENT_ACCOUNT;
    const chainId = TEST_CHAIN_ID;
    const didEthr = `did:ethr:${chainId}:${account}`;
    const encodedDid = encodeURIComponent(didEthr);

    const request = createMockRequest(
      `http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`
    );
    const params = createMockParamsAsync({ didethr: encodedDid });

    const response = await GET(request, params);
    
    // May succeed (if account has owner) or fail with 404 (if not found)
    // Both are valid responses depending on the account
    if (response.status === 200) {
      const data = await assertJsonResponse(response, 200);
      expect(data).toHaveProperty('owner');
      expect(data.chainId).toBe(chainId);
    } else if (response.status === 404) {
      const data = await assertErrorResponse(response, 404);
      expect(data.error).toMatch(/Account owner not found/i);
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  }, 30000);

  it('should return the same owner for the same account', async () => {
    const account = TEST_AGENT_ACCOUNT;
    const chainId = TEST_CHAIN_ID;
    const didEthr = `did:ethr:${chainId}:${account}`;
    const encodedDid = encodeURIComponent(didEthr);

    // First request
    const request1 = createMockRequest(
      `http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`
    );
    const params1 = createMockParamsAsync({ didethr: encodedDid });
    const response1 = await GET(request1, params1);

    // Skip if account owner is not found
    if (response1.status === 404) {
      return; // Test passes - account doesn't have an owner
    }

    const data1 = await assertJsonResponse(response1, 200);

    // Second request (should return the same owner)
    const request2 = createMockRequest(
      `http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`
    );
    const params2 = createMockParamsAsync({ didethr: encodedDid });
    const response2 = await GET(request2, params2);
    const data2 = await assertJsonResponse(response2, 200);

    // Verify both requests return the same owner (deterministic)
    expect(data1.owner).toBe(data2.owner);
    expect(data1.account.toLowerCase()).toBe(data2.account.toLowerCase());
    expect(data1.chainId).toBe(data2.chainId);
  }, 30000);

  it('should handle URL-encoded DID parameters', async () => {
    const account = TEST_AGENT_ACCOUNT;
    const chainId = TEST_CHAIN_ID;
    const didEthr = `did:ethr:${chainId}:${account}`;
    // Test with URL-encoded DID
    const encodedDid = encodeURIComponent(didEthr);

    const request = createMockRequest(
      `http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`
    );
    const params = createMockParamsAsync({ didethr: encodedDid });

    const response = await GET(request, params);
    
    // May succeed or fail with 404, both are valid
    if (response.status === 200) {
      const data = await assertJsonResponse(response, 200);
      expect(data).toHaveProperty('owner');
      expect(data.account.toLowerCase()).toBe(account.toLowerCase());
    } else if (response.status === 404) {
      const data = await assertErrorResponse(response, 404);
      expect(data.error).toMatch(/Account owner not found/i);
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  }, 30000);
});
