# Configuring Agent Account ERC-1271 for Delegation Validation

## Problem

The agent account (MetaMask smart account) is not validating delegated signatures via ERC-1271. When we call `agent.isValidSignature(hash, signature)` where the signature is from a delegated operator, it returns `0xffffffff` (invalid) instead of `0x1626ba7e` (valid).

## Current Situation

- **Agent Account**: MetaMask smart account (Hybrid implementation)
- **Operator**: EOA that has a MetaMask delegation from the agent account
- **ERC-1271 Call**: `agent.isValidSignature(associationId, operatorSignature)` returns `0xffffffff`
- **Expected**: Should return `0x1626ba7e` if the operator is delegated

## MetaMask Smart Account Architecture

MetaMask smart accounts use a modular architecture:
- **Implementation**: Hybrid (combines EOA and smart contract functionality)
- **Deploy Params**: `[owner, validators, modules, hooks]` - currently using `[eoaAddress, [], [], []]`
- **ERC-1271**: Implemented by the smart account, but may not check delegations by default

## Solution Options

### Option 1: Check if MetaMask Supports Delegation-Aware ERC-1271 (Recommended First Step)

MetaMask smart accounts may have validators/modules that enable delegation-aware ERC-1271 validation:

1. **Check MetaMask Smart Accounts Kit Documentation**
   - Look for validator modules that check delegations
   - Check if there's a `DelegationValidator` or similar module

2. **Configure Validators in deployParams**
   ```typescript
   const deployParams = [
     ownerAddress,
     [delegationValidatorAddress], // Validator that checks delegations
     [], // Modules
     []  // Hooks
   ];
   ```

3. **If Validators Exist**
   - Add the delegation-aware validator to the agent account deployment
   - Re-deploy or upgrade the agent account with the validator

### Option 2: Custom ERC-1271 Implementation (If Option 1 Fails)

If MetaMask doesn't support delegation-aware ERC-1271 out of the box:

1. **Create a Custom Validator Contract**
   ```solidity
   contract DelegationAwareValidator {
       address public immutable delegationManager;
       
       function isValidSignature(
           address account,
           bytes32 hash,
           bytes memory signature
       ) external view returns (bytes4) {
           address signer = recover(hash, signature);
           // Check if account has delegated to signer
           if (hasDelegation(account, signer)) {
               return 0x1626ba7e;
           }
           return 0xffffffff;
       }
   }
   ```

2. **Deploy Validator Contract**
   - Deploy the validator contract
   - Get the validator address

3. **Add Validator to Agent Account**
   - Use MetaMask smart accounts SDK to add validator
   - This may require upgrading the agent account

### Option 3: Use DELEGATED KeyType (Fallback)

If configuring ERC-1271 delegation validation is not feasible:

1. **Keep DELEGATED KeyType Implementation**
   - Use `approverKeyType = 0x8002` in ERC-8092 records
   - Extend ERC-8092 contract to validate delegations directly

2. **Benefits**
   - No changes needed to agent account
   - Explicit delegation validation at ERC-8092 level

3. **Drawbacks**
   - Requires ERC-8092 contract changes
   - Adds coupling to MetaMask DelegationManager

## Next Steps

### Step 1: Research MetaMask Validators (Priority)

1. Check `@metamask/smart-accounts-kit` documentation for:
   - Available validator modules
   - Delegation-aware validators
   - How to configure validators in deployParams

2. Check MetaMask smart accounts repository:
   - Look for validator implementations
   - Check if delegation checking is supported

### Step 2: Test Current ERC-1271 Behavior

1. Deploy a test agent account with current configuration
2. Create a delegation from agent account to operator
3. Call `isValidSignature` with operator signature
4. Verify the return value (should be `0xffffffff` currently)

### Step 3: Configure Validator (If Available)

1. Identify the delegation-aware validator address/module
2. Update agent account deployment to include validator:
   ```typescript
   deployParams: [ownerAddress, [validatorAddress], [], []]
   ```
3. Re-deploy agent account with validator
4. Test ERC-1271 again

### Step 4: Implement Custom Validator (If Needed)

1. If MetaMask doesn't support delegation-aware ERC-1271:
   - Design custom validator contract
   - Deploy validator contract
   - Add validator to agent account via upgrade
   - Test end-to-end

### Step 5: Use DELEGATED KeyType (If All Else Fails)

1. Revert to using `approverKeyType = 0x8002`
2. Complete ERC-8092 contract implementation with delegation validation
3. Deploy updated ERC-8092 contract
4. Test end-to-end flow

## Resources

- [MetaMask Smart Accounts Kit](https://github.com/MetaMask/smart-accounts-kit)
- [ERC-1271 Specification](https://eips.ethereum.org/EIPS/eip-1271)
- [MetaMask Delegation Manager Documentation](https://docs.metamask.io/)

## Implementation Checklist

- [ ] Research MetaMask validator modules for delegation support
- [ ] Check if `deployParams` validators array can include delegation validator
- [ ] Test current ERC-1271 behavior with delegated signatures
- [ ] If validators exist: Configure validator in agent account deployment
- [ ] If validators don't exist: Design and deploy custom validator
- [ ] Test ERC-1271 validation after validator configuration
- [ ] If ERC-1271 delegation validation works: Use K1 keyType (0x0001)
- [ ] If ERC-1271 delegation validation doesn't work: Use DELEGATED keyType (0x8002)

