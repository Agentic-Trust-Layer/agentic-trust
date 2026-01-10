import type { Account } from 'viem';
export type DelegationAssociationResult = {
    associationId: `0x${string}`;
    initiatorAddress: `0x${string}`;
    approverAddress: `0x${string}`;
    assocType: 1;
    validAt: number;
    validUntil: 0;
    data: `0x${string}`;
    approverSignature: `0x${string}`;
    sar: {
        revokedAt: number;
        initiatorKeyType: `0x${string}`;
        approverKeyType: `0x${string}`;
        initiatorSignature: `0x${string}`;
        approverSignature: `0x${string}`;
        record: {
            initiator: `0x${string}`;
            approver: `0x${string}`;
            validAt: number;
            validUntil: 0;
            interfaceId: `0x${string}`;
            data: `0x${string}`;
        };
    };
    delegation: {
        type: string;
        payloadUri: string | null;
        payloadCid: string | null;
        createdAt: string;
        payload: Record<string, unknown>;
    };
};
/**
 * Create an ERC-8092 Delegation association payload with an IPFS-hosted JSON payload.
 * The return value is approver-signed; the client can add initiatorSignature and store it on-chain.
 */
export declare function createDelegationAssociationWithIpfs(params: {
    chainId: number;
    initiatorAddress: `0x${string}`;
    approverAddress: `0x${string}`;
    signer: Account;
    walletClient: any;
    payloadType: string;
    payload: Record<string, unknown>;
}): Promise<DelegationAssociationResult>;
//# sourceMappingURL=delegationAssociation.d.ts.map