/**
 * Vitest Setup File
 * 
 * This file runs before all tests and sets up the testing environment.
 * Use this to configure mocks, global test utilities, and environment variables.
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Mock Next.js cookies
vi.mock('next/headers', async () => {
  const actual = await vi.importActual('next/headers');
  return {
    ...actual,
    cookies: vi.fn(() => {
      const cookies = new Map<string, string>();
      return {
        get: vi.fn((name: string) => {
          const value = cookies.get(name);
          return value ? { value, name } : undefined;
        }),
        set: vi.fn((name: string, value: string, options?: any) => {
          cookies.set(name, value);
        }),
        delete: vi.fn((name: string) => {
          cookies.delete(name);
        }),
        has: vi.fn((name: string) => cookies.has(name)),
        getAll: vi.fn(() => Array.from(cookies.entries()).map(([name, value]) => ({ name, value }))),
      };
    }),
  };
});

// Set up environment variables for testing
process.env.NODE_ENV = 'test';
process.env.AGENTIC_TRUST_DISCOVERY_API_KEY = process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || 'test-api-key';
process.env.AGENTIC_TRUST_DISCOVERY_URL = process.env.AGENTIC_TRUST_DISCOVERY_URL || 'https://test-discovery-url.com';

// Clear all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Cleanup after each test
afterEach(() => {
  vi.restoreAllMocks();
});

// Global test utilities can be added here
// Example: Global mock for @agentic-trust/core can be configured per test file

