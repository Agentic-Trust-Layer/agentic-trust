/**
 * Tests for /api/agents/[did:8004] route
 * 
 * These tests use real agent data (Agent ID 724) to ensure
 * the API correctly handles actual response formats.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockParamsAsync, assertJsonResponse } from '../../__tests__/helpers';
import {
  TEST_AGENT_ID,
  TEST_CHAIN_ID,
  TEST_AGENT_NAME,
  TEST_AGENT_ACCOUNT,
  TEST_TOKEN_URI,
  TEST_IPFS_REGISTRATION,
  TEST_DISCOVERY_DATA,
  TEST_METADATA,
  TEST_A2A_ENDPOINT,
} from '../../__tests__/test-data';

// Mock dependencies BEFORE importing the route
vi.mock('@agentic-trust/core', () => ({
  parseDid8004: vi.fn(),
}));

// Mock core dependencies
vi.mock('@agentic-trust/core', () => ({
  getIPFSStorage: vi.fn(() => ({
    uploadJSON: vi.fn(),
    getJSON: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('@agentic-trust/core/server', () => ({
  getIdentityClient: vi.fn(() => Promise.resolve({
    getTokenURI: vi.fn().mockResolvedValue(null),
    getMetadata: vi.fn().mockResolvedValue(null),
    getIdentityRegistration: vi.fn(),
  })),
}));

vi.mock('../../../../lib/server/client', () => ({
  getAdminClient: vi.fn(() => Promise.resolve({
    agents: {
      getAgentFromDiscovery: vi.fn().mockResolvedValue(null),
      getAgentFromDiscoveryByDid: vi.fn().mockResolvedValue(null),
      getAgent: vi.fn(),
    },
  })),
}));

// Import the route AFTER mocks are set up
import { GET } from '../[did:8004]/route';
import { parseDid8004 } from '@agentic-trust/core';
import { getIdentityClient } from '@agentic-trust/core/server';
import { getIPFSStorage } from '@agentic-trust/core';
import { getAdminClient } from '../../../../lib/server/client';

describe('GET /api/agents/[did:8004]', () => {
  beforeEach(() => {
    // Clear all mocks but preserve the mock structure
    vi.clearAllMocks();
    
    // Reset default mock implementations after clearing
    // This ensures mocks are properly configured for each test
  });

  it('should return 400 for invalid 8004 DID', async () => {
    const mockParseDid800 = vi.mocked(parseDid8004);
    mockParseDid8004.mockImplementation(() => {
      throw new Error('Invalid 8004 DID format');
    });

    const request = createMockRequest('http://localhost:3000/api/agents/invalid');
    // Next.js automatically decodes URL params
    const params = createMockParamsAsync({ 'did:8004': 'invalid' });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 400);

    expect(data).toMatchObject({
      error: 'Invalid 8004 DID',
    });
    expect(data.message).toBeDefined();
  });

  it('should return agent record for valid 8004 DID with real data', async () => {
    // Set up mocks for this test
    const mockParseDid8004 = vi.mocked(parseDid8004);
    mockParseDid8004.mockReturnValue({
      did: `did:8004:${TEST_CHAIN_ID}:${TEST_AGENT_ID}`,
      method: '8004',
      namespace: undefined,
      chainId: TEST_CHAIN_ID,
      agentId: TEST_AGENT_ID,
      fragment: undefined,
      encoded: encodeURIComponent(`did:8004:${TEST_CHAIN_ID}:${TEST_AGENT_ID}`),
    });

    // Mock identity client to return real metadata
    const mockIdentityClient = {
      getTokenURI: vi.fn().mockResolvedValue(TEST_TOKEN_URI),
      getMetadata: vi.fn().mockImplementation((agentId: bigint, key: string) => {
        if (key === 'agentName') return Promise.resolve(TEST_AGENT_NAME);
        if (key === 'agentAccount') {
          // Contract returns eip155 format: eip155:11155111:0x...
          return Promise.resolve(TEST_METADATA.agentAccount);
        }
        return Promise.resolve(null);
      }),
    };

    const mockGetIdentityClient = vi.mocked(getIdentityClient);
    mockGetIdentityClient.mockResolvedValue(mockIdentityClient as any);

    // Mock IPFS storage to return real registration data
    const mockIPFSStorage = {
      getJson: vi.fn().mockResolvedValue(TEST_IPFS_REGISTRATION),
    };

    const mockGetIPFSStorage = vi.mocked(getIPFSStorage);
    mockGetIPFSStorage.mockReturnValue(mockIPFSStorage as any);

    // Mock admin client to return real GraphQL discovery data
    const mockAdminClient = {
      agents: {
        getAgentFromDiscovery: vi.fn(),
        getAgentFromDiscoveryByDid: vi.fn().mockResolvedValue(TEST_DISCOVERY_DATA),
        getAgent: vi.fn(),
      },
    };

    const mockGetAdminClient = vi.mocked(getAdminClient);
    mockGetAdminClient.mockResolvedValue(mockAdminClient as any);

    // Next.js automatically decodes URL params, so we pass the decoded DID
    const didAgent = `did:8004:${TEST_CHAIN_ID}:${TEST_AGENT_ID}`;
    const request = createMockRequest(`http://localhost:3000/api/agents/${encodeURIComponent(didAgent)}`);
    const params = createMockParamsAsync({ 'did:8004': didAgent });

    const response = await GET(request, params);
    
    // Verify response status
    expect(response.status).toBe(200);
    
    const data = await assertJsonResponse(response, 200);
    
    // Verify the response structure matches real API response format
    // The response should include all data from contract, IPFS, and GraphQL
    expect(data).toHaveProperty('success', true);
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('agentId', TEST_AGENT_ID);
    expect(data).toHaveProperty('chainId', TEST_CHAIN_ID);
    
    // Verify identity metadata (from contract)
    expect(data).toHaveProperty('identityMetadata');
    expect(data.identityMetadata).toHaveProperty('tokenURI', TEST_TOKEN_URI);
    expect(data.identityMetadata).toHaveProperty('metadata');
    expect(data.identityMetadata.metadata).toHaveProperty('agentName', TEST_AGENT_NAME);
    expect(data.identityMetadata.metadata).toHaveProperty('agentAccount', TEST_METADATA.agentAccount);
    
    // Verify IPFS registration data is included
    expect(data).toHaveProperty('identityRegistration');
    expect(data.identityRegistration).not.toBeNull();
    expect(data.identityRegistration).toHaveProperty('tokenURI', TEST_TOKEN_URI);
    expect(data.identityRegistration).toHaveProperty('registration');
    expect(data.identityRegistration?.registration).toBeDefined();
    expect(data.identityRegistration?.registration).toHaveProperty('name', TEST_AGENT_NAME);
    expect(data.identityRegistration?.registration).toHaveProperty('description', 'movie review agent');
    expect(data.identityRegistration?.registration).toHaveProperty('endpoints');
    expect(data.identityRegistration?.registration).toHaveProperty('supportedTrust');
    
    // Verify discovery data is reflected in AgentInfo fields
    expect(data).toHaveProperty('agentName', TEST_AGENT_NAME);
    expect(data).toHaveProperty('a2aEndpoint', TEST_A2A_ENDPOINT);
    expect(data).toHaveProperty('agentId', TEST_AGENT_ID);
    
    // Verify flattened fields from registration (top-level fields)
    expect(data).toHaveProperty('name', TEST_AGENT_NAME);
    expect(data).toHaveProperty('description', 'movie review agent');
    expect(data).toHaveProperty('endpoints');
    expect(data).toHaveProperty('supportedTrust');
    expect(Array.isArray(data.endpoints)).toBe(true);
    expect(Array.isArray(data.supportedTrust)).toBe(true);
    expect(data.endpoints).toHaveLength(3); // A2A, ENS, agentAccount
    expect(data.endpoints[0]).toHaveProperty('name', 'A2A');
    expect(data.endpoints[0]).toHaveProperty('endpoint', TEST_A2A_ENDPOINT);
    expect(data.endpoints[0]).toHaveProperty('version', '0.3.0');
    expect(data.supportedTrust).toContain('reputation');
    expect(data.supportedTrust).toContain('crypto-economic');
    expect(data.supportedTrust).toContain('tee-attestation');
    expect(data.supportedTrust).toHaveLength(3);
    
    // Verify flattened fields from discovery
    expect(data).toHaveProperty('a2aEndpoint', TEST_A2A_ENDPOINT);
    expect(data).toHaveProperty('createdAtTime', TEST_DISCOVERY_DATA.createdAtTime);
    expect(data).toHaveProperty('updatedAtTime', TEST_DISCOVERY_DATA.updatedAtTime);
    
    // Verify that getTokenURI was called with the correct agent ID
    expect(mockIdentityClient.getTokenURI).toHaveBeenCalledWith(BigInt(TEST_AGENT_ID));
    
    // Verify that getMetadata was called for both keys
    expect(mockIdentityClient.getMetadata).toHaveBeenCalledWith(BigInt(TEST_AGENT_ID), 'agentName');
    expect(mockIdentityClient.getMetadata).toHaveBeenCalledWith(BigInt(TEST_AGENT_ID), 'agentAccount');
    
    // Verify that IPFS storage was called with the token URI
    expect(mockIPFSStorage.getJson).toHaveBeenCalledWith(TEST_TOKEN_URI);
    
    // Verify that GraphQL was called with correct parameters
    expect(mockAdminClient.agents.getAgentFromDiscoveryByDid).toHaveBeenCalledWith(didAgent);
  });

  it('should return 500 on internal error', async () => {
    // Suppress console.error for this test since we're intentionally testing error handling
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const mockParseDid8004 = vi.mocked(parseDid8004);
      mockParseDid8004.mockReturnValue({
        did: 'did:8004:11155111:123',
        method: '8004',
        namespace: undefined,
        chainId: 11155111,
        agentId: '123',
        fragment: undefined,
        encoded: encodeURIComponent('did:8004:11155111:123'),
      });

      // Mock getIdentityClient to throw an error
      const mockGetIdentityClient = vi.mocked(getIdentityClient);
      mockGetIdentityClient.mockRejectedValue(new Error('Database error'));

      // Next.js automatically decodes URL params
      const didAgent = 'did:8004:11155111:123';
      const request = createMockRequest(`http://localhost:3000/api/agents/${encodeURIComponent(didAgent)}`);
      const params = createMockParamsAsync({ 'did:8004': didAgent });

      const response = await GET(request, params);
      const data = await assertJsonResponse(response, 500);

      expect(data).toMatchObject({
        error: 'Failed to get agent information',
      });
      expect(data.message).toBeDefined();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

