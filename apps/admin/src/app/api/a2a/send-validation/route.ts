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
        { error: 'A2A endpoint is required' },
        { status: 400 }
      );
    }

    if (!skillId || !message || !payload) {
      return NextResponse.json(
        { error: 'skillId, message, and payload are required' },
        { status: 400 }
      );
    }

    // Normalize localhost to 127.0.0.1 for better Node.js compatibility
    let normalizedEndpoint = a2aEndpoint;
    if (a2aEndpoint.includes('localhost')) {
      normalizedEndpoint = a2aEndpoint.replace(/localhost/g, '127.0.0.1');
    }

    console.log('[API] Proxying A2A validation request to:', normalizedEndpoint);

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

