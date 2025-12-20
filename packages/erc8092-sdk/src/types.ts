export type AssociatedAccountRecord = {
  initiator: string; // bytes (ERC-7930 interoperable address)
  approver: string; // bytes (ERC-7930 interoperable address)
  validAt: number; // uint40
  validUntil: number; // uint40
  interfaceId: string; // bytes4
  data: string; // bytes
};

export type SignedAssociationRecord = {
  revokedAt: number; // uint40
  initiatorKeyType: string; // bytes2 hex string (e.g. 0x8002)
  approverKeyType: string; // bytes2 hex string (e.g. 0x8002)
  initiatorSignature: string; // bytes
  approverSignature: string; // bytes
  record: AssociatedAccountRecord;
};

/**
 * A richer view of a SignedAssociationRecord as returned from a store contract,
 * augmented with a deterministic associationId and best-effort EVM address parsing.
 */
export type SignedAssociation = {
  associationId: string; // bytes32 hex (EIP-712 hash of record)
  revokedAt: number; // uint40
  initiatorKeyType: string; // bytes2
  approverKeyType: string; // bytes2
  initiatorSignature: string; // bytes
  approverSignature: string; // bytes
  record: AssociatedAccountRecord;
  // Best-effort parsed values (when record.initiator/approver are EVM-v1 interoperable addresses)
  initiatorAddress?: string;
  approverAddress?: string;
  counterpartyAddress?: string;
};

export type Association = {
  associationId: string; // bytes32 hex
  revokedAt: number;
  initiator: string; // resolved 0x address when possible
  approver: string; // resolved 0x address when possible
  counterparty: string; // resolved 0x address when possible
  validAt: number;
  validUntil: number;
};


