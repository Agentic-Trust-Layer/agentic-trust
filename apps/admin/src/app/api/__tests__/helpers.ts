/**
 * Test helpers for API route testing
 */

import { NextRequest } from 'next/server';
import { expect, vi } from 'vitest';

/**
 * Create a mock NextRequest for testing
 * 
 * NOTE: This does NOT make any HTTP requests. It only creates a NextRequest object
 * that is passed directly to the route handler function. No server needs to be running.
 * 
 * The URL is only used to:
 * - Parse the pathname and search params
 * - Construct the NextRequest object that Next.js route handlers expect
 * 
 * @param url - The URL (can be absolute like http://localhost:3000/api/... or relative like /api/...)
 * @param options - Request options (method, headers, body, searchParams)
 * @returns A NextRequest object suitable for testing route handlers
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    searchParams?: URLSearchParams | Record<string, string>;
  } = {}
): NextRequest {
  const { method = 'GET', headers = {}, body, searchParams } = options;

  const headerObj = new Headers();
  Object.entries(headers).forEach(([key, value]) => {
    headerObj.set(key, value);
  });

  // Handle search params
  // Use a test base URL - this is only for URL parsing, no actual HTTP request is made
  // The base URL can be anything since we're calling route handlers directly
  const baseUrl = url.startsWith('http') ? undefined : 'http://test.example';
  const urlObj = baseUrl ? new URL(url, baseUrl) : new URL(url);
  if (searchParams) {
    if (searchParams instanceof URLSearchParams) {
      searchParams.forEach((value, key) => {
        urlObj.searchParams.set(key, value);
      });
    } else {
      Object.entries(searchParams).forEach(([key, value]) => {
        urlObj.searchParams.set(key, value);
      });
    }
  }

  const requestInit: RequestInit = {
    method,
    headers: headerObj,
  };

  if (body) {
    if (typeof body === 'string') {
      requestInit.body = body;
    } else {
      requestInit.body = JSON.stringify(body);
      if (!headers['Content-Type']) {
        headerObj.set('Content-Type', 'application/json');
      }
    }
  }

  return new NextRequest(urlObj, requestInit);
}

/**
 * Create mock route params for Next.js App Router (synchronous)
 */
export function createMockParams<T extends Record<string, string>>(
  params: T
): { params: T } {
  return { params };
}

/**
 * Create mock route params for Next.js App Router (async)
 */
export function createMockParamsAsync<T extends Record<string, string>>(
  params: T
): { params: Promise<T> } {
  return {
    params: Promise.resolve(params),
  };
}

/**
 * Extract JSON from NextResponse
 */
export async function extractJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Assert response is JSON with expected status
 */
export async function assertJsonResponse(
  response: Response,
  expectedStatus: number
): Promise<any> {
  expect(response.status).toBe(expectedStatus);
  const contentType = response.headers.get('content-type');
  if (contentType) {
    expect(contentType).toContain('application/json');
  }
  return extractJson(response);
}

/**
 * Mock Next.js cookies
 */
export function createMockCookies(initialCookies: Record<string, string> = {}) {
  const cookies = new Map<string, string>(Object.entries(initialCookies));

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
    clear: vi.fn(() => cookies.clear()),
  };
}

/**
 * Mock Next.js headers
 */
export function createMockHeaders(headers: Record<string, string> = {}) {
  const headerMap = new Map<string, string>(Object.entries(headers));

  return {
    get: vi.fn((name: string) => headerMap.get(name.toLowerCase()) || null),
    has: vi.fn((name: string) => headerMap.has(name.toLowerCase())),
    set: vi.fn((name: string, value: string) => {
      headerMap.set(name.toLowerCase(), value);
    }),
    append: vi.fn((name: string, value: string) => {
      const existing = headerMap.get(name.toLowerCase());
      headerMap.set(name.toLowerCase(), existing ? `${existing}, ${value}` : value);
    }),
    delete: vi.fn((name: string) => {
      headerMap.delete(name.toLowerCase());
    }),
    entries: vi.fn(() => headerMap.entries()),
    keys: vi.fn(() => headerMap.keys()),
    values: vi.fn(() => headerMap.values()),
  };
}

/**
 * Wait for async params to resolve
 */
export async function resolveParams<T>(params: Promise<T> | T): Promise<T> {
  return Promise.resolve(params);
}

/**
 * Create a mock environment for testing
 * Note: Use this with beforeEach/afterEach in your test file
 */
export function createTestEnv(env: Record<string, string> = {}) {
  const originalEnv = { ...process.env };
  
  return {
    setup: () => {
      Object.assign(process.env, env);
    },
    teardown: () => {
      process.env = originalEnv;
    },
  };
}

/**
 * Assert error response
 */
export async function assertErrorResponse(
  response: Response,
  expectedStatus: number,
  expectedError?: string
): Promise<any> {
  const data = await assertJsonResponse(response, expectedStatus);
  expect(data).toHaveProperty('error');
  if (expectedError) {
    expect(data.error).toBe(expectedError);
  }
  return data;
}

/**
 * Assert success response
 */
export async function assertSuccessResponse(
  response: Response,
  expectedStatus: number = 200
): Promise<any> {
  const data = await assertJsonResponse(response, expectedStatus);
  expect(data).not.toHaveProperty('error');
  return data;
}

