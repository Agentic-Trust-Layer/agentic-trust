/**
 * ERC-8092 Association Delegation Test App
 * 
 * This app demonstrates the full flow of:
 * 1. Creating a session smart account
 * 2. Creating a MetaMask delegation from agent account (agentId 114) to session smart account
 * 3. Creating an ERC-8092 association with initiator (EOA) and approver (agent account via delegation)
 * 4. Storing the association on-chain using the session smart account with delegation
 */

import 'dotenv/config';
import { createPublicClient, createWalletClient, http, encodeFunctionData, keccak256, stringToHex, hexToString, toHex, zeroAddress, getAddress, parseAbi, hexToBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { toMetaMaskSmartAccount, Implementation, createDelegation, getSmartAccountsEnvironment, ExecutionMode } from '@metamask/smart-accounts-kit';
import { DelegationManager } from '@metamask/smart-accounts-kit/contracts';
// Note: These imports may need to be adjusted based on package exports
// For now, using direct paths - may need to update package.json exports
import { 
  getChainRpcUrl, 
  getChainBundlerUrl, 
  DEFAULT_CHAIN_ID,
  requireChainEnvVar 
} from '@agentic-trust/core/server';
import { sendSponsoredUserOperation, waitForUserOperationReceipt } from '@agentic-trust/core';
import IdentityRegistryAbi from '@agentic-trust/8004-ext-sdk/abis/IdentityRegistry.json';
import ValidationRegistryAbi from '@agentic-trust/8004-ext-sdk/abis/ValidationRegistry.json';
import { formatEvmV1, associationIdFromRecord } from '@associatedaccounts/erc8092-sdk';

const AGENT_ID = 114;
const CHAIN_ID = 11155111; // Sepolia

// ERC-1271 magic value
const ERC1271_MAGIC = '0x1626ba7e' as const;
const ERC1271_ABI = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'magicValue', type: 'bytes4' }],
  },
] as const;

async function main() {
  console.log('🚀 Starting ERC-8092 Association Delegation Test\n');

  // Step 1: Get agent account for agentId 114
  console.log('Step 1: Getting agent account for agentId', AGENT_ID);
  const rpcUrl = getChainRpcUrl(CHAIN_ID);
  const bundlerUrl = getChainBundlerUrl(CHAIN_ID);
  if (!bundlerUrl) {
    throw new Error(`Bundler URL not configured for chain ${CHAIN_ID}`);
  }

  const identityRegistryAddress = requireChainEnvVar('AGENTIC_TRUST_IDENTITY_REGISTRY', CHAIN_ID) as `0x${string}`;
  const validationRegistryAddress = requireChainEnvVar('AGENTIC_TRUST_VALIDATION_REGISTRY', CHAIN_ID) as `0x${string}`;

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  // Get agent account from IdentityRegistry
  // Allow override via environment variable first (useful for testing)
  let agentAccount: `0x${string}` | null = null;
  const envAgentAccount = process.env.AGENT_ACCOUNT_ADDRESS;
  if (envAgentAccount && /^0x[a-fA-F0-9]{40}$/.test(envAgentAccount)) {
    agentAccount = envAgentAccount as `0x${string}`;
    console.log('✓ Using agent account from AGENT_ACCOUNT_ADDRESS env var:', agentAccount);
  } else {
    // Try to get from registry - first check if agent exists
    try {
      const owner = await publicClient.readContract({
        address: identityRegistryAddress,
        abi: IdentityRegistryAbi as any,
        functionName: 'ownerOf',
        args: [BigInt(AGENT_ID)],
      });
      console.log('✓ Agent exists (owner:', owner, ')');

      // Try to get agent wallet/account from getAgentWallet
      try {
        agentAccount = await publicClient.readContract({
          address: identityRegistryAddress,
          abi: IdentityRegistryAbi as any,
          functionName: 'getAgentWallet',
          args: [BigInt(AGENT_ID)],
        }) as `0x${string}`;
        console.log('✓ Agent account from getAgentWallet:', agentAccount);
      } catch (walletError: any) {
        console.warn('⚠ getAgentWallet failed (wallet may not be set), trying metadata fallback...');
        
        // Fallback: try to get from metadata
        try {
          const metadataValue = await publicClient.readContract({
            address: identityRegistryAddress,
            abi: IdentityRegistryAbi as any,
            functionName: 'getMetadata',
            args: [BigInt(AGENT_ID), 'agentAccount'],
          }) as `0x${string}`;
          
          if (metadataValue && metadataValue !== '0x' && metadataValue.length > 2) {
            // Parse the metadata - getMetadata returns bytes, decode as string
            try {
              const decoded = hexToString(metadataValue);
              // Could be CAIP-10 format (eip155:chainId:address) or raw address
              if (decoded.startsWith('eip155:')) {
                const parts = decoded.split(':');
                const addr = parts[2];
                if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) {
                  agentAccount = addr as `0x${string}`;
                  console.log('✓ Agent account from metadata (CAIP-10 format):', agentAccount);
                }
              } else if (/^0x[a-fA-F0-9]{40}$/.test(decoded)) {
                agentAccount = decoded as `0x${string}`;
                console.log('✓ Agent account from metadata (raw address):', agentAccount);
              }
            } catch (decodeError) {
              console.warn('⚠ Failed to decode metadata as string:', decodeError);
            }
          }
        } catch (metadataError) {
          console.warn('⚠ Metadata fallback also failed:', metadataError);
        }
      }
    } catch (ownerError: any) {
      const errorMsg = ownerError?.shortMessage || ownerError?.message || '';
      if (errorMsg.includes('ERC721NonexistentToken') || errorMsg.includes('ownerOf') || errorMsg.includes('revert')) {
        throw new Error(
          `Agent ID ${AGENT_ID} does not exist or is not registered in IdentityRegistry at ${identityRegistryAddress}.\n` +
          `Please ensure agentId ${AGENT_ID} is registered, or set AGENT_ACCOUNT_ADDRESS environment variable to specify the agent account address directly.`
        );
      }
      throw ownerError;
    }

    // If still no agent account, throw error
    if (!agentAccount) {
      throw new Error(
        `Could not determine agent account for agentId ${AGENT_ID}.\n` +
        `Tried: getAgentWallet() and getMetadata('agentAccount'). Both failed.\n` +
        `The agent exists but the wallet/account address is not set in the registry.\n` +
        `Set AGENT_ACCOUNT_ADDRESS environment variable to specify the agent account address directly.`
      );
    }
  }
  
  console.log('✓ Agent account:', agentAccount);

  // Get agent owner EOA (needed to sign delegation)
  const agentOwnerEOA = await publicClient.readContract({
    address: agentAccount,
    abi: [{ name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as any,
    functionName: 'owner',
    args: [],
  }) as `0x${string}`;
  console.log('✓ Agent owner EOA:', agentOwnerEOA);

  // Get agent owner private key from environment
  const agentOwnerPrivateKey = process.env.AGENT_OWNER_PRIVATE_KEY;
  if (!agentOwnerPrivateKey) {
    throw new Error(
      'AGENT_OWNER_PRIVATE_KEY environment variable is required.\n' +
      'This should be the private key of the agent owner EOA that can sign delegations for the agent account.'
    );
  }
  const normalizedKey = agentOwnerPrivateKey.startsWith('0x') 
    ? agentOwnerPrivateKey 
    : `0x${agentOwnerPrivateKey}`;
  const agentOwnerAccount = privateKeyToAccount(normalizedKey as `0x${string}`);
  
  if (agentOwnerAccount.address.toLowerCase() !== agentOwnerEOA.toLowerCase()) {
    throw new Error(
      `Agent owner private key does not match agent owner EOA.\n` +
      `Expected: ${agentOwnerEOA}\n` +
      `Got: ${agentOwnerAccount.address}`
    );
  }
  console.log('✓ Agent owner private key loaded');

  // Step 2: Create session smart account
  console.log('Step 2: Creating session smart account');
  const sessionPrivateKey = generatePrivateKey();
  const sessionKeyAccount = privateKeyToAccount(sessionPrivateKey);
  console.log('✓ Session key EOA:', sessionKeyAccount.address);

  const sessionAccountClient = await toMetaMaskSmartAccount({
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [sessionKeyAccount.address as `0x${string}`, [], [], []],
    signer: { account: sessionKeyAccount },
    deploySalt: toHex(10),
  } as any);

  const sessionAA = (await sessionAccountClient.getAddress()) as `0x${string}`;
  console.log('✓ Session smart account:', sessionAA);

  // Deploy session account if needed
  const sessionCode = await publicClient.getBytecode({ address: sessionAA });
  const sessionDeployed = !!sessionCode && sessionCode !== '0x';
  if (!sessionDeployed) {
    console.log('  Deploying session account...');
    const hash = await sendSponsoredUserOperation({
      bundlerUrl,
      chain: sepolia,
      accountClient: sessionAccountClient as any,
      calls: [{ to: zeroAddress }],
    });
    await waitForUserOperationReceipt({ bundlerUrl, chain: sepolia, hash });
    console.log('✓ Session account deployed');
  } else {
    console.log('✓ Session account already deployed');
  }

  // Step 3: Create MetaMask delegation from agent account to session smart account
  console.log('\nStep 3: Creating MetaMask delegation');
  const deleGatorEnv = getSmartAccountsEnvironment(CHAIN_ID);

  // Build delegation scope
  const targets: Array<`0x${string}`> = [
    validationRegistryAddress,
    agentAccount, // For ERC-1271 validation
  ];

  // Add ERC-8092 associations proxy
  const associationsProxy = '0xaF7428906D31918dDA2986D1405E2Ded06561E59' as `0x${string}`;
  targets.push(associationsProxy);
  console.log('  Targets:', targets);

  // Build selectors using function signature hashing (keccak256 first 4 bytes)
  const validationResponseSignature = 'validationResponse(bytes32,uint8,string,bytes32,bytes32)';
  const validationResponseSelector = keccak256(stringToHex(validationResponseSignature)).slice(0, 10) as `0x${string}`;

  const getIdentityRegistrySignature = 'getIdentityRegistry()';
  const getIdentityRegistrySelector = keccak256(stringToHex(getIdentityRegistrySignature)).slice(0, 10) as `0x${string}`;

  const storeAssociationSignature = 'storeAssociation((uint40,bytes2,bytes2,bytes,bytes,(bytes,bytes,uint40,uint40,bytes4,bytes)))';
  const storeAssociationSelector = keccak256(stringToHex(storeAssociationSignature)).slice(0, 10) as `0x${string}`;

  const isValidSignatureSignature = 'isValidSignature(bytes32,bytes)';
  const isValidSignatureSelector = keccak256(stringToHex(isValidSignatureSignature)).slice(0, 10) as `0x${string}`;

  const selectors = [
    validationResponseSelector,
    getIdentityRegistrySelector,
    storeAssociationSelector,
    isValidSignatureSelector,
  ] as `0x${string}`[];
  console.log('  Selectors:', selectors);

  const delegation = createDelegation({
    environment: deleGatorEnv,
    scope: {
      type: 'functionCall',
      targets,
      selectors,
    },
    from: agentAccount,
    to: sessionAA,
    caveats: [],
  });

  // Sign delegation with agent account
  console.log('  Signing delegation with agent account...');
  
  // Create agent account client
  const agentWalletClient = createWalletClient({
    chain: sepolia,
    transport: http(rpcUrl),
    account: agentOwnerAccount,
  });

  const agentAccountClient = await toMetaMaskSmartAccount({
    address: agentAccount,
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    signer: { walletClient: agentWalletClient as any },
  } as any);

  // Sign the delegation
  const delegationSignature = (await (agentAccountClient as any).signDelegation({
    delegation,
  })) as `0x${string}`;

  const signedDelegation = {
    ...delegation,
    signature: delegationSignature,
  };
  console.log('✓ Delegation signed');

  // Step 4: Create EOA as initiator
  console.log('\nStep 4: Creating initiator EOA');
  const initiatorPrivateKey = generatePrivateKey();
  const initiatorAccount = privateKeyToAccount(initiatorPrivateKey);
  console.log('✓ Initiator EOA:', initiatorAccount.address);

  // Step 5: Create ERC-8092 association record
  console.log('\nStep 5: Creating ERC-8092 association record');
  const validAt = 0;
  const validUntil = 0;
  const interfaceId = '0x00000000' as `0x${string}`;
  const data = '0x' as `0x${string}`;

  const initiatorBytes = formatEvmV1(CHAIN_ID, initiatorAccount.address) as `0x${string}`;
  const approverBytes = formatEvmV1(CHAIN_ID, agentAccount) as `0x${string}`;

  const record = {
    initiator: initiatorBytes,
    approver: approverBytes,
    validAt,
    validUntil,
    interfaceId,
    data,
  };

  const associationId = associationIdFromRecord(record);
  console.log('✓ Association ID:', associationId);

  // Step 6: Sign as initiator (EOA)
  console.log('\nStep 6: Signing as initiator (EOA)');
  const initiatorWalletClient = createWalletClient({
    chain: sepolia,
    transport: http(rpcUrl),
    account: initiatorAccount,
  });

  // Sign with EIP-712
  const initiatorSignature = (await initiatorWalletClient.signTypedData({
    account: initiatorAccount,
    domain: { name: 'AssociatedAccounts', version: '1' },
    types: {
      AssociatedAccountRecord: [
        { name: 'initiator', type: 'bytes' },
        { name: 'approver', type: 'bytes' },
        { name: 'validAt', type: 'uint40' },
        { name: 'validUntil', type: 'uint40' },
        { name: 'interfaceId', type: 'bytes4' },
        { name: 'data', type: 'bytes' },
      ],
    },
    primaryType: 'AssociatedAccountRecord',
    message: {
      initiator: record.initiator as `0x${string}`,
      approver: record.approver as `0x${string}`,
      validAt: BigInt(record.validAt),
      validUntil: BigInt(record.validUntil),
      interfaceId: record.interfaceId as `0x${string}`,
      data: record.data as `0x${string}`,
    } as any,
  })) as `0x${string}`;
  console.log('✓ Initiator signature:', initiatorSignature.slice(0, 20) + '...');

  // Step 7: Sign as approver (using session smart account with delegation)
  console.log('\nStep 7: Signing as approver (using session smart account with delegation)');
  console.log('  Signing with operator EOA (session key owner)...');
  
  // Sign with the operator EOA (session key owner)
  const operatorWalletClient = createWalletClient({
    chain: sepolia,
    transport: http(rpcUrl),
    account: sessionKeyAccount,
  });

  // Sign with EIP-712
  const approverSignature = (await operatorWalletClient.signTypedData({
    account: sessionKeyAccount,
    domain: { name: 'AssociatedAccounts', version: '1' },
    types: {
      AssociatedAccountRecord: [
        { name: 'initiator', type: 'bytes' },
        { name: 'approver', type: 'bytes' },
        { name: 'validAt', type: 'uint40' },
        { name: 'validUntil', type: 'uint40' },
        { name: 'interfaceId', type: 'bytes4' },
        { name: 'data', type: 'bytes' },
      ],
    },
    primaryType: 'AssociatedAccountRecord',
    message: {
      initiator: record.initiator as `0x${string}`,
      approver: record.approver as `0x${string}`,
      validAt: BigInt(record.validAt),
      validUntil: BigInt(record.validUntil),
      interfaceId: record.interfaceId as `0x${string}`,
      data: record.data as `0x${string}`,
    } as any,
  })) as `0x${string}`;
  console.log('✓ Approver signature (operator EOA):', approverSignature.slice(0, 20) + '...');

  // Test ERC-1271 validation with detailed debugging
  console.log('\n  Testing ERC-1271 validation on agent account...');
  console.log('  Delegation setup:');
  console.log('    Delegator (agentAccount):', agentAccount);
  console.log('    Delegate (sessionAA):', sessionAA);
  console.log('    Signer (operatorAddress):', sessionKeyAccount.address);
  console.log('    Association ID:', associationId);
  
  // First, check if sessionAA validates operator EOA signature (tests ownership)
  try {
    const sessionAAOwner = await publicClient.readContract({
      address: sessionAA,
      abi: [{ type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as any,
      functionName: 'owner',
      args: [],
    });
    console.log('    sessionAA owner:', sessionAAOwner);
    console.log('    operator is owner:', String(sessionAAOwner).toLowerCase() === sessionKeyAccount.address.toLowerCase());
    
    // Test if sessionAA itself validates the operator signature
    const testHash = keccak256(stringToHex('test'));
    const testSig = await operatorWalletClient.signMessage({
      account: sessionKeyAccount,
      message: { raw: hexToBytes(testHash) },
    });
    
    const sessionAAValidates = await publicClient.readContract({
      address: sessionAA,
      abi: ERC1271_ABI as any,
      functionName: 'isValidSignature',
      args: [testHash, testSig],
    });
    console.log('    sessionAA validates operator signature:', String(sessionAAValidates).toLowerCase() === ERC1271_MAGIC.toLowerCase());
  } catch (e: any) {
    console.warn('    Could not check sessionAA ownership:', e?.message || e);
  }
  
  // Now test agent account validation (should check delegation)
  const magic = (await publicClient.readContract({
    address: agentAccount,
    abi: ERC1271_ABI as any,
    functionName: 'isValidSignature',
    args: [associationId as `0x${string}`, approverSignature],
  })) as `0x${string}`;

  const isValid = String(magic).toLowerCase() === ERC1271_MAGIC.toLowerCase();
  if (isValid) {
    console.log('✓ ERC-1271 validation succeeded! (magic:', magic, ')');
  } else {
    console.log('✗ ERC-1271 validation failed (magic:', magic, ', expected:', ERC1271_MAGIC, ')');
    console.log('  Issue: The delegation-aware validator is not recognizing the operator EOA signature.');
    console.log('  Expected behavior: Validator should check if signer owns the delegate (sessionAA).');
    console.log('  Actual behavior: Validator likely only checks if signer IS the delegate.');
    console.log('  Possible solutions:');
    console.log('    1. Change delegate from sessionAA to operatorAddress (requires restructuring)');
    console.log('    2. Use DELEGATED keyType (0x8002) to bypass ERC-1271 validation');
    console.log('    3. Configure validator to check ownership (may not be supported by MetaMask)');
  }

  // Step 8: Store association on-chain using session smart account with delegation
  console.log('\nStep 8: Storing association on-chain');
  const sar = {
    revokedAt: 0,
    initiatorKeyType: '0x0001' as `0x${string}`, // K1
    approverKeyType: '0x0001' as `0x${string}`, // K1 - ERC-8092 will use ERC-1271
    initiatorSignature,
    approverSignature,
    record,
  };

  // Create session account client with delegation
  const sessionAccountClientWithDelegation = await toMetaMaskSmartAccount({
    address: sessionAA,
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    signer: { walletClient: operatorWalletClient as any },
    delegation: {
      delegation: signedDelegation,
      delegator: agentAccount,
    },
  } as any);

  // Encode storeAssociation call using parseAbi (required for viem)
  const ASSOCIATIONS_STORE_ABI = parseAbi([
    'function storeAssociation((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record) sar)',
  ]);

  const callData = encodeFunctionData({
    abi: ASSOCIATIONS_STORE_ABI,
    functionName: 'storeAssociation',
    args: [sar],
  });

  // Build delegation redemption
  const delegationMessage = {
    delegate: getAddress(sessionAA),
    delegator: getAddress(agentAccount),
    authority: (signedDelegation as any).authority as `0x${string}`,
    caveats: (signedDelegation as any).caveats as any[],
    salt: (signedDelegation as any).salt as `0x${string}`,
    signature: delegationSignature,
  };

  const includedExecutions = [
    {
      target: associationsProxy,
      value: 0n,
      callData: callData as `0x${string}`,
    },
  ];

  const redemptionData = DelegationManager.encode.redeemDelegations({
    delegations: [[delegationMessage]],
    modes: [ExecutionMode.SingleDefault],
    executions: [includedExecutions],
  });

  const redemptionCall = {
    to: sessionAA,
    data: redemptionData as `0x${string}`,
    value: 0n,
  };

  console.log('  Sending user operation...');
  const userOpHash = await sendSponsoredUserOperation({
    bundlerUrl,
    chain: sepolia,
    accountClient: sessionAccountClientWithDelegation as any,
    calls: [redemptionCall],
  });

  console.log('  Waiting for receipt...');
  const receipt = await waitForUserOperationReceipt({
    bundlerUrl,
    chain: sepolia,
    hash: userOpHash,
  });

  const txHash = receipt?.transactionHash || (receipt as any)?.receipt?.transactionHash || userOpHash;
  console.log('✓ Association stored on-chain!');
  console.log('  Transaction hash:', txHash);
  console.log('  Association ID:', associationId);

  console.log('\n✅ Test completed successfully!');
  console.log('\nSummary:');
  console.log('  - Agent account:', agentAccount);
  console.log('  - Session smart account:', sessionAA);
  console.log('  - Initiator EOA:', initiatorAccount.address);
  console.log('  - Operator EOA (signer):', sessionKeyAccount.address);
  console.log('  - Association ID:', associationId);
  console.log('  - Transaction hash:', txHash);
  console.log('  - ERC-1271 validation:', isValid ? '✓ PASSED' : '✗ FAILED');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

