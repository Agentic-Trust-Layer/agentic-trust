import { NextRequest, NextResponse } from 'next/server';
import { buildDidEthr } from '@agentic-trust/core';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentAccount, chainId } = body;

    if (!agentAccount || typeof agentAccount !== 'string') {
      return NextResponse.json(
        { error: 'agentAccount is required' },
        { status: 400 }
      );
    }

    if (!chainId || typeof chainId !== 'number') {
      return NextResponse.json(
        { error: 'chainId is required' },
        { status: 400 }
      );
    }

    // Build did:ethr for the agent account
    const didEthr = buildDidEthr(chainId, agentAccount as `0x${string}`);

    // Generate UAID using HCS-14 DID target form
    // uaid:did: wraps an existing W3C DID (no new hash), and then you add HCS-14 routing parameters
    try {
      const { HCS14Client } = await import('@hashgraphonline/standards-sdk');
      const hcs14 = new HCS14Client();
      
      // Try DID target form: wrap the did:ethr DID with routing parameters
      // The HCS-14 DID target form uses the DID directly as the identifier
      let uaid: string | null = null;
      
      // Try different methods - the API might vary
      if (typeof (hcs14 as any).createUaidFromDid === 'function') {
        uaid = await (hcs14 as any).createUaidFromDid(
          didEthr,
          {
            registry: 'agentic-trust',
            protocol: 'a2a',
          }
        );
      } else if (typeof (hcs14 as any).createUaid === 'function') {
        // Fallback: try using createUaid with DID as nativeId
        uaid = await (hcs14.createUaid as any)(
          {
            registry: 'agentic-trust',
            protocol: 'a2a',
            nativeId: didEthr,
          },
          { did: didEthr }
        );
      }

      if (uaid) {
        return NextResponse.json({ uaid });
      } else {
        // If UAID generation isn't available, return the DID for display
        return NextResponse.json({ 
          uaid: null,
          didEthr,
          note: 'UAID generation will occur during registration'
        });
      }
    } catch (error) {
      console.warn('[generate-uaid] Failed to generate UAID:', error);
      // Return the did:ethr as fallback
      return NextResponse.json(
        { 
          uaid: null,
          didEthr,
          note: 'UAID will be generated during registration'
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error('[generate-uaid] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

