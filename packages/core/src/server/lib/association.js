/**
 * Association utility functions for encoding/decoding association metadata
 */
import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters } from 'viem';
/**
 * Encode association type and description into bytes for ERC-8092 association data field
 */
export function encodeAssociationData(params) {
    return encodeAbiParameters(parseAbiParameters('uint8 assocType, string description'), [params.assocType, params.description]);
}
/**
 * Decode association type and description from ERC-8092 association data field
 */
export function decodeAssociationData(data) {
    try {
        const [assocType, description] = decodeAbiParameters(parseAbiParameters('uint8 assocType, string description'), data);
        return { assocType: Number(assocType), description };
    }
    catch (e) {
        console.warn('[Association] Failed to decode association data:', e);
        return null;
    }
}
//# sourceMappingURL=association.js.map