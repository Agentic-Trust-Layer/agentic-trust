# How to Configure Agent Account ERC-1271 for Delegation Validation

## Current Issue

The agent account's `isValidSignature` is returning `0xffffffff` (invalid) for delegated operator signatures, even though the operator has a valid MetaMask delegation from the agent account.

## Understanding the Problem

**MetaMask Smart Accounts** have ERC-1271 implemented, but it may not check delegations by default. Delegations in MetaMask work at the **transaction execution level** (via DelegationManager redemption), not at the **ERC-1271 signature validation level**.

## Solution Steps

### Step 1: Check MetaMask Smart Account ERC-1271 Implementation

First, we need to understand how MetaMask smart accounts implement ERC-1271:

1. **Inspect the Agent Account Contract**
   ```typescript
   // In your code, check the agent account's bytecode/ABI
   const agentAccountAddress = delegationSetup.aa;
   const code = await publicClient.getBytecode({ address: agentAccountAddress });
   console.log('Agent account bytecode length:', code?.length);
   ```

2. **Call isValidSignature Directly**
   ```typescript
   // Test if ERC-1271 is implemented
   const isValidSignatureData = encodeFunctionData({
     abi: [{
       name: 'isValidSignature',
       type: 'function',
       inputs: [
         { name: 'hash', type: 'bytes32' },
         { name: 'signature', type: 'bytes' },
       ],
       outputs: [{ type: 'bytes4' }],
       stateMutability: 'view',
     }],
     functionName: 'isValidSignature',
     args: [associationId, operatorSignature],
   });
   
   const result = await publicClient.call({
     to: agentAccountAddress,
     data: isValidSignatureData,
   });
   
   console.log('isValidSignature result:', result);
   ```

### Step 2: Check if MetaMask Supports Validator Modules

MetaMask smart accounts use a modular architecture. Check if there's a delegation-aware validator:

1. **Check deployParams Structure**
   - Current: `deployParams: [ownerAddress, [], [], []]`
   - These arrays are: `[owner, validators, modules, hooks]`
   - Empty arrays mean no validators/modules configured

2. **Research MetaMask Validators**
   - Check `@metamask/smart-accounts-kit` documentation
   - Look for validator modules that check delegations
   - Check MetaMask smart accounts GitHub repository

3. **If Validator Exists**:
   ```typescript
   // Update deployParams to include validator
   deployParams: [
     ownerAddress,
     [delegationValidatorAddress], // Add validator here
     [], // Modules
     []  // Hooks
   ]
   ```

### Step 3: If MetaMask Doesn't Support It - Custom Implementation Options

#### Option A: Create a Custom Validator (Requires Account Upgrade)

If MetaMask allows adding validators to existing accounts:

1. **Deploy Custom Validator Contract**
   ```solidity
   // contracts/validators/DelegationAwareValidator.sol
   contract DelegationAwareValidator {
       address public immutable delegationManager;
       
       function isValidSignature(
           address account,
           bytes32 hash,
           bytes memory signature
       ) external view returns (bytes4) {
           // Extract signer from signature
           address signer = recoverSigner(hash, signature);
           
           // Check delegation via DelegationManager
           if (checkDelegation(account, signer)) {
               return 0x1626ba7e; // Valid
           }
           
           // Fall back to owner check
           if (signer == ownerOf(account)) {
               return 0x1626ba7e; // Valid
           }
           
           return 0xffffffff; // Invalid
       }
       
       function checkDelegation(
           address delegator,
           address delegate
       ) internal view returns (bool) {
           // Query DelegationManager for active delegation
           // Implementation depends on DelegationManager interface
       }
   }
   ```

2. **Add Validator to Agent Account**
   - This may require upgrading the agent account
   - Use MetaMask smart accounts SDK to add validator
   - Test ERC-1271 after adding validator

#### Option B: Use DELEGATED KeyType (Recommended - No Account Changes)

Since modifying the agent account may not be feasible, use the DELEGATED keyType approach we've already implemented:

1. **Update Code to Use DELEGATED KeyType**
   ```typescript
   const sar = {
     // ...
     approverKeyType: '0x8002' as `0x${string}`, // DELEGATED
     // ...
   };
   ```

2. **Deploy Updated ERC-8092 Contract**
   - Use `AssociationsStoreWithDelegation.sol` from `contracts/erc8092/`
   - Contract validates delegations directly
   - No changes needed to agent account

### Step 4: Implementation Steps (Choose One Path)

#### Path A: Try to Configure MetaMask ERC-1271 (Best Case)

```typescript
// 1. Check if MetaMask has delegation-aware validator
// 2. If yes: Add validator to agent account via upgrade
// 3. Test ERC-1271 validation
// 4. If works: Keep using K1 keyType (0x0001)
```

#### Path B: Use DELEGATED KeyType (Fallback - Already Implemented)

```typescript
// 1. Revert approverKeyType to '0x8002' (DELEGATED)
// 2. Deploy updated ERC-8092 contract with delegation validation
// 3. Test end-to-end flow
// 4. No agent account changes needed
```

## Immediate Action Items

1. **Research MetaMask Validators** (1-2 hours)
   - Check `@metamask/smart-accounts-kit` docs
   - Check MetaMask smart accounts GitHub
   - Search for delegation-related validators/modules

2. **Test Current ERC-1271 Behavior** (30 minutes)
   - Call `isValidSignature` directly with delegated signature
   - Verify it returns `0xffffffff`
   - Document the exact behavior

3. **Decision Point**:
   - **If MetaMask supports delegation-aware ERC-1271**: Implement validator configuration
   - **If MetaMask doesn't support it**: Use DELEGATED keyType (already implemented)

## Code Changes Needed

### If Using Validator Configuration (Path A)

Update `packages/core/src/client/sessionPackageBuilder.ts`:
```typescript
const smartAccount = await toMetaMaskSmartAccount({
  address: agentAccount,
  client: publicClient as any,
  implementation: Implementation.Hybrid,
  signer: {
    walletClient: walletClient as any,
  },
  // If validator exists:
  deployParams: [
    ownerAddress,
    [delegationValidatorAddress], // Add validator
    [],
    []
  ],
} as any);
```

### If Using DELEGATED KeyType (Path B - Already Done)

The code already supports DELEGATED keyType. Just need to:
1. Update `approverKeyType` to `'0x8002'` in:
   - `apps/atp-agent/src/worker.ts`
   - `packages/core/src/server/lib/agentFeedback.ts`
2. Deploy the updated ERC-8092 contract

## Testing

After implementing either approach:

1. **Test ERC-1271 Validation**:
   ```typescript
   const result = await agentAccount.isValidSignature(associationId, operatorSignature);
   // Should return 0x1626ba7e if configured correctly
   ```

2. **Test ERC-8092 storeAssociation**:
   - Create SAR with appropriate keyType
   - Call `storeAssociation`
   - Verify association is stored successfully
   - Check transaction doesn't revert

## Recommended Next Steps

1. **First**: Research MetaMask validators (check docs/GitHub)
2. **If validators exist**: Configure validator in agent account
3. **If validators don't exist**: Use DELEGATED keyType approach (already implemented)
4. **Test thoroughly**: Both ERC-1271 validation and ERC-8092 storeAssociation

## Resources

- [MetaMask Smart Accounts Kit](https://github.com/MetaMask/smart-accounts-kit)
- [ERC-1271 Specification](https://eips.ethereum.org/EIPS/eip-1271)
- [DelegationManager Documentation](https://docs.metamask.io/consensys-zkevm/developers/metamask-delegation)
- [DELEGATED KeyType Implementation](./contracts/erc8092/README.md)

