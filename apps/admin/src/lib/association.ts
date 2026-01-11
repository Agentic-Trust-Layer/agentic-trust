/**
 * Association utilities
 * Re-exports from @agentic-trust/8092-sdk
 */
export { buildSignedAssociation } from '@agentic-trust/8092-sdk';

/**
 * Encode association metadata (type and description) for on-chain storage
 */
import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters } from 'viem';
import type { AssocType } from './association-types';

export function encodeAssociationData(params: {
  assocType: AssocType | number;
  description: string;
}): `0x${string}` {
  console.log('[encodeAssociationData] Encoding:', {
    assocType: params.assocType,
    descriptionLength: params.description.length,
  });
  const result = encodeAbiParameters(
    parseAbiParameters('uint8 assocType, string description'),
    [params.assocType, params.description]
  );
  console.log('[encodeAssociationData] Encoded result:', {
    length: result.length,
    preview: result.substring(0, 20) + '...',
  });
  return result;
}

export function decodeAssociationData(data: `0x${string}`): { assocType: number; description: string } | null {
  try {
    const [assocType, description] = decodeAbiParameters(
      parseAbiParameters('uint8 assocType, string description'),
      data
    );
    return { assocType: Number(assocType), description };
  } catch (e) {
    console.warn('[Association] Failed to decode association data:', e);
    return null;
  }
}
