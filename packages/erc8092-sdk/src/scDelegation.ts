import { ethers } from "ethers";

export const DF_DELEGATION_TYPEHASH =
  "0x88c1d2ecf185adf710588203a5f263f0ff61be0d33da39792cde19ba9aa4331e";
export const DF_CAVEAT_TYPEHASH =
  "0x80ad7e1b04ee6d994a125f4714ca0720908bd80ed16063ec8aee4b88e9253e2d";
export const DF_EIP712_DOMAIN_TYPEHASH = ethers.id(
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
);
export const DF_NAME_HASH = ethers.id("DelegationManager");
export const DF_VERSION_HASH = ethers.id("1");

export const DF_ROOT_AUTHORITY =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

export type DfCaveat = { enforcer: string; terms: string };
export type DfDelegation = {
  delegate: string;
  delegator: string;
  authority: string;
  caveats: DfCaveat[];
  salt: bigint;
};

export type ScDelegationProof = {
  delegate: string;
  delegateSignature: string; // ECDSA signature over the raw bytes32 digest (no prefix)
  delegations: string; // abi-encoded Delegation[] bytes blob
};

export function encodeScDelegationProof(proof: ScDelegationProof): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address delegate,bytes delegateSignature,bytes delegations)"],
    [[proof.delegate, proof.delegateSignature, proof.delegations]]
  );
}

export function decodeScDelegationProof(proofBytes: string): ScDelegationProof | null {
  try {
    if (typeof proofBytes !== "string" || !proofBytes.startsWith("0x") || proofBytes === "0x") return null;
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ["tuple(address delegate,bytes delegateSignature,bytes delegations)"],
      proofBytes
    );
    const tuple = decoded?.[0];
    const delegate = tuple?.delegate as string | undefined;
    const delegateSignature = tuple?.delegateSignature as string | undefined;
    const delegations = tuple?.delegations as string | undefined;
    if (!delegate || !delegateSignature || !delegations) return null;
    return {
      delegate: ethers.getAddress(delegate),
      delegateSignature,
      delegations,
    };
  } catch {
    return null;
  }
}

// matches ScDelegationLib._hashCaveat: keccak256(abi.encode(CAVEAT_TYPEHASH, enforcer, keccak256(terms)))
export function dfHashCaveat(enforcer: string, terms: string): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "bytes32"],
      [DF_CAVEAT_TYPEHASH, enforcer, ethers.keccak256(terms)]
    )
  );
}

// matches ScDelegationLib._hashCaveatsArray: keccak256(abi.encodePacked(hashes))
export function dfHashCaveatsArray(caveats: DfCaveat[]): string {
  const hashes = caveats.map((c) => dfHashCaveat(c.enforcer, c.terms));
  return ethers.keccak256(ethers.concat(hashes.map((h) => ethers.getBytes(h))));
}

export function dfHashDelegationStruct(d: DfDelegation): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "address", "bytes32", "bytes32", "uint256"],
      [DF_DELEGATION_TYPEHASH, d.delegate, d.delegator, d.authority, dfHashCaveatsArray(d.caveats), d.salt]
    )
  );
}

export function dfDomainSeparator(params: {
  delegationManager: string;
  chainId: number | bigint;
}): string {
  const dm = ethers.getAddress(params.delegationManager);
  const chainId = typeof params.chainId === "bigint" ? params.chainId : BigInt(params.chainId);
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [DF_EIP712_DOMAIN_TYPEHASH, DF_NAME_HASH, DF_VERSION_HASH, chainId, dm]
    )
  );
}

export function dfTypedDigest(params: {
  delegationManager: string;
  chainId: number | bigint;
  delegationStructHash: string;
}): string {
  const ds = dfDomainSeparator({ delegationManager: params.delegationManager, chainId: params.chainId });
  return ethers.keccak256(
    ethers.concat([ethers.getBytes("0x1901"), ethers.getBytes(ds), ethers.getBytes(params.delegationStructHash)])
  );
}

