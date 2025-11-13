/**
 * Tests for /api/accounts/owner/by-account/[did:pkh] route
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockParamsAsync, assertJsonResponse } from '../../__tests__/helpers';

// Mock dependencies BEFORE importing the route
vi.mock('@agentic-trust/core/server', () => ({
  getAccountOwnerByDidPkh: vi.fn(),
  parsePkhDid: vi.fn(),
}));

// Import the route AFTER mocks are set up
import { GET } from '../owner/by-account/[did:pkh]/route';
import { getAccountOwnerByDidPkh, parsePkhDid } from '@agentic-trust/core/server';

describe('GET /api/accounts/owner/by-account/[did:pkh]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 for invalid PKH DID', async () => {
    const mockParsePkhDid = vi.mocked(parsePkhDid);
    mockParsePkhDid.mockImplementation(() => {
      throw new Error('Invalid PKH DID format');
    });

    const request = createMockRequest('http://localhost:3000/api/accounts/owner/by-account/invalid');
    const params = createMockParamsAsync({ 'did:pkh': 'invalid' });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 400);

    expect(data).toMatchObject({
      error: 'Invalid PKH DID',
    });
    expect(data.message).toBeDefined();
  });

  it('should return 404 when account owner is not found', async () => {
    const mockAccount = '0x1234567890123456789012345678901234567890' as `0x${string}`;
    const mockChainId = 11155111;

    const mockParsePkhDid = vi.mocked(parsePkhDid);
    mockParsePkhDid.mockReturnValue({
      account: mockAccount,
      chainId: mockChainId,
    });

    const mockGetAccountOwnerByDidPkh = vi.mocked(getAccountOwnerByDidPkh);
    mockGetAccountOwnerByDidPkh.mockResolvedValue(null);

    const encodedDid = encodeURIComponent(`did:pkh:${mockChainId}:${mockAccount}`);
    const request = createMockRequest(`http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`);
    const params = createMockParamsAsync({ 'did:pkh': encodedDid });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 404);

    expect(data).toMatchObject({
      error: 'Account owner not found',
      account: mockAccount,
      chainId: mockChainId,
    });
  });

  it('should return account owner for valid PKH DID', async () => {
    const mockAccount = '0x1234567890123456789012345678901234567890' as `0x${string}`;
    const mockOwner = '0x9876543210987654321098765432109876543210' as `0x${string}`;
    const mockChainId = 11155111;

    const mockParsePkhDid = vi.mocked(parsePkhDid);
    mockParsePkhDid.mockReturnValue({
      account: mockAccount,
      chainId: mockChainId,
    });

    const mockGetAccountOwnerByDidPkh = vi.mocked(getAccountOwnerByDidPkh);
    mockGetAccountOwnerByDidPkh.mockResolvedValue(mockOwner);

    const encodedDid = encodeURIComponent(`did:pkh:${mockChainId}:${mockAccount}`);
    const request = createMockRequest(`http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`);
    const params = createMockParamsAsync({ 'did:pkh': encodedDid });

    const response = await GET(request, params);
    const data = await assertJsonResponse(response, 200);

    expect(mockGetAccountOwnerByDidPkh).toHaveBeenCalledWith(encodedDid);
    expect(data).toEqual({
      owner: mockOwner,
      account: mockAccount,
      chainId: mockChainId,
    });
  });

  it('should return 500 on internal error', async () => {
    // Suppress console.error for this test since we're intentionally testing error handling
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const mockParsePkhDid = vi.mocked(parsePkhDid);
      mockParsePkhDid.mockReturnValue({
        account: '0x1234567890123456789012345678901234567890' as `0x${string}`,
        chainId: 11155111,
      });

      const mockGetAccountOwnerByDidPkh = vi.mocked(getAccountOwnerByDidPkh);
      mockGetAccountOwnerByDidPkh.mockRejectedValue(new Error('RPC error'));

      const encodedDid = encodeURIComponent('did:pkh:11155111:0x1234567890123456789012345678901234567890');
      const request = createMockRequest(`http://localhost:3000/api/accounts/owner/by-account/${encodedDid}`);
      const params = createMockParamsAsync({ 'did:pkh': encodedDid });

      const response = await GET(request, params);
      const data = await assertJsonResponse(response, 500);

      expect(data).toMatchObject({
        error: 'Failed to get account owner',
      });
      expect(data.message).toBeDefined();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
