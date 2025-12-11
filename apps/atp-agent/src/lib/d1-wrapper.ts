/**
 * Cloudflare D1 Database Wrapper
 * 
 * Handles both native binding (Cloudflare Workers) and Wrangler CLI fallback
 * for local development and remote D1 access.
 */

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Result<T = unknown> {
  success: boolean;
  meta: {
    duration: number;
    rows_read: number;
    rows_written: number;
    last_row_id: number;
    changed_db: boolean;
    changes: number;
  };
  results?: T[];
  error?: string;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

/**
 * Get D1 database instance
 * Supports both native binding (Cloudflare Workers) and remote D1 via Wrangler
 */
export function getD1Database(env?: { DB?: D1Database; INDEXER_DB?: D1Database }): D1Database {
  // Check if D1 is passed via env (from Worker bindings)
  if (env?.DB) {
    return env.DB;
  }

  // Check if we're in a Cloudflare Workers environment (native binding)
  if (typeof (globalThis as any).env !== 'undefined' && (globalThis as any).env.DB) {
    return (globalThis as any).env.DB;
  }

  // Check for direct binding (alternative Workers pattern)
  if (typeof (globalThis as any).DB !== 'undefined') {
    return (globalThis as any).DB;
  }

  // For local development or remote D1, use Wrangler CLI
  // This requires wrangler to be installed and configured
  if (typeof process !== 'undefined' && process.env.USE_REMOTE_D1 === 'true') {
    return createRemoteD1Database();
  }

  // Fallback: try to use wrangler d1 execute for local development
  // This is a simplified fallback - in production, you'd use Cloudflare Workers
  throw new Error(
    'D1 database not available. ' +
    'Set USE_REMOTE_D1=true and configure CLOUDFLARE_* environment variables, ' +
    'or run in a Cloudflare Workers environment with D1 binding.'
  );
}

/**
 * Get indexer D1 database instance
 * Supports both native binding (Cloudflare Workers) and remote D1 via Wrangler
 */
export function getIndexerD1Database(env?: { INDEXER_DB?: D1Database }): D1Database | null {
  // Check if INDEXER_DB is passed via env (from Worker bindings)
  if (env?.INDEXER_DB) {
    return env.INDEXER_DB;
  }

  // Check if we're in a Cloudflare Workers environment (native binding)
  if (typeof (globalThis as any).env !== 'undefined' && (globalThis as any).env.INDEXER_DB) {
    return (globalThis as any).env.INDEXER_DB;
  }

  // Check for direct binding (alternative Workers pattern)
  if (typeof (globalThis as any).INDEXER_DB !== 'undefined') {
    return (globalThis as any).INDEXER_DB;
  }

  // For local development or remote D1, try to create remote indexer database
  if (typeof process !== 'undefined' && process.env.USE_REMOTE_D1 === 'true') {
    try {
      return createRemoteIndexerD1Database();
    } catch (error) {
      console.warn('[D1 Wrapper] Indexer database not available:', error);
      return null;
    }
  }

  return null;
}

/**
 * Create a remote indexer D1 database instance using Cloudflare API
 */
function createRemoteIndexerD1Database(): D1Database {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const indexerDatabaseId = process.env.CLOUDFLARE_INDEXER_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !indexerDatabaseId || !apiToken) {
    throw new Error(
      'Missing Cloudflare Indexer D1 configuration. ' +
      'Required: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_INDEXER_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN'
    );
  }

  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${indexerDatabaseId}`;

  // Create a proxy object that implements D1Database interface
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      return createRemotePreparedStatement(query, baseUrl, apiToken);
    },
    async exec(query: string): Promise<D1ExecResult> {
      const response = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: query,
          params: [],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`D1 exec failed: ${error}`);
      }

      const result = await response.json();
      return {
        count: result.length || 0,
        duration: 0,
      };
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        const result = await stmt.run<T>();
        results.push(result);
      }
      return results;
    },
  };

  return db;
}

/**
 * Create a remote D1 database instance using Cloudflare API
 * This uses the Cloudflare REST API to execute queries
 */
function createRemoteD1Database(): D1Database {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const databaseName = process.env.CLOUDFLARE_D1_DATABASE_NAME || 'atp';

  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      'Missing Cloudflare D1 configuration. ' +
      'Required: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN'
    );
  }

  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;

  // Create a proxy object that implements D1Database interface
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      return createRemotePreparedStatement(query, baseUrl, apiToken);
    },
    async exec(query: string): Promise<D1ExecResult> {
      // For exec, we'll use the query endpoint
      const response = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: query,
          params: [],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`D1 exec failed: ${error}`);
      }

      const result = await response.json();
      return {
        count: result.length || 0,
        duration: 0, // API doesn't provide duration
      };
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      // Execute statements sequentially (Cloudflare API doesn't support true batching)
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        const result = await stmt.run<T>();
        results.push(result);
      }
      return results;
    },
  };

  return db;
}

/**
 * Create a remote prepared statement
 */
function createRemotePreparedStatement(
  query: string,
  baseUrl: string,
  apiToken: string
): D1PreparedStatement {
  let boundParams: unknown[] = [];

  const executeQuery = async (): Promise<any> => {
    const response = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql: query,
        params: boundParams,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `D1 query failed: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    
    // Cloudflare D1 API returns { result: [[...], {...}] } format
    // First array is results, second object is metadata
    if (result.result && Array.isArray(result.result)) {
      const [results, meta] = result.result;
      return {
        results: Array.isArray(results) ? results : [],
        meta: meta || {},
      };
    }
    
    // Fallback: assume direct array or object
    return {
      results: Array.isArray(result) ? result : (result.results || []),
      meta: result.meta || {},
    };
  };

  const stmt: D1PreparedStatement = {
    bind(...values: unknown[]): D1PreparedStatement {
      boundParams = values;
      return stmt;
    },
    async first<T = unknown>(colName?: string): Promise<T | null> {
      const { results } = await executeQuery();
      if (!results || !Array.isArray(results) || results.length === 0) {
        return null;
      }

      const firstRow = results[0];
      if (colName) {
        return (firstRow as any)[colName] as T;
      }
      return firstRow as T;
    },
    async run<T = unknown>(): Promise<D1Result<T>> {
      const { results, meta } = await executeQuery();
      return {
        success: true,
        meta: {
          duration: meta.duration || 0,
          rows_read: meta.rows_read || (Array.isArray(results) ? results.length : 0),
          rows_written: meta.rows_written || 0,
          last_row_id: meta.last_row_id || 0,
          changed_db: meta.changed_db || false,
          changes: meta.changes || 0,
        },
        results: (Array.isArray(results) ? results : []) as T[],
      };
    },
    async all<T = unknown>(): Promise<D1Result<T>> {
      return stmt.run<T>();
    },
  };

  return stmt;
}

