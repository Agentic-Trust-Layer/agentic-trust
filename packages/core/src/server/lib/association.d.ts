/**
 * Association utility functions for encoding/decoding association metadata
 */
/**
 * Encode association type and description into bytes for ERC-8092 association data field
 */
export declare function encodeAssociationData(params: {
    assocType: number;
    description: string;
}): `0x${string}`;
/**
 * Decode association type and description from ERC-8092 association data field
 */
export declare function decodeAssociationData(data: `0x${string}`): {
    assocType: number;
    description: string;
} | null;
//# sourceMappingURL=association.d.ts.map