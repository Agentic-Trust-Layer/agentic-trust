// Common keyType values used by the ERC-8092 Associated Accounts spec and this repo.
//
// Note: these are bytes2 values, represented as 0x-prefixed hex strings.

export const KEY_TYPE_K1 = "0x0001"; // EOA / secp256k1
export const KEY_TYPE_ERC1271 = "0x8002"; // ERC-1271 smart account
export const KEY_TYPE_SC_DELEGATION = "0x8004"; // MetaMask Delegation Framework proof (custom)

