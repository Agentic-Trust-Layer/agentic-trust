/**
 * Server-side API route for submitting feedback
 * Handles reputation contract calls on the server side
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/server-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, score, feedback, feedbackAuth, tag1, tag2, feedbackUri, feedbackHash, clientAddress: providedClientAddress } = body;

    // Validate required fields
    if (!agentId || score === undefined || !feedbackAuth) {
      return NextResponse.json(
        { error: 'Missing required fields: agentId, score, feedbackAuth' },
        { status: 400 }
      );
    }

    // Decode feedbackAuth to extract clientAddress if not provided
    // feedbackAuth format: encoded(FeedbackAuth struct) + signature
    // FeedbackAuth struct: (uint256 agentId, address clientAddress, uint256 indexLimit, uint256 expiry, uint256 chainId, address identityRegistry, address signerAddress)
    let clientAddress = providedClientAddress;
    
    if (!clientAddress && feedbackAuth && typeof feedbackAuth === 'string' && feedbackAuth.startsWith('0x')) {
      try {
        // The encoded tuple is the first part (before signature)
        // Signature is typically 65 bytes (0x41 in hex), so encoded tuple ends at position -130
        // But we can decode the first ~128 bytes to get the struct
        const { AbiCoder } = await import('ethers');
        const abiCoder = AbiCoder.defaultAbiCoder();
        
        // The encoded tuple is at the start of feedbackAuth
        // We need to extract just the encoded part (without signature)
        // Signature is 65 bytes = 130 hex characters
        // So encoded part is feedbackAuth.slice(0, -130)
        const encodedLength = feedbackAuth.length - 130; // Remove 65-byte signature
        const encodedPart = feedbackAuth.slice(0, encodedLength);
        
        // Decode the tuple: (uint256, address, uint256, uint256, uint256, address, address)
        const decoded = abiCoder.decode(
          ['uint256', 'address', 'uint256', 'uint256', 'uint256', 'address', 'address'],
          encodedPart
        );
        
        // clientAddress is at index 1
        clientAddress = decoded[1];
        console.log(`Extracted clientAddress from feedbackAuth: ${clientAddress}`);
      } catch (decodeError) {
        console.warn('Failed to decode clientAddress from feedbackAuth:', decodeError);
      }
    }

    // Get server-side client
    const client = await getServerClient();

    if (!client.reputation.isInitialized()) {
      return NextResponse.json(
        { error: 'Reputation client not initialized on server' },
        { status: 500 }
      );
    }

    const reputationClient = client.reputation.getClient();

    // Get the actual client address from the reputation client (for logging)
    // Note: clientAdapter is private, so we use unknown for type assertion
    const clientAdapter = (reputationClient as unknown as { clientAdapter?: { getAddress: () => Promise<string> } }).clientAdapter;
    const actualClientAddress = clientAdapter ? await clientAdapter.getAddress() : null;
    
    // Log the addresses for debugging
    console.log('Feedback submission:', {
      clientAddressFromAuth: clientAddress,
      actualClientAddressFromAdapter: actualClientAddress,
      match: clientAddress?.toLowerCase() === actualClientAddress?.toLowerCase(),
    });

    // Submit feedback using the auth signature
    const feedbackResult = await reputationClient.giveClientFeedback({
      agent: agentId.toString(),
      agentId: agentId.toString(),
      score: typeof score === 'number' ? score : parseInt(score, 10),
      feedback: feedback || 'Feedback submitted via web client',
      feedbackAuth: feedbackAuth,
      tag1,
      tag2,
      feedbackUri,
      feedbackHash,
    });

    return NextResponse.json({
      success: true,
      txHash: feedbackResult.txHash,
      clientAddress: actualClientAddress,
    });
  } catch (error: unknown) {
    console.error('Error submitting feedback:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { 
        error: 'Failed to submit feedback',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

