/**
 * ERC-8092 KeyType constants
 * 
 * These constants define the signature key types supported by ERC-8092.
 */

/**
 * K1/ECDSA secp256k1 key type (0x0001)
 * 
 * Standard ECDSA signature using secp256k1 curve.
 * Validated via OpenZeppelin SignatureChecker, which supports:
 * - EOA signatures (ecrecover)
 * - ERC-1271 smart account signatures
 */
export const KEY_TYPE_K1 = '0x0001' as const;

/**
 * DELEGATED key type (0x8002)
 * 
 * Signature from a delegated account (e.g., MetaMask delegation).
 * The signature is validated by:
 * 1. Extracting the signer address from the signature (ecrecover)
 * 2. Checking if the approver (delegator) has a valid delegation to the signer (delegatee)
 * 3. Verifying the delegation is active and allows the operation
 * 
 * This keyType is used when:
 * - The approver is a smart account (e.g., agent account)
 * - The signature is produced by a delegated operator account
 * - The delegation is managed via MetaMask DelegationManager or similar
 */
export const KEY_TYPE_DELEGATED = '0x8002' as const;

/**
 * Type for keyType values
 */
export type KeyType = typeof KEY_TYPE_K1 | typeof KEY_TYPE_DELEGATED | string;

