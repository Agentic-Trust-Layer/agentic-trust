/**
 * Tests for /api/names/[did:ens] route
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockParamsAsync, assertJsonResponse, assertErrorResponse } from '../../__tests__/helpers';

// Mock dependencies BEFORE importing the route
vi.mock('@agentic-trust/core/server', () => ({
  isENSNameAvailable: vi.fn(),
}));

vi.mock('../_lib/ensDid', () => ({
  parseEnsDid: vi.fn(),
}));

// Import the route AFTER mocks are set up
import { GET } from '../[did:ens]/route';
import { isENSNameAvailable } from '@agentic-trust/core/server';
import { parseEnsDid } from '../_lib/ensDid';

describe('GET /api/names/[did:ens]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 for invalid ENS DID', async () => {
    const mockParseEnsDid = vi.mocked(parseEnsDid);
    mockParseEnsDid.mockImplementation(() => {
      throw new Error('Invalid ENS DID format');
    });

    const request = createMockRequest('http://localhost:3000/api/names/invalid');
    const params = createMockParamsAsync({ 'did:ens': 'invalid' });

    const response = await GET(request, params);
    const data = await assertErrorResponse(response, 400);

    expect(data).toMatchObject({
      error: 'Invalid ENS DID',
    });
    expect(data.message).toBeDefined();
  });

  it('should return 400 for ENS DID without .eth suffix', async () => {
    const mockParseEnsDid = vi.mocked(parseEnsDid);
    mockParseEnsDid.mockImplementation(() => {
      throw new Error('Invalid ENS name in ENS DID: did:ens:11155111:test-agent.8004-agent. ENS name must end with .eth');
    });

    const invalidDid = encodeURIComponent('did:ens:11155111:test-agent.8004-agent');
    const request = createMockRequest(`http://localhost:3000/api/names/${invalidDid}`);
    const params = createMockParamsAsync({ 'did:ens': invalidDid });

    const response = await GET(request, params);
    const data = await assertErrorResponse(response, 400);

    expect(data).toMatchObject({
      error: 'Invalid ENS DID',
    });
    expect(data.message).toContain('must end with .eth');
  });

  it('should return available: true when ENS name is available', async () => {
    const mockEnsName = 'test-agent.8004-agent.eth';
    const mockChainId = 11155111;

    const mockParseEnsDid = vi.mocked(parseEnsDid);
    mockParseEnsDid.mockReturnValue({
      ensName: mockEnsName,
      chainId: mockChainId,
    });

    const mockIsENSNameAvailable = vi.mocked(isENSNameAvailable);
    mockIsENSNameAvailable.mockResolvedValue(true);

    const encodedDid = encodeURIComponent(`did:ens:${mockChainId}:${mockEnsName}`);
    const request = createMockRequest(`http://localhost:3000/api/names/${encodedDid}`);
    const params = createMockParamsAsync({ 'did:ens': encodedDid });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 200);

    expect(mockIsENSNameAvailable).toHaveBeenCalledWith(mockEnsName, mockChainId);
    expect(data).toEqual({
      available: true,
    });
  });

  it('should return available: false when ENS name is not available', async () => {
    const mockEnsName = 'taken-name.8004-agent.eth';
    const mockChainId = 11155111;

    const mockParseEnsDid = vi.mocked(parseEnsDid);
    mockParseEnsDid.mockReturnValue({
      ensName: mockEnsName,
      chainId: mockChainId,
    });

    const mockIsENSNameAvailable = vi.mocked(isENSNameAvailable);
    mockIsENSNameAvailable.mockResolvedValue(false);

    const encodedDid = encodeURIComponent(`did:ens:${mockChainId}:${mockEnsName}`);
    const request = createMockRequest(`http://localhost:3000/api/names/${encodedDid}`);
    const params = createMockParamsAsync({ 'did:ens': encodedDid });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 200);

    expect(mockIsENSNameAvailable).toHaveBeenCalledWith(mockEnsName, mockChainId);
    expect(data).toEqual({
      available: false,
    });
  });

  it('should return 500 on internal error', async () => {
    // Suppress console.error for this test since we're intentionally testing error handling
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const mockEnsName = 'test-agent.8004-agent.eth';
      const mockChainId = 11155111;

      const mockParseEnsDid = vi.mocked(parseEnsDid);
      mockParseEnsDid.mockReturnValue({
        ensName: mockEnsName,
        chainId: mockChainId,
      });

      const mockIsENSNameAvailable = vi.mocked(isENSNameAvailable);
      mockIsENSNameAvailable.mockRejectedValue(new Error('RPC error'));

      const encodedDid = encodeURIComponent(`did:ens:${mockChainId}:${mockEnsName}`);
      const request = createMockRequest(`http://localhost:3000/api/names/${encodedDid}`);
      const params = createMockParamsAsync({ 'did:ens': encodedDid });

      const response = await GET(request, params);
      const data = await assertErrorResponse(response, 500);

      expect(data).toMatchObject({
        error: 'Failed to check ENS availability',
      });
      expect(data.message).toBeDefined();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
