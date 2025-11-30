export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getValidatorAddressValidations } from '@agentic-trust/core/server';

/**
 * Convert BigInt values to strings for JSON serialization
 */
function serializeValidation(validation: any): any {
  return {
    ...validation,
    agentId: typeof validation.agentId === 'bigint' ? validation.agentId.toString() : validation.agentId,
    lastUpdate: typeof validation.lastUpdate === 'bigint' ? validation.lastUpdate.toString() : validation.lastUpdate,
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const chainIdParam = searchParams.get('chainId');
    const validatorAddress = searchParams.get('validatorAddress');

    if (!chainIdParam || !validatorAddress) {
      return NextResponse.json(
        { error: 'chainId and validatorAddress are required' },
        { status: 400 },
      );
    }

    const chainId = Number.parseInt(chainIdParam, 10);
    if (!Number.isFinite(chainId) || chainId <= 0) {
      return NextResponse.json(
        { error: 'Invalid chainId' },
        { status: 400 },
      );
    }

    const validations = await getValidatorAddressValidations(chainId, validatorAddress);

    // Serialize BigInt values to strings
    const serializedValidations = validations.map(serializeValidation);

    return NextResponse.json({
      success: true,
      chainId,
      validatorAddress,
      validations: serializedValidations,
    });
  } catch (error) {
    console.error('[API] Error fetching validator validations:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch validator validations',
      },
      { status: 500 },
    );
  }
}

