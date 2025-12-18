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

export type Association = {
  associationId: string; // bytes32 hex
  revokedAt: number;
  initiator: string; // resolved 0x address when possible
  approver: string; // resolved 0x address when possible
  counterparty: string; // resolved 0x address when possible
  validAt: number;
  validUntil: number;
};


