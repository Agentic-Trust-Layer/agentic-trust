# ERC-8092 AssociationsStore with DELEGATED KeyType Support

This directory contains the implementation for ERC-8092 AssociationsStore contract with support for DELEGATED keyType (0x8002).

## Overview

The DELEGATED keyType allows the ERC-8092 contract to validate signatures from delegated accounts (e.g., MetaMask delegation). When `approverKeyType = 0x8002`, the contract validates that:

1. The signature is valid (using ecrecover)
2. The approver (delegator) has a valid delegation to the signer (delegatee)
3. The delegation is active and allows the operation

## Key Changes

### 1. DELEGATED KeyType Constant

```solidity
bytes2 public constant KEY_TYPE_DELEGATED = 0x8002;
```

### 2. Modified Signature Validation

The `storeAssociation` function now routes to different validation logic based on `approverKeyType`:

- `0x0001` (K1): Uses OpenZeppelin SignatureChecker (standard ERC-1271 validation)
- `0x8002` (DELEGATED): Validates signature via delegation check

### 3. Delegation Validation

The `_hasValidDelegation` function queries the MetaMask DelegationManager contract to verify that:
- The approver (agent account) has delegated authority to the signer (operator account)
- The delegation is active and valid

## Implementation Notes

### DelegationManager Interface

The contract needs to interact with the MetaMask DelegationManager contract. The exact interface depends on the DelegationManager implementation. Common patterns include:

1. **Delegation Registry**: DelegationManager maintains a mapping of delegator → delegatee → delegation info
2. **Signature Validation**: DelegationManager validates delegation signatures on-chain
3. **Hash-based Lookup**: Delegations are stored by hash and can be queried

### Current Implementation

The current implementation uses a placeholder interface:

```solidity
(bool success, bytes memory data) = delegationManager.staticcall(
    abi.encodeWithSignature(
        "hasDelegation(address,address)",
        approver,
        signer
    )
);
```

**This needs to be updated** based on the actual DelegationManager contract interface.

### Integration Steps

1. **Deploy or identify the DelegationManager contract address** for your chain
2. **Update the `_hasValidDelegation` function** to match the actual DelegationManager ABI
3. **Test delegation validation** with real delegation data
4. **Deploy the updated AssociationsStore contract**
5. **Update client code** to use `approverKeyType: '0x8002'` for delegated signatures

## Usage

### Client-Side (TypeScript)

When creating an ERC-8092 association with delegated authority:

```typescript
const sar = {
  revokedAt: 0,
  initiatorKeyType: '0x0001', // K1 for client EOA
  approverKeyType: '0x8002',   // DELEGATED for MetaMask delegation
  initiatorSignature: clientSignature,
  approverSignature: operatorSignature, // Signed by operator EOA
  record: {
    initiator: formatEvmV1(chainId, clientAddress),
    approver: formatEvmV1(chainId, agentAccount), // Agent account (delegator)
    // ... other fields
  },
};
```

### Contract-Side (Solidity)

The contract automatically detects `approverKeyType = 0x8002` and:

1. Extracts the signer address from the signature (ecrecover)
2. Resolves the approver address from ERC-7930 format
3. Queries DelegationManager to verify delegation
4. Accepts the signature if delegation is valid

## Testing

To test the DELEGATED keyType support:

1. Create a MetaMask delegation from agent account to operator account
2. Sign the ERC-8092 record with operator EOA
3. Set `approverKeyType = 0x8002` in the SAR
4. Call `storeAssociation` with the SAR
5. Verify the association is stored successfully

## Backward Compatibility

The contract maintains backward compatibility with existing `0x0001` (K1) signatures. Existing associations and client code using K1 will continue to work without changes.

## Error Handling

- `InvalidDelegation`: Thrown when delegation validation fails
- `InvalidSignature`: Thrown when signature validation fails (for both K1 and DELEGATED)

## Future Enhancements

1. **Delegation Scope Validation**: Check if delegation scope allows the specific operation
2. **Delegation Expiry**: Validate delegation has not expired
3. **Multiple Delegation Types**: Support for different delegation schemes beyond MetaMask
4. **Gas Optimization**: Cache delegation validation results to reduce gas costs

