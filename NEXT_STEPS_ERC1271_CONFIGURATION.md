# Next Steps: Configure Agent Account ERC-1271 for Delegation

## Immediate Action Plan

### Step 1: Research MetaMask Validators (Priority - Do This First)

**Goal**: Determine if MetaMask smart accounts support delegation-aware ERC-1271 validators

**Actions**:
1. Check `@metamask/smart-accounts-kit` package documentation:
   ```bash
   # Look in node_modules/@metamask/smart-accounts-kit
   # Or check online documentation
   ```
2. Check MetaMask smart accounts GitHub repository:
   - Search for "validator", "ERC-1271", "delegation"
   - Look for validator modules
3. Search for examples of ERC-1271 validation with delegations

**Time**: 1-2 hours

**Expected Outcome**: 
- If validators exist: We'll configure them
- If validators don't exist: We'll use DELEGATED keyType (already implemented)

### Step 2: Test Current ERC-1271 Behavior (Quick Check)

**Goal**: Confirm the current behavior and get diagnostic information

**Action**: Add a diagnostic script to test ERC-1271 directly:

```typescript
// scripts/test-erc1271-delegation.ts
import { createPublicClient, http, encodeFunctionData } from 'viem';
import { getChainById } from '../packages/core/src/server/lib/chainConfig';

async function testERC1271Delegation() {
  const chainId = 11155111; // Sepolia
  const chain = getChainById(chainId);
  const rpcUrl = process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA;
  
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  
  // Agent account address
  const agentAccount = '0x...'; // From sessionPackage.aa
  
  // Association ID (hash to validate)
  const associationId = '0x...'; // From ERC-8092 record
  
  // Operator signature
  const operatorSignature = '0x...'; // From operator EOA
  
  // Test ERC-1271
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
  
  try {
    const result = await publicClient.call({
      to: agentAccount,
      data: isValidSignatureData,
    });
    
    console.log('ERC-1271 Result:', result);
    console.log('Is Valid:', result?.data === '0x1626ba7e');
  } catch (error) {
    console.error('ERC-1271 Error:', error);
  }
}

testERC1271Delegation();
```

**Time**: 30 minutes

### Step 3: Decision Point - Choose Path

Based on Step 1 results, choose one:

#### Path A: MetaMask Supports Delegation-Aware ERC-1271

**Actions**:
1. Get validator address/module identifier
2. Update agent account deployment to include validator:
   ```typescript
   // In sessionPackageBuilder.ts
   deployParams: [
     ownerAddress,
     [delegationValidatorAddress], // Add validator here
     [],
     []
   ]
   ```
3. Re-deploy agent account (or upgrade if possible)
4. Test ERC-1271 validation again
5. If works: Keep `approverKeyType: '0x0001'` (K1)

**Time**: 2-4 hours (if account upgrade needed)

#### Path B: MetaMask Doesn't Support It - Use DELEGATED KeyType

**Actions** (Already mostly implemented):
1. Revert `approverKeyType` to `'0x8002'` in:
   - `apps/atp-agent/src/worker.ts` (line ~1641)
   - `packages/core/src/server/lib/agentFeedback.ts` (line ~416)
2. Deploy the updated ERC-8092 contract (`AssociationsStoreWithDelegation.sol`)
3. Update contract's `_hasValidDelegation` to match actual DelegationManager interface
4. Test end-to-end flow

**Time**: 2-3 hours (contract deployment + testing)

### Step 4: Implementation

**If Path A**:
- Configure validator in agent account
- Test ERC-1271
- Verify it returns `0x1626ba7e` for delegated signatures

**If Path B**:
- Update code to use DELEGATED keyType
- Deploy updated ERC-8092 contract
- Test `storeAssociation` with delegation validation

### Step 5: Testing & Validation

**Test Checklist**:
- [ ] ERC-1271 validation returns `0x1626ba7e` for delegated signatures
- [ ] ERC-8092 `storeAssociation` succeeds with appropriate keyType
- [ ] Association is stored on-chain
- [ ] Transaction doesn't revert with `0x456db081` (InvalidSignature)

## Quick Start - Do This Now

1. **Check MetaMask Documentation** (30 min):
   ```bash
   # Check if delegation-aware validators exist
   cd node_modules/@metamask/smart-accounts-kit
   # Look for validator examples or documentation
   ```

2. **Run Diagnostic Test** (15 min):
   - Use the test script above
   - Confirm current behavior
   - Document the result

3. **Make Decision**:
   - If validators exist → Path A
   - If validators don't exist → Path B (use DELEGATED keyType)

## Files to Update (Based on Path Chosen)

### Path A (Validator Configuration):
- `packages/core/src/client/sessionPackageBuilder.ts` - Add validator to deployParams
- May need agent account upgrade/redeployment

### Path B (DELEGATED KeyType):
- `apps/atp-agent/src/worker.ts` - Change approverKeyType to `'0x8002'`
- `packages/core/src/server/lib/agentFeedback.ts` - Change approverKeyType to `'0x8002'`
- `contracts/erc8092/AssociationsStoreWithDelegation.sol` - Update delegation validation logic
- Deploy updated ERC-8092 contract

## Resources to Check

1. **MetaMask Smart Accounts Kit**:
   - GitHub: https://github.com/MetaMask/smart-accounts-kit
   - Documentation: Check README and docs folder

2. **ERC-1271 Specification**:
   - https://eips.ethereum.org/EIPS/eip-1271

3. **DelegationManager**:
   - Check `@metamask/smart-accounts-kit/contracts` for interface
   - Look for delegation validation methods

## Recommendation

**Start with Step 1 (Research)** - This will tell us which path to take. If MetaMask doesn't support delegation-aware ERC-1271 validators out of the box, **Path B (DELEGATED keyType) is already implemented** and just needs:
1. Code update to use `'0x8002'` 
2. Contract deployment
3. Testing

The DELEGATED keyType approach is actually cleaner for this use case because it explicitly handles delegation validation at the ERC-8092 contract level, avoiding the need to modify the agent account.

