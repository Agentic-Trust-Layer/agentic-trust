import { ethers } from 'ethers';
import { encodeAssociationData } from './association';
import { getIPFSStorage } from './ipfs';
const U40_MAX = 1099511627775; // 2^40-1
function clampU40(n) {
    if (!Number.isFinite(n) || n < 0)
        return 0;
    return Math.min(Math.floor(n), U40_MAX);
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
 * Create an ERC-8092 Delegation association payload with an IPFS-hosted JSON payload.
 * The return value is approver-signed; the client can add initiatorSignature and store it on-chain.
 */
export async function createDelegationAssociationWithIpfs(params) {
    const chainIdNum = Number(params.chainId);
    if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
        throw new Error(`Invalid chainId for delegation association: ${String(params.chainId)}`);
    }
    const initiatorAddress = ethers.getAddress(params.initiatorAddress);
    const approverAddress = ethers.getAddress(params.approverAddress);
    const createdAt = new Date().toISOString();
    const payload = { ...params.payload, type: params.payloadType, createdAt };
    // Upload the full payload to IPFS (best-effort)
    let payloadTokenUri = null;
    let payloadCid = null;
    try {
        const ipfs = getIPFSStorage();
        const upload = await ipfs.upload(JSON.stringify(payload, null, 2), 'delegation.json');
        payloadCid = upload.cid;
        payloadTokenUri = upload.tokenUri;
    }
    catch (ipfsErr) {
        console.warn('[createDelegationAssociationWithIpfs] Failed to upload payload to IPFS (continuing):', ipfsErr);
    }
    const delegationRef = {
        type: params.payloadType,
        payloadUri: payloadTokenUri,
        payloadCid,
        createdAt,
    };
    const data = encodeAssociationData({
        assocType: 1,
        description: JSON.stringify(delegationRef),
    });
    const validAt = clampU40(Math.floor(Date.now() / 1000));
    const record = {
        initiator: formatEvmV1(chainIdNum, initiatorAddress),
        approver: formatEvmV1(chainIdNum, approverAddress),
        validAt,
        validUntil: 0,
        interfaceId: '0x00000000',
        data,
    };
    const associationId = erc8092RecordDigest(record);
    // IMPORTANT:
    // Sign using EIP-712 typed data so the signature validates against the raw EIP-712 digest (no EIP-191 prefix).
    // Our digest scheme uses ONLY domain {name, version} (no chainId/verifyingContract).
    const approverSignature = (await params.walletClient.signTypedData({
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
    const sar = {
        revokedAt: 0,
        initiatorKeyType: '0x0001',
        approverKeyType: '0x0001',
        initiatorSignature: '0x',
        approverSignature,
        record,
    };
    return {
        associationId,
        initiatorAddress,
        approverAddress,
        assocType: 1,
        validAt,
        validUntil: 0,
        data,
        approverSignature,
        sar,
        delegation: {
            type: params.payloadType,
            payloadUri: payloadTokenUri,
            payloadCid,
            createdAt,
            payload,
        },
    };
}
//# sourceMappingURL=delegationAssociation.js.map