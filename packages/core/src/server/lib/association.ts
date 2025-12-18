/**
 * Association utility functions for encoding/decoding association metadata
 */

import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters } from 'viem';

/**
 * Encode association type and description into bytes for ERC-8092 association data field
 */
export function encodeAssociationData(params: {
  assocType: number;
  description: string;
}): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters('uint8 assocType, string description'),
    [params.assocType, params.description]
  );
}

/**
 * Decode association type and description from ERC-8092 association data field
 */
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
