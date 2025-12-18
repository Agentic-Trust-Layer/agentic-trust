import { ethers } from "ethers";
import type { AssociatedAccountRecord } from "./types";

const DOMAIN_TYPEHASH = ethers.id("EIP712Domain(string name,string version)");
const NAME_HASH = ethers.id("AssociatedAccounts");
const VERSION_HASH = ethers.id("1");
const MESSAGE_TYPEHASH = ethers.id(
  "AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)"
);
const abi = ethers.AbiCoder.defaultAbiCoder();

export function domainSeparator(): string {
  return ethers.keccak256(abi.encode(["bytes32", "bytes32", "bytes32"], [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH]));
}

export function hashStruct(rec: AssociatedAccountRecord): string {
  return ethers.keccak256(
    abi.encode(
      ["bytes32", "bytes32", "bytes32", "uint40", "uint40", "bytes4", "bytes32"],
      [
        MESSAGE_TYPEHASH,
        ethers.keccak256(rec.initiator),
        ethers.keccak256(rec.approver),
        rec.validAt,
        rec.validUntil,
        rec.interfaceId,
        ethers.keccak256(rec.data),
      ]
    )
  );
}

export function eip712Hash(rec: AssociatedAccountRecord): string {
  const ds = domainSeparator();
  const hs = hashStruct(rec);
  return ethers.keccak256(ethers.solidityPacked(["bytes2", "bytes32", "bytes32"], ["0x1901", ds, hs]));
}

// Deterministic bytes32 association id, matching the contract's record-hash scheme.
export function associationIdFromRecord(rec: AssociatedAccountRecord): string {
  return eip712Hash(rec);
}


