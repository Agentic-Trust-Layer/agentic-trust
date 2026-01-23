# @agentic-trust/8092-sdk

Shared TypeScript helpers for ERC-8092 (Associated Accounts) used across this repo.

This package is aligned with the upstream reference implementation in
`Agentic-Trust-Layer/AssociatedAccounts` (see `packages/erc8092-sdk` in that repo).

## What’s included

- ERC-8092 EIP-712 hashing: `eip712Hash(record)`, `associationIdFromRecord(record)`
- ERC-7930 helpers: `formatEvmV1(chainId, address)`, `tryParseEvmV1(bytes)`
- Key type constants: `KEY_TYPE_K1`, `KEY_TYPE_ERC1271`, `KEY_TYPE_SC_DELEGATION`
- SC-DELEGATION (0x8004) helpers:
  - DF hashing + typed digest: `dfHashDelegationStruct(...)`, `dfTypedDigest(...)`
  - Proof encoding/decoding: `encodeScDelegationProof(...)`, `decodeScDelegationProof(...)`
- Contract ABI strings: `ASSOCIATIONS_STORE_ABI`

## Signing note (K1 / EOA)

In this repo, K1 signatures for ERC-8092 are ECDSA over the raw EIP-712 digest bytes32
(no EIP-191 message prefix).

Use: `signErc8092DigestK1({ wallet, digest })`.

