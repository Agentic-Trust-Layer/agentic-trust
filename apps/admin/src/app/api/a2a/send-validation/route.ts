export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy A2A validation request to avoid browser port restrictions
 * Chrome blocks certain ports (like 6000) for security reasons
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { a2aEndpoint, skillId, message, payload } = body;

    if (!a2aEndpoint) {
      return NextResponse.json(
        { error: 'A2A agent card URL (agent.json) is required' },
        { status: 400 }
      );
    }

    if (!skillId || !message || !payload) {
      return NextResponse.json(
        { error: 'skillId, message, and payload are required' },
        { status: 400 }
      );
    }

    const toAgentJsonUrl = (input: string): string => {
      const url = new URL(input);
      const origin = url.origin;
      const path = url.pathname || '';
      // If already an agent.json / agent-card.json URL, keep verbatim. Otherwise, use canonical well-known path.
      if (/\/agent-card\.json\/?$/i.test(path) || /\/agent\.json\/?$/i.test(path)) return url.toString();
      return `${origin}/.well-known/agent-card.json`;
    };

    const extractA2AMessageEndpoint = (agentJson: any, agentJsonUrl: string): string | null => {
      const baseOrigin = new URL(agentJsonUrl).origin.replace(/\/$/, '');
      const normalize = (raw: any): string | null => {
        const s = typeof raw === 'string' ? raw.trim() : '';
        if (!s) return null;
        if (s.startsWith('http://') || s.startsWith('https://')) {
          try {
            const u = new URL(s);
            // If the URL is just a bare origin ("/"), treat it as not an explicit message endpoint.
            if (!u.pathname || u.pathname === '/' || u.pathname === '') return null;
          } catch {
            // If parsing fails, fall through and still normalize by trimming.
          }
          return s.replace(/\/$/, '');
        }
        if (s.startsWith('/')) return `${baseOrigin}${s}`.replace(/\/$/, '');
        return `${baseOrigin}/${s.replace(/^\/+/, '')}`.replace(/\/$/, '');
      };

      // Prefer v1.0 supportedInterfaces (JSON-RPC first, then HTTP+JSON)
      if (Array.isArray(agentJson?.supportedInterfaces)) {
        const interfaces = agentJson.supportedInterfaces as any[];
        const pick = (binding: string) =>
          interfaces.find((x: any) => String(x?.protocolBinding || '') === binding)?.url;
        const fromInterfaces = normalize(pick('JSONRPC') ?? pick('HTTP+JSON'));
        if (fromInterfaces) return fromInterfaces;
      }

      // Prefer explicit provider.url (common A2A agent.json shape)
      const fromProviderUrl = normalize(agentJson?.provider?.url);
      if (fromProviderUrl) return fromProviderUrl;

      // Alternate shapes supported for robustness
      if (Array.isArray(agentJson?.endpoints)) {
        const entry = agentJson.endpoints.find(
          (e: any) => String(e?.name || '').toLowerCase() === 'a2a',
        );
        const fromArray = normalize(entry?.url ?? entry?.endpoint);
        if (fromArray) return fromArray;
      }
      const fromObject = normalize(agentJson?.endpoints?.a2a);
      if (fromObject) return fromObject;

      return null;
    };

    // Load agent.json (agent card) first, then send the message to the declared A2A message endpoint.
    const agentJsonUrlRaw = toAgentJsonUrl(String(a2aEndpoint));
    const agentJsonUrl =
      agentJsonUrlRaw.includes('localhost')
        ? agentJsonUrlRaw.replace(/localhost/g, '127.0.0.1')
        : agentJsonUrlRaw;

    console.log('[API] Loading agent.json for A2A proxy:', agentJsonUrl);

    // Use native http/https for agent.json too (avoids fetch issues with blocked ports / localhost)
    const agentJsonUrlObj = new URL(agentJsonUrl);
    const agentJsonIsHttps = agentJsonUrlObj.protocol === 'https:';
    const agentJsonHttpModule = agentJsonIsHttps ? await import('https') : await import('http');
    const agentJson = await new Promise<any>((resolve, reject) => {
      const options = {
        hostname: agentJsonUrlObj.hostname,
        port: agentJsonUrlObj.port || (agentJsonIsHttps ? 443 : 80),
        path: agentJsonUrlObj.pathname + agentJsonUrlObj.search,
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      };
      const req = agentJsonHttpModule.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error(
                `Failed to fetch agent.json (HTTP ${res.statusCode} ${res.statusMessage || ''})`,
              ),
            );
          }
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e: any) {
            reject(new Error(`Failed to parse agent.json: ${e?.message || 'unknown error'}`));
          }
        });
      });
      req.on('error', (error) => reject(new Error(`HTTP request failed: ${error.message}`)));
      req.end();
    });

    const messageEndpoint = extractA2AMessageEndpoint(agentJson, agentJsonUrl);
    if (!messageEndpoint) {
      return NextResponse.json(
        { error: 'agent.json did not declare an A2A message endpoint (provider.url or endpoints.a2a).' },
        { status: 400 },
      );
    }

    // Normalize localhost to 127.0.0.1 for better Node.js compatibility
    let normalizedEndpoint = messageEndpoint;
    if (messageEndpoint.includes('localhost')) {
      normalizedEndpoint = messageEndpoint.replace(/localhost/g, '127.0.0.1');
    }

    console.log('[API] Proxying A2A validation request to message endpoint:', normalizedEndpoint);

    // Use native http/https modules to avoid fetch issues with localhost ports
    const url = new URL(normalizedEndpoint);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps 
      ? await import('https')
      : await import('http');

    const requestBody = JSON.stringify({
      skillId,
      message,
      payload,
    });

    const response = await new Promise<{ statusCode?: number; statusMessage?: string; data: any }>((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      };

      const req = httpModule.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = data ? JSON.parse(data) : {};
            resolve({
              statusCode: res.statusCode,
              statusMessage: res.statusMessage,
              data: jsonData,
            });
          } catch (parseError) {
            resolve({
              statusCode: res.statusCode,
              statusMessage: res.statusMessage,
              data: { error: 'Failed to parse response', raw: data },
            });
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`HTTP request failed: ${error.message}`));
      });

      req.write(requestBody);
      req.end();
    });

    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      return NextResponse.json(
        {
          success: false,
          error: response.data?.error || response.data?.response?.error || `Request failed: ${response.statusCode} ${response.statusMessage}`,
        },
        { status: response.statusCode || 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('[API] Error proxying A2A validation request:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send validation request',
      },
      { status: 500 }
    );
  }
}

