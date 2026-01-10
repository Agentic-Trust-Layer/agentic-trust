/**
 * Agent Feedback API
 *
 * Handles feedback authentication for agents
 */
import { ethers } from 'ethers';
import { getReputationRegistryClient } from '../singletons/reputationClient';
import { encodeAssociationData } from './association';
import { getIPFSStorage } from './ipfs';
// Cache for the ABI to avoid reloading it multiple times
let abiCache = null;
/**
 * Load IdentityRegistry ABI using dynamic import
 * NOTE: This function should only be called server-side (Next.js API routes)
 */
const getIdentityRegistryAbi = async () => {
    // Return cached ABI if available
    if (abiCache) {
        return abiCache;
    }
    try {
        // Dynamic import to avoid bundling JSON in client-side code if this module is tree-shaken improperly
        const mod = await import('@agentic-trust/8004-ext-sdk/abis/IdentityRegistry.json');
        abiCache = mod.default;
        return abiCache;
    }
    catch (error) {
        console.error('Failed to load IdentityRegistry ABI:', error);
        throw new Error(`Failed to load IdentityRegistry ABI: ${error instanceof Error ? error.message : String(error)}`);
    }
};
const U40_MAX = 1099511627775; // 2^40-1
function clampU40(n) {
    if (!Number.isFinite(n) || n < 0)
        return 0;
    return Math.min(Math.floor(n), U40_MAX);
}
function parseAgentAccountMetadata(value) {
    if (typeof value !== 'string')
        return null;
    const v = value.trim();
    if (!v)
        return null;
    // Supports CAIP-10: "eip155:<chainId>:0x..."
    if (v.startsWith('eip155:')) {
        const parts = v.split(':');
        const addr = parts[2];
        if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr))
            return ethers.getAddress(addr);
    }
    if (/^0x[a-fA-F0-9]{40}$/.test(v))
        return ethers.getAddress(v);
    return null;
}
function tryDecodeMetadataString(raw) {
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s)
            return null;
        // Many `getMetadata` implementations return bytes (0x...) that represent a UTF-8 string.
        // Try to decode that to a normal string first.
        if (s.startsWith('0x')) {
            try {
                return ethers.toUtf8String(ethers.getBytes(s));
            }
            catch {
                // Fall back to the raw hex string.
                return s;
            }
        }
        return s;
    }
    // Some decoders may return Uint8Array-like bytes.
    try {
        if (raw && typeof raw === 'object' && 'length' in raw) {
            return ethers.toUtf8String(raw);
        }
    }
    catch {
        // ignore
    }
    if (raw === null || raw === undefined)
        return null;
    return String(raw);
}
function toMinimalBigEndianBytes(n) {
    if (n === 0n)
        return new Uint8Array([0]);
    let hex = n.toString(16);
    if (hex.length % 2)
        hex = `0${hex}`;
    return ethers.getBytes(`0x${hex}`);
}
// Mirrors `InteroperableAddress.formatEvmV1(chainid, addr)` from the ERC-8092 reference.
function formatEvmV1(chainId, address) {
    const addr = ethers.getAddress(address);
    const chainRef = toMinimalBigEndianBytes(BigInt(chainId));
    const head = ethers.getBytes('0x00010000');
    const out = ethers.concat([
        head,
        new Uint8Array([chainRef.length]),
        chainRef,
        new Uint8Array([20]),
        ethers.getBytes(addr),
    ]);
    return ethers.hexlify(out);
}
function erc8092RecordDigest(rec) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const DOMAIN_TYPEHASH = ethers.id('EIP712Domain(string name,string version)');
    const NAME_HASH = ethers.id('AssociatedAccounts');
    const VERSION_HASH = ethers.id('1');
    const MESSAGE_TYPEHASH = ethers.id('AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)');
    const domainSeparator = ethers.keccak256(abiCoder.encode(['bytes32', 'bytes32', 'bytes32'], [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH]));
    const hashStruct = ethers.keccak256(abiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint40', 'uint40', 'bytes4', 'bytes32'], [
        MESSAGE_TYPEHASH,
        ethers.keccak256(rec.initiator),
        ethers.keccak256(rec.approver),
        rec.validAt,
        rec.validUntil,
        rec.interfaceId,
        ethers.keccak256(rec.data),
    ]));
    return ethers.keccak256(ethers.solidityPacked(['bytes2', 'bytes32', 'bytes32'], ['0x1901', domainSeparator, hashStruct]));
}
/**
 * Create feedback auth signature
 */
export async function createFeedbackAuth(params) {
    const { signedAuth } = await createFeedbackAuthInternal(params);
    return signedAuth;
}
/**
 * Create feedback auth signature and also produce a pre-signed ERC-8092 delegation association
 * record (approver signature only). The client can add the initiator signature and store it
 * on-chain to memorialize the delegation that grants rights to "give feedback".
 */
export async function createFeedbackAuthWithDelegation(params) {
    const { signedAuth, chainId, indexLimit, expiry, identityRegistry, authorityAddress, } = await createFeedbackAuthInternal(params);
    // Best-effort: build delegation association. If it fails, still return feedbackAuth.
    try {
        const chainIdNum = Number(chainId);
        if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
            throw new Error(`Invalid chainId for delegation association: ${String(chainId)}`);
        }
        // Approver is the *authority* we want the signature to be attributed to (agentAccount smart account).
        // The actual signature bytes are produced by `params.signer` and must validate via the authority's ERC-1271.
        const approverAddress = ethers.getAddress(String(authorityAddress || params.signer?.address || ''));
        const initiatorAddress = ethers.getAddress(params.clientAddress);
        // NOTE: We use validAt=0 to avoid "validAt in the future" edge-cases during on-chain store,
        // where some ERC-8092 store implementations may reject records with validAt > block.timestamp.
        const validAt = 0;
        // IMPORTANT: keep validUntil=0 for compatibility with the current server-side association store prep,
        // which always uses record.validUntil=0. Expiry is still embedded in the delegation payload.
        const validUntil = 0;
        const delegation = {
            kind: 'erc8004.feedbackAuth.delegation',
            feedbackAuth: signedAuth,
            agentId: params.agentId.toString(),
            clientAddress: initiatorAddress,
            chainId: chainIdNum,
            indexLimit: indexLimit.toString(),
            expiry: expiry.toString(),
            identityRegistry,
            // Authority address (agentAccount) that the on-chain verifier should attribute the delegation/auth to.
            signerAddress: approverAddress,
            // The key that produced the raw signature bytes (useful for debugging); the verifier should still
            // treat the signature as coming from `signerAddress` via ERC-1271.
            operatorAddress: ethers.getAddress(String(params.signer?.address || '')),
            createdAt: new Date().toISOString(),
        };
        // Upload the full delegation payload to IPFS so the ERC-8092 record can carry a small pointer.
        let payloadTokenUri = null;
        let payloadCid = null;
        try {
            const ipfs = getIPFSStorage();
            const upload = await ipfs.upload(JSON.stringify(delegation, null, 2), 'feedbackAuth-delegation.json');
            payloadCid = upload.cid;
            payloadTokenUri = upload.tokenUri; // ipfs://CID
        }
        catch (ipfsErr) {
            console.warn('[createFeedbackAuthWithDelegation] Failed to upload delegation payload to IPFS (continuing):', ipfsErr);
        }
        const delegationRef = {
            type: 'erc8004.feedbackAuth.delegation',
            payloadUri: payloadTokenUri,
            payloadCid,
            // minimal searchable fields
            agentId: params.agentId.toString(),
            clientAddress: initiatorAddress,
            chainId: chainIdNum,
            createdAt: new Date().toISOString(),
        };
        const data = encodeAssociationData({
            assocType: 1,
            // ERC-8092 record "ipfs content section": embed an IPFS URI pointer in the description JSON.
            description: JSON.stringify(delegationRef),
        });
        const record = {
            initiator: formatEvmV1(chainIdNum, initiatorAddress),
            approver: formatEvmV1(chainIdNum, approverAddress),
            validAt,
            validUntil,
            interfaceId: '0x00000000',
            data,
        };
        const associationId = erc8092RecordDigest(record);
        if (!params.walletClient) {
            throw new Error('walletClient is required to sign delegation association');
        }
        // If approverAddress is a smart account (ERC-1271), the signature bytes must be something
        // that approverAddress will accept for `isValidSignature(digest, signature)`.
        // Different account implementations expect different signature schemes (EIP-712 digest-signing vs EIP-191 personal_sign).
        // We'll generate a small set of candidates and pick the one that validates via ERC-1271.
        const selectApproverSignature = async (candidates) => {
            try {
                const code = await params.publicClient.getBytecode({ address: approverAddress });
                // If not a contract, don't attempt ERC-1271 selection.
                if (!code || code === '0x') {
                    return { selected: candidates[0], checked: false, reason: 'approver has no code (EOA/counterfactual)' };
                }
                const ERC1271_MAGIC = '0x1626ba7e';
                const ERC1271_ABI = [
                    {
                        type: 'function',
                        name: 'isValidSignature',
                        stateMutability: 'view',
                        inputs: [
                            { name: 'hash', type: 'bytes32' },
                            { name: 'signature', type: 'bytes' },
                        ],
                        outputs: [{ name: 'magicValue', type: 'bytes4' }],
                    },
                ];
                for (const c of candidates) {
                    try {
                        const magic = (await params.publicClient.readContract({
                            address: approverAddress,
                            abi: ERC1271_ABI,
                            functionName: 'isValidSignature',
                            args: [associationId, c.sig],
                        }));
                        if (String(magic).toLowerCase() === ERC1271_MAGIC) {
                            return { selected: c, checked: true, reason: 'erc1271 magic matched' };
                        }
                    }
                    catch {
                        // try next
                    }
                }
                return { selected: candidates[0], checked: true, reason: 'no candidate validated via ERC-1271' };
            }
            catch (e) {
                return { selected: candidates[0], checked: false, reason: e?.message || String(e) };
            }
        };
        // IMPORTANT:
        // Sign using EIP-712 typed data so the signature validates against the raw EIP-712 digest (no EIP-191 prefix).
        // Our digest scheme uses ONLY domain {name, version} (no chainId/verifyingContract).
        const sigEip712 = (await params.walletClient.signTypedData({
            // NOTE: signature bytes are produced by `params.signer` (operator/session key),
            // but validated against `approverAddress` (agentAccount) via ERC-1271.
            account: params.signer,
            domain: { name: 'AssociatedAccounts', version: '1' },
            types: {
                AssociatedAccountRecord: [
                    { name: 'initiator', type: 'bytes' },
                    { name: 'approver', type: 'bytes' },
                    { name: 'validAt', type: 'uint40' },
                    { name: 'validUntil', type: 'uint40' },
                    { name: 'interfaceId', type: 'bytes4' },
                    { name: 'data', type: 'bytes' },
                ],
            },
            primaryType: 'AssociatedAccountRecord',
            message: {
                initiator: record.initiator,
                approver: record.approver,
                validAt: BigInt(record.validAt),
                validUntil: BigInt(record.validUntil),
                interfaceId: record.interfaceId,
                data: record.data,
            },
        }));
        // Candidate 2: EIP-191 personal_sign of the 32-byte digest (some smart accounts validate this scheme).
        let sigPersonal = '0x';
        try {
            sigPersonal = (await params.walletClient.signMessage({
                account: params.signer,
                message: { raw: ethers.getBytes(associationId) },
            }));
        }
        catch {
            // ignore
        }
        const chosen = await selectApproverSignature([
            { scheme: 'eip712', sig: sigEip712 },
            ...(sigPersonal && sigPersonal !== '0x' ? [{ scheme: 'personal_sign', sig: sigPersonal }] : []),
        ]);
        const approverSignature = chosen.selected.sig;
        // IMPORTANT: Use K1 (0x0001) for approverKeyType. This is the standard approach.
        //
        // The ERC-8092 contract will use OpenZeppelin SignatureChecker which calls:
        //   agent.isValidSignature(hash, approverSignature)
        //
        // MetaMask smart accounts with DTK support delegation-aware ERC-1271 validation.
        // The delegation-aware validator automatically:
        // 1. Extracts the signer address from the signature (ecrecover)
        // 2. Checks if the signer (operator) has a valid delegation from the agent account
        // 3. Validates the delegation scope covers this signing operation (now includes isValidSignature selector)
        // 4. Returns 0x1626ba7e (valid) if delegation is valid, 0xffffffff (invalid) otherwise
        //
        // This allows the operator's signature to be validated as if it came from the agent account itself.
        const sar = {
            revokedAt: 0,
            // K1 (0x0001) for client EOA initiator signature
            initiatorKeyType: '0x0001',
            // DELEGATED (0x8002) keyType to bypass ERC-1271 and validate delegation directly
            // This checks if the agent account has delegated to the operator EOA directly
            approverKeyType: '0x8002',
            initiatorSignature: '0x',
            approverSignature,
            record,
        };
        return {
            feedbackAuth: signedAuth,
            delegationAssociation: {
                associationId,
                initiatorAddress,
                approverAddress,
                assocType: 1,
                validAt,
                validUntil,
                data,
                approverSignature,
                sar,
                delegation: {
                    ...delegationRef,
                    // Include the full payload inline too (best-effort convenience for clients),
                    // but the canonical copy is the IPFS payload when available.
                    payload: { ...delegation, signatureScheme: chosen.selected?.scheme, signatureChecked: chosen.checked, signatureCheckReason: chosen.reason },
                },
            },
        };
    }
    catch (e) {
        console.warn('[createFeedbackAuthWithDelegation] Failed to create delegation association (continuing):', e);
        return { feedbackAuth: signedAuth };
    }
}
async function createFeedbackAuthInternal(params) {
    const { publicClient, agentId, clientAddress, signer, walletClient, expirySeconds = 3600, } = params;
    // Get the shared reputation client singleton (used for auth struct + index queries)
    const reputationClient = await getReputationRegistryClient();
    // Prefer env-configured IdentityRegistry to avoid an extra on-chain call.
    // This helps in rate-limited environments (e.g. 429s from RPC providers).
    let identityReg = null;
    try {
        const { getChainEnvVar } = await import('./chainConfig');
        const chainId = Number(publicClient?.chain?.id ?? 0);
        const fromEnv = chainId ? getChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', chainId) : null;
        if (fromEnv && typeof fromEnv === 'string' && /^0x[a-fA-F0-9]{40}$/.test(fromEnv)) {
            identityReg = fromEnv;
        }
    }
    catch {
        // ignore
    }
    if (!identityReg) {
        // Fallback: resolve IdentityRegistry from ReputationRegistry on-chain
        identityReg = (await reputationClient.getIdentityRegistry());
    }
    // Load IdentityRegistry ABI (async dynamic import)
    const identityRegistryAbi = await getIdentityRegistryAbi();
    // Ensure IdentityRegistry operator approvals are configured for sessionAA
    console.info("**********************************");
    console.info("createFeedbackAuth: ", agentId, clientAddress, signer.address);
    try {
        const ownerOfAgent = await publicClient.readContract({
            address: identityReg,
            abi: identityRegistryAbi,
            functionName: 'ownerOf',
            args: [agentId],
        });
        const isOperator = await publicClient.readContract({
            address: identityReg,
            abi: identityRegistryAbi,
            functionName: 'isApprovedForAll',
            args: [ownerOfAgent, signer.address],
        });
        const tokenApproved = await publicClient.readContract({
            address: identityReg,
            abi: identityRegistryAbi,
            functionName: 'getApproved',
            args: [agentId],
        });
        console.info('IdentityRegistry approvals:', { ownerOfAgent, isOperator, tokenApproved });
        if (!isOperator && tokenApproved.toLowerCase() !== signer.address.toLowerCase()) {
            throw new Error(`IdentityRegistry approval missing: neither isApprovedForAll nor getApproved`);
        }
    }
    catch (e) {
        console.warn('[IdentityRegistry] approval check failed:', e?.message || e);
        throw e;
    }
    // Resolve the agentAccount authority address from on-chain metadata.
    // This is the address we want verifiers to attribute feedbackAuth/delegations to.
    let authorityAddress = signer.address;
    try {
        const agentAccountRaw = await publicClient.readContract({
            address: identityReg,
            abi: identityRegistryAbi,
            functionName: 'getMetadata',
            args: [agentId, 'agentAccount'],
        });
        const agentAccountStr = tryDecodeMetadataString(agentAccountRaw);
        const parsed = parseAgentAccountMetadata(agentAccountStr);
        if (parsed)
            authorityAddress = parsed;
        console.info('[FeedbackAuth] Resolved authorityAddress:', {
            agentId: agentId.toString(),
            authorityAddress,
            agentAccountStr,
        });
    }
    catch (e) {
        console.warn('[FeedbackAuth] Unable to resolve agentAccount from metadata; falling back to signer.address', e);
    }
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const chainId = BigInt(publicClient.chain?.id ?? 0);
    const U64_MAX = 18446744073709551615n;
    const lastIndexFetched = await reputationClient.getLastIndex(agentId, clientAddress);
    let indexLimit = lastIndexFetched + 1n;
    let expiry = nowSec + BigInt(expirySeconds);
    if (expiry > U64_MAX) {
        console.warn('[FeedbackAuth] Computed expiry exceeds uint64; clamping to max');
        expiry = U64_MAX;
    }
    // Build FeedbackAuth struct via ReputationClient
    console.info("create feedback auth structure: ", agentId, clientAddress, indexLimit, expiry, chainId, authorityAddress);
    const authStruct = reputationClient.createFeedbackAuth(agentId, clientAddress, indexLimit, expiry, chainId, 
    // IMPORTANT: attribute auth to agentAccount authority, not the operator key.
    authorityAddress);
    // Note: log the struct directly; JSON.stringify cannot handle BigInt values.
    console.info('authStruct:', authStruct);
    // Sign keccak256(encoded tuple) with provided signer (sessionAA via ERC-1271)
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'uint256', 'uint256', 'uint256', 'address', 'address'], [
        authStruct.agentId,
        authStruct.clientAddress,
        authStruct.indexLimit,
        authStruct.expiry,
        authStruct.chainId,
        authStruct.identityRegistry,
        authStruct.signerAddress,
    ]);
    const messageHash = ethers.keccak256(encoded);
    // Sign the message hash using the wallet client
    if (!walletClient) {
        throw new Error('walletClient is required for signing feedback auth');
    }
    const signature = await walletClient.signMessage({
        account: signer,
        message: { raw: ethers.getBytes(messageHash) },
    });
    console.info("signature: ", signature);
    const signedAuth = ethers.concat([encoded, signature]);
    return {
        signedAuth,
        authStruct,
        encoded: encoded,
        chainId,
        indexLimit,
        expiry,
        identityRegistry: identityReg,
        authorityAddress,
    };
}
//# sourceMappingURL=agentFeedback.js.map