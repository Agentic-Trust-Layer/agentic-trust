/**
 * Integration Tests for /api/names/[did:ens] route
 * 
 * These tests make actual calls to blockchain RPC to check ENS availability.
 * 
 * To run these tests:
 * 1. Set INTEGRATION_TESTS=true
 * 2. Configure required environment variables
 * 3. Run: pnpm test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { shouldSkipIntegrationTests, hasRequiredEnvVars } from '../../../../../vitest.integration.setup';
import { createMockRequest, createMockParamsAsync, assertJsonResponse } from '../../__tests__/helpers';
import { GET } from '../[did:ens]/route';
import { TEST_AGENT_NAME, TEST_CHAIN_ID } from '../../__tests__/test-data';
import { buildDidEns } from '../_lib/didEns';

const skip = shouldSkipIntegrationTests();

describe.skipIf(skip)('GET /api/names/[did:ens] (Integration)', () => {
  beforeAll(() => {
    if (!hasRequiredEnvVars()) {
      throw new Error('Missing required environment variables for integration tests');
    }
  });

  it('should check ENS availability for existing name', async () => {
    // Check availability for a known existing name
    const encodedDid = buildDidEns(TEST_CHAIN_ID, TEST_AGENT_NAME);
    const request = createMockRequest(`http://test.example/api/names/${encodedDid}`);
    const params = createMockParamsAsync({ 'did:ens': encodedDid });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 200);

    expect(data).toHaveProperty('available');
    expect(typeof data.available).toBe('boolean');
    
    // Since TEST_AGENT_NAME exists, it should not be available
    expect(data.available).toBe(false);
  }, 30000);

  it('should check ENS availability for non-existent name', async () => {
    // Use a name that definitely doesn't exist
    const nonExistentName = `test-${Date.now()}-${Math.random().toString(36).substring(7)}.8004-agent.eth`;
    const encodedDid = buildDidEns(TEST_CHAIN_ID, nonExistentName);
    const request = createMockRequest(`http://test.example/api/names/${encodedDid}`);
    const params = createMockParamsAsync({ 'did:ens': encodedDid });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 200);

    expect(data).toHaveProperty('available');
    expect(typeof data.available).toBe('boolean');
    
    // Since the name doesn't exist, it should be available
    expect(data.available).toBe(true);
  }, 30000);

  it('should return 400 for invalid ENS DID', async () => {
    const request = createMockRequest('http://test.example/api/names/invalid');
    const params = createMockParamsAsync({ 'did:ens': 'invalid' });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 400);

    expect(data).toHaveProperty('error', 'Invalid ENS DID');
    expect(data).toHaveProperty('message');
  });

  it('should return 400 for ENS DID without .eth suffix', async () => {
    // Try to use an ENS name without .eth suffix - should be rejected
    const invalidDid = encodeURIComponent('did:ens:11155111:test-agent.8004-agent');
    const request = createMockRequest(`http://test.example/api/names/${invalidDid}`);
    const params = createMockParamsAsync({ 'did:ens': invalidDid });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 400);

    expect(data).toHaveProperty('error', 'Invalid ENS DID');
    expect(data.message).toContain('must end with .eth');
  });
});

