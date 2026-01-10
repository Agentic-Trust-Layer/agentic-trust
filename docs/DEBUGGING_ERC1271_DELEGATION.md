# Debugging ERC-1271 Delegation Validation

## Confirmed: MetaMask Smart Accounts Support Delegation-Aware ERC-1271

MetaMask smart accounts with DTK (Delegation Toolkit) **DO support** delegation-aware ERC-1271 validation. The delegation-aware validator automatically checks if the signer is a valid delegate when `isValidSignature` is called.

## Current Issue

The ERC-1271 preflight check is returning `0xffffffff` (invalid) instead of `0x1626ba7e` (valid) for delegated operator signatures.

## Debugging Steps

### 1. Verify Delegation is Active

Check that the delegation exists and is valid:

```typescript
// Check delegation in sessionPackage
const delegation = sessionPackage.signedDelegation;
console.log('Delegation:', {
  delegator: delegation.delegator || delegation.message?.delegator,
  delegate: delegation.delegate || delegation.message?.delegate,
  validUntil: delegation.validUntil || delegation.message?.validUntil,
  scope: delegation.scope || delegation.message?.scope,
});
```

### 2. Verify Signature Format

The delegation-aware validator might expect a specific signature format:

**Current approach**: We're signing the EIP-712 hash of the record:
```typescript
// associationId = eip712Hash(record)
// signature = sign(associationId) // EIP-712 typed data signature
```

**Possible issue**: The validator might expect:
- Raw hash (not EIP-712 hash)
- Different domain/format
- Signature with delegation proof embedded

### 3. Check Delegation Scope

The delegation scope might not include ERC-1271 signature validation:

```typescript
// Current delegation scope (from sessionPackageBuilder.ts)
scope: {
  type: 'functionCall',
  targets: [validationRegistry, associationsProxy],
  selectors: [selector, getIdentityRegistrySelector, storeAssociationSelector],
}
```

**Question**: Does the delegation scope need to explicitly allow ERC-1271 validation? Or is it automatic?

### 4. Verify Hash Match

Ensure the hash being validated matches what was signed:

```typescript
// What we sign
const associationId = eip712Hash(record);
const signature = await signTypedData({...});

// What ERC-8092 validates
const isValid = await agent.isValidSignature(associationId, signature);
```

**Check**: Does `associationId` match exactly between signing and validation?

### 5. Test Direct ERC-1271 Call

Add a diagnostic test to call `isValidSignature` directly:

```typescript
// Direct test
const result = await publicClient.readContract({
  address: agentAccount,
  abi: [{
    name: 'isValidSignature',
    type: 'function',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'magicValue', type: 'bytes4' }],
    stateMutability: 'view',
  }],
  functionName: 'isValidSignature',
  args: [associationId, operatorSignature],
});

console.log('Direct ERC-1271 result:', result);
```

## Common Issues and Solutions

### Issue 1: Delegation Not Active

**Symptom**: `isValidSignature` returns `0xffffffff`

**Check**:
- Delegation `validUntil` timestamp
- Delegation hasn't been revoked
- Delegation is properly stored in DelegationManager

**Solution**: Ensure delegation is active and not expired

### Issue 2: Signature Format Mismatch

**Symptom**: Signature validates via ecrecover but not via ERC-1271

**Check**:
- Hash format (raw vs EIP-712)
- Signature encoding (65 bytes, r+s+v)
- Domain separator matches

**Solution**: Try different signature formats:
- EIP-712 typed data signature
- EIP-191 personal_sign
- Raw hash signature

### Issue 3: Delegation Scope Doesn't Include ERC-1271

**Symptom**: Delegation works for transactions but not for ERC-1271

**Check**:
- Delegation scope type (`functionCall` vs others)
- Scope targets and selectors
- Whether ERC-1271 validation needs explicit permission

**Solution**: May need to adjust delegation scope or check if ERC-1271 validation is automatic

### Issue 4: Hash Mismatch

**Symptom**: Signature is valid but hash doesn't match

**Check**:
- `associationId` calculation matches ERC-8092 contract
- EIP-712 domain separator matches
- Record fields match exactly

**Solution**: Ensure hash calculation is consistent

## Next Steps

1. **Add Enhanced Debugging**:
   - Log delegation details
   - Log signature format details
   - Log hash calculation details
   - Log ERC-1271 call details

2. **Test Different Signature Formats**:
   - Try EIP-712 signature
   - Try EIP-191 personal_sign
   - Try raw hash signature

3. **Verify Delegation Configuration**:
   - Check delegation is active
   - Check delegation scope
   - Check delegation is stored in DelegationManager

4. **Contact MetaMask Support** (if needed):
   - Ask about delegation-aware ERC-1271 requirements
   - Ask about signature format expectations
   - Ask about delegation scope requirements

## Expected Behavior

When properly configured:

1. Operator signs the `associationId` (EIP-712 hash of record)
2. ERC-8092 contract calls `agent.isValidSignature(associationId, operatorSignature)`
3. Agent account's delegation-aware validator:
   - Extracts operator address from signature
   - Checks if operator is delegated
   - Validates delegation scope
   - Returns `0x1626ba7e` if valid
4. ERC-8092 contract accepts the signature and stores the association

## Current Code Status

The code is already set up to:
- ✅ Use K1 keyType (0x0001)
- ✅ Sign with operator EOA
- ✅ Test ERC-1271 validation via preflight
- ✅ Use validated signature in SAR

The remaining issue is why ERC-1271 validation is failing. The debugging steps above should help identify the root cause.

