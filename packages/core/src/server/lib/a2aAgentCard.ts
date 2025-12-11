import type { A2AAgentCard } from '../models/a2aAgentCardInfo';
import { request } from 'http';
import { request as httpsRequest } from 'https';

/**
 * Fetch agent.json from a URL
 * Supports both direct URLs and base URLs (will append /.well-known/agent.json)
 */
export async function fetchA2AAgentCard(cardUrl: string): Promise<A2AAgentCard | null> {
  try {
    // Normalize the URL - handle both full URLs and base URLs
    let url = cardUrl?.trim() ?? '';
    if (!url) {
      throw new Error('Agent card URL is empty');
    }
    // Support scheme-less inputs like "agent.example.com" or "//agent.example.com"
    if (url.startsWith('//')) {
      url = `https:${url}`;
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url.replace(/^\/+/, '')}`;
    }

    // Parse the URL to handle it properly
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch (urlError) {
      throw new Error(
        `Invalid URL format: ${url}. ${
          urlError instanceof Error ? urlError.message : 'Unknown error'
        }`,
      );
    }

    // Normalize localhost to 127.0.0.1 for better Node.js compatibility
    if (urlObj.hostname === 'localhost') {
      urlObj.hostname = '127.0.0.1';
    }

    // Agent descriptor is always at the base domain's /.well-known/agent.json
    // Extract the origin (protocol + hostname + port) and use that as the base
    // This ensures that even if the input is an A2A endpoint like /api/a2a,
    // we construct the agent.json from the base domain
    if (!urlObj.pathname.includes('agent.json')) {
      // Use the origin (base domain) and set path to /.well-known/agent.json
      // This works for both base URLs and protocol endpoint URLs (e.g., /api/a2a)
      urlObj.pathname = '/.well-known/agent.json';
    }

    const finalUrl = urlObj.toString();
    console.log('[fetchA2AAgentCard] Fetching from:', finalUrl);
    
    // Try fetch first, fallback to native http/https if it fails
    let response: Response;
    try {
      response = await fetch(finalUrl, {
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

