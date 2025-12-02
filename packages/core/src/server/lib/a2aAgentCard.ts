import type { A2AAgentCard } from '../models/a2aAgentCardInfo';
import { request } from 'http';
import { request as httpsRequest } from 'https';

/**
 * Fetch agent-card.json from a URL
 * Supports both direct URLs and base URLs (will append /.well-known/agent-card.json)
 */
export async function fetchA2AAgentCard(cardUrl: string): Promise<A2AAgentCard | null> {
  try {
    // Normalize the URL - handle both full URLs and base URLs
    let url = cardUrl?.trim() ?? '';
    if (!url) {
      throw new Error('Agent card URL is empty');
    }
    let urlObj: URL = new URL(url);

    /*
    // Support scheme-less inputs like "agent.example.com" or "//agent.example.com"
    if (normalizedUrl.startsWith('//')) {
      normalizedUrl = `https:${normalizedUrl}`;
    } else if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl.replace(/^\/+/, '')}`;
    }

    // Parse the URL to handle it properly
    let urlObj: URL;
    try {
      urlObj = new URL(normalizedUrl);
    } catch (urlError) {
      throw new Error(
        `Invalid URL format: ${normalizedUrl}. ${
          urlError instanceof Error ? urlError.message : 'Unknown error'
        }`,
      );
    }

    // Normalize localhost to 127.0.0.1 for better Node.js compatibility
    if (urlObj.hostname === 'localhost') {
      urlObj.hostname = '127.0.0.1';
    }

    // If URL doesn't already point to agent-card.json, append the standard path
    if (!urlObj.pathname.includes('agent-card.json')) {
      // Remove trailing slash from pathname and append the standard path
      const basePath = urlObj.pathname.replace(/\/$/, '');
      urlObj.pathname = `${basePath}/.well-known/agent-card.json`;
    }

    const url = urlObj.toString();
    */
    console.log('[fetchA2AAgentCard] Fetching from:', url);
    
    // Try fetch first, fallback to native http/https if it fails
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        // Disable any HTTP caching so we always hit the live provider
        cache: 'no-store',
      });
    } catch (fetchError) {
      // If fetch fails (e.g., "bad port" error with localhost), try native http/https
      console.warn('[fetchA2AAgentCard] Fetch failed, trying native http/https:', fetchError);
      const card = await fetchWithNativeHttp(urlObj);
      return card;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch agent card: ${response.status} ${response.statusText}`);
    }

    const card: A2AAgentCard = await response.json();
    return card;
  } catch (error) {
    console.error('[fetchA2AAgentCard] Error fetching agent card:', error);
    if (error instanceof Error) {
      console.error('[fetchA2AAgentCard] Error details:', {
        message: error.message,
        stack: error.stack,
        cardUrl,
      });
    }
    return null;
  }
}

/**
 * Fallback: Use native Node.js http/https modules when fetch fails
 */
async function fetchWithNativeHttp(urlObj: URL): Promise<A2AAgentCard> {
  return new Promise((resolve, reject) => {
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? httpsRequest : request;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    };

    const req = httpModule(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const card: A2AAgentCard = JSON.parse(data);
            resolve(card);
          } catch (parseError) {
            reject(new Error(`Failed to parse agent card JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`));
          }
        } else {
          reject(new Error(`Failed to fetch agent card: ${res.statusCode} ${res.statusMessage || 'Unknown error'}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`HTTP request failed: ${error.message}`));
    });

    req.end();
  });
}

