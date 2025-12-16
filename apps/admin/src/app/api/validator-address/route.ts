export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createValidatorAccountAbstraction } from '@agentic-trust/core/server';
import { DEFAULT_CHAIN_ID } from '@agentic-trust/core/server';

/**
 * Get validator address from validator name
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const validatorName = searchParams.get('validatorName');
    const chainIdParam = searchParams.get('chainId');
    
    if (!validatorName) {
      return NextResponse.json(
        { error: 'validatorName parameter is required' },
        { status: 400 },
      );
    }

    const chainId = chainIdParam ? Number.parseInt(chainIdParam, 10) : DEFAULT_CHAIN_ID;
    if (!Number.isFinite(chainId) || chainId <= 0) {
      return NextResponse.json(
        { error: 'Invalid chainId' },
        { status: 400 },
      );
    }

    // Calculate validator address for the given validator name
    const validatorPrivateKey = process.env.AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY;
    if (!validatorPrivateKey) {
      return NextResponse.json(
        { error: 'AGENTIC_TRUST_VALIDATOR_PRIVATE_KEY not configured' },
        { status: 500 },
      );
    }

    const { address: validatorAddress } = await createValidatorAccountAbstraction(
      validatorName,
      validatorPrivateKey,
      chainId,
    );

    return NextResponse.json({
      validatorName,
      validatorAddress,
      chainId,
    });
  } catch (error) {
    console.error('[API] Error getting validator address:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to get validator address',
      },
      { status: 500 },
    );
  }
}
