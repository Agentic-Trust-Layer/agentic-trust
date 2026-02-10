export type Hcs14RoutingParams = {
    registry?: string;
    proto?: string;
    nativeId?: string;
    uid?: string;
    domain?: string;
    src?: string;
};
/**
 * Generate an HCS-14 UAID in DID-target form:
 *   uaid:did:<method>:<methodSpecificId...>;uid=...;registry=...;proto=...;nativeId=...;domain=...
 *
 * This allows construction *before* ERC-8004 identity registration, since the
 * agent account DID (did:ethr) exists prior to minting the identity NFT.
 */
export declare function generateHcs14UaidDidTarget(params: {
    targetDid: string;
    routing: Hcs14RoutingParams;
}): Promise<{
    uaid: string;
}>;
//# sourceMappingURL=uaid.d.ts.map