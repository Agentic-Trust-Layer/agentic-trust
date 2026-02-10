function encodeParamValue(value) {
    // UAID params are delimited with ';' and '='. We only encode the characters that
    // would break parsing, while keeping CAIP-10 / DID strings human-readable.
    return value
        .replace(/%/g, '%25')
        .replace(/;/g, '%3B')
        .replace(/=/g, '%3D');
}
function didMethodSpecificId(did) {
    const decoded = decodeURIComponent((did || '').trim());
    if (!decoded) {
        throw new Error('Missing DID');
    }
    const parts = decoded.split(':');
    // did:<method>:<method-specific-id...>
    if (parts.length < 3 || parts[0] !== 'did') {
        throw new Error(`Invalid DID: ${decoded}`);
    }
    // UAID DID-target idPart must be "<method>:<method-specific-id...>" so that
    // parseHcs14UaidDidTarget can reconstruct "did:<method>:..." correctly.
    // Example targetDid "did:ethr:11155111:0xabc..." => idPart "ethr:11155111:0xabc..."
    return parts.slice(1).join(':');
}
/**
 * Generate an HCS-14 UAID in DID-target form:
 *   uaid:did:<did:ethr...>;uid=...;registry=...;proto=...;nativeId=...;domain=...
 *
 * This allows construction *before* ERC-8004 identity registration, since the
 * agent account DID (did:ethr) exists prior to minting the identity NFT.
 */
export async function generateHcs14UaidDidTarget(params) {
    const targetDid = String(params.targetDid ?? '').trim();
    const methodSpecificId = didMethodSpecificId(targetDid);
    const routing = params.routing || {};
    const parts = [];
    for (const [key, value] of Object.entries(routing)) {
        if (value === undefined || value === null)
            continue;
        const trimmed = String(value).trim();
        if (!trimmed)
            continue;
        parts.push(`${key}=${encodeParamValue(trimmed)}`);
    }
    const suffix = parts.length > 0 ? `;${parts.join(';')}` : '';
    return {
        // For uaid:did, {id} is "<method>:<methodSpecificId...>" (no leading "did:").
        uaid: `uaid:did:${methodSpecificId}${suffix}`,
    };
}
//# sourceMappingURL=uaid.js.map