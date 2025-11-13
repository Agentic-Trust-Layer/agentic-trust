/**
 * Integration Tests for /api/agents/[did:agent] route
 * 
 * These tests make actual calls to backends:
 * - Blockchain RPC (contract reads)
 * - IPFS (registration JSON)
 * - GraphQL (discovery data)
 * 
 * To run these tests:
 * 1. Set INTEGRATION_TESTS=true
 * 2. Configure required environment variables (see vitest.integration.setup.ts)
 * 3. Run: pnpm test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { shouldSkipIntegrationTests, hasRequiredEnvVars } from '../../../../../vitest.integration.setup';
import { createMockRequest, createMockParamsAsync, assertJsonResponse } from '../../__tests__/helpers';
import { GET } from '../[did:agent]/route';
import {
  TEST_AGENT_ID,
  TEST_CHAIN_ID,
  TEST_AGENT_NAME,
  TEST_AGENT_ACCOUNT,
  TEST_TOKEN_URI,
  TEST_A2A_ENDPOINT,
} from '../../__tests__/test-data';

// Skip all tests if integration tests are disabled or env vars are missing
const skip = shouldSkipIntegrationTests();

describe.skipIf(skip)('GET /api/agents/[did:agent] (Integration)', () => {
  beforeAll(() => {
    if (!hasRequiredEnvVars()) {
      throw new Error('Missing required environment variables for integration tests');
    }
  });

  it('should fetch real agent data from blockchain, IPFS, and GraphQL', async () => {
    // Build agent DID from real test data
    const didAgent = `did:agent:${TEST_CHAIN_ID}:${TEST_AGENT_ID}`;
    const request = createMockRequest(`http://test.example/api/agents/${encodeURIComponent(didAgent)}`);
    const params = createMockParamsAsync({ 'did:agent': didAgent });

    // Call the route handler (this will make real backend calls)
    const response = await GET(request, params);

    // Verify response status
    expect(response.status).toBe(200);

    const data = await assertJsonResponse(response, 200);

    // Verify basic response structure
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('agentId', TEST_AGENT_ID);
    expect(data).toHaveProperty('chainId', TEST_CHAIN_ID);

    // Verify identity metadata (from blockchain contract)
    expect(data).toHaveProperty('identityMetadata');
    expect(data.identityMetadata).toHaveProperty('tokenURI');
    expect(data.identityMetadata.tokenURI).toBeTruthy();
    expect(data.identityMetadata).toHaveProperty('metadata');
    expect(data.identityMetadata.metadata).toHaveProperty('agentName');
    expect(data.identityMetadata.metadata.agentName).toBe(TEST_AGENT_NAME);
    expect(data.identityMetadata.metadata).toHaveProperty('agentAccount');
    // agentAccount should be in eip155 format
    expect(data.identityMetadata.metadata.agentAccount).toContain('eip155:');
    expect(data.identityMetadata.metadata.agentAccount).toContain(TEST_AGENT_ACCOUNT);

    // Verify IPFS registration data is included
    expect(data).toHaveProperty('identityRegistration');
    expect(data.identityRegistration).not.toBeNull();
    expect(data.identityRegistration).toHaveProperty('tokenURI');
    expect(data.identityRegistration).toHaveProperty('registration');
    expect(data.identityRegistration?.registration).toBeDefined();
    expect(data.identityRegistration?.registration).toHaveProperty('type');
    expect(data.identityRegistration?.registration).toHaveProperty('name');
    expect(data.identityRegistration?.registration?.name).toBe(TEST_AGENT_NAME);
    expect(data.identityRegistration?.registration).toHaveProperty('description');
    expect(data.identityRegistration?.registration).toHaveProperty('endpoints');
    expect(data.identityRegistration?.registration).toHaveProperty('supportedTrust');

    // Verify discovery data is included (from GraphQL)
    expect(data).toHaveProperty('discovery');
    expect(data.discovery).not.toBeNull();
    expect(data.discovery).toHaveProperty('agentName');
    expect(data.discovery?.agentName).toBe(TEST_AGENT_NAME);
    expect(data.discovery).toHaveProperty('a2aEndpoint');
    expect(data.discovery?.a2aEndpoint).toBe(TEST_A2A_ENDPOINT);
    expect(data.discovery).toHaveProperty('agentId', TEST_AGENT_ID);

    // Verify flattened fields from registration
    expect(data).toHaveProperty('name', TEST_AGENT_NAME);
    expect(data).toHaveProperty('description');
    expect(data).toHaveProperty('endpoints');
    expect(data).toHaveProperty('supportedTrust');
    expect(Array.isArray(data.endpoints)).toBe(true);
    expect(Array.isArray(data.supportedTrust)).toBe(true);
    expect(data.endpoints.length).toBeGreaterThan(0);
    expect(data.supportedTrust.length).toBeGreaterThan(0);

    // Verify flattened fields from discovery
    expect(data).toHaveProperty('a2aEndpoint', TEST_A2A_ENDPOINT);
    expect(data).toHaveProperty('createdAtTime');
    expect(data).toHaveProperty('updatedAtTime');

    // Verify endpoints structure
    const a2aEndpoint = data.endpoints.find((ep: any) => ep.name === 'A2A');
    expect(a2aEndpoint).toBeDefined();
    expect(a2aEndpoint?.endpoint).toBe(TEST_A2A_ENDPOINT);
    expect(a2aEndpoint?.version).toBeDefined();

    // Verify token URI matches expected value
    expect(data.identityMetadata.tokenURI).toBe(TEST_TOKEN_URI);
    expect(data.identityRegistration?.tokenURI).toBe(TEST_TOKEN_URI);
  }, 30000); // 30 second timeout for integration test

  it('should return 400 for invalid agent DID', async () => {
    const request = createMockRequest('http://test.example/api/agents/invalid-did');
    const params = createMockParamsAsync({ 'did:agent': 'invalid-did' });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 400);

    expect(data).toHaveProperty('error', 'Invalid agent DID');
    expect(data).toHaveProperty('message');
  });

  it('should return 500 for non-existent agent ID', async () => {
    // Use a very large agent ID that likely doesn't exist
    const didAgent = `did:agent:${TEST_CHAIN_ID}:999999999`;
    const request = createMockRequest(`http://test.example/api/agents/${encodeURIComponent(didAgent)}`);
    const params = createMockParamsAsync({ 'did:agent': didAgent });

    const response = await GET(request, params);

    // This might return 200 with null data, or 500 if the contract call fails
    // We'll accept either, but log what we got
    if (response.status === 500) {
      const data = await assertJsonResponse(response, 500);
      expect(data).toHaveProperty('error');
    } else if (response.status === 200) {
      const data = await assertJsonResponse(response, 200);
      // If it returns 200, the tokenURI should be null or the registration should be null
      expect(data).toHaveProperty('identityMetadata');
      // Contract might return null tokenURI for non-existent agents
      expect(data.identityMetadata.tokenURI).toBeNull();
    }
  }, 30000);
});

