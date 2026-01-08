/**
 * Agent Feedback API
 * 
 * Handles feedback authentication for agents
 */

import type { PublicClient, Account } from 'viem';
import { ethers } from 'ethers';
import { getReputationRegistryClient } from '../singletons/reputationClient';
import { encodeAssociationData } from './association';
import { getIPFSStorage } from './ipfs';

// Cache for the ABI to avoid reloading it multiple times
let abiCache: any = null;

/**
 * Load IdentityRegistry ABI using dynamic import
 * NOTE: This function should only be called server-side (Next.js API routes)
 */
const getIdentityRegistryAbi = async (): Promise<any> => {
  // Return cached ABI if available
  if (abiCache) {
    return abiCache;
  }

  try {
    // Dynamic import to avoid bundling JSON in client-side code if this module is tree-shaken improperly
    const mod = await import('@agentic-trust/8004-ext-sdk/abis/IdentityRegistry.json');
    abiCache = mod.default;
    return abiCache;
  } catch (error) {
    console.error('Failed to load IdentityRegistry ABI:', error);
    throw new Error(
      `Failed to load IdentityRegistry ABI: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export interface RequestAuthParams {
  publicClient: PublicClient;
  agentId: bigint;
  clientAddress: `0x${string}`;
  signer: Account;
  walletClient?: any;
  expirySeconds?: number;
}

export type FeedbackAuthDelegationAssociation = {
  // Deterministic ERC-8092 association id (EIP-712 hash of record)
  associationId: `0x${string}`;
  // Inputs needed by clients to finalize + store on-chain (client must add initiatorSignature).
  initiatorAddress: `0x${string}`;
  approverAddress: `0x${string}`;
  assocType: 1; // Delegation
  validAt: number;
  validUntil: number;
  data: `0x${string}`;
  approverSignature: `0x${string}`;
  // Full SAR skeleton (initiatorSignature is intentionally empty for the client to fill)
  sar: {
    revokedAt: number;
    initiatorKeyType: `0x${string}`;
    approverKeyType: `0x${string}`;
    initiatorSignature: `0x${string}`;
    approverSignature: `0x${string}`;
    record: {
      initiator: `0x${string}`;
      approver: `0x${string}`;
      validAt: number;
      validUntil: number;
      interfaceId: `0x${string}`;
      data: `0x${string}`;
    };
  };
  // Human-readable details (mirrors what's embedded in `data` as JSON string)
  delegation: Record<string, unknown>;
};

export type CreateFeedbackAuthWithDelegationResult = {
  feedbackAuth: `0x${string}`;
  delegationAssociation?: FeedbackAuthDelegationAssociation;
};

const U40_MAX = 1099511627775; // 2^40-1

function clampU40(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), U40_MAX);
}

function toMinimalBigEndianBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0]);
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return ethers.getBytes(`0x${hex}`);
}

// Mirrors `InteroperableAddress.formatEvmV1(chainid, addr)` from the ERC-8092 reference.
function formatEvmV1(chainId: number, address: string): `0x${string}` {
  const addr = ethers.getAddress(address);
  const chainRef = toMinimalBigEndianBytes(BigInt(chainId));
  const head = ethers.getBytes('0x00010000');
  const out = ethers.concat([
    head,
    new Uint8Array([chainRef.length]),
    chainRef,
    new Uint8Array([20]),
    ethers.getBytes(addr),
  ]);
  return ethers.hexlify(out) as `0x${string}`;
}

function erc8092RecordDigest(rec: {
  initiator: `0x${string}`;
  approver: `0x${string}`;
  validAt: number;
  validUntil: number;
  interfaceId: `0x${string}`;
  data: `0x${string}`;
}): `0x${string}` {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const DOMAIN_TYPEHASH = ethers.id('EIP712Domain(string name,string version)');
  const NAME_HASH = ethers.id('AssociatedAccounts');
  const VERSION_HASH = ethers.id('1');
  const MESSAGE_TYPEHASH = ethers.id(
    'AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)',
  );

  const domainSeparator = ethers.keccak256(
    abiCoder.encode(['bytes32', 'bytes32', 'bytes32'], [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH]),
  );

  const hashStruct = ethers.keccak256(
    abiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint40', 'uint40', 'bytes4', 'bytes32'],
      [
        MESSAGE_TYPEHASH,
        ethers.keccak256(rec.initiator),
        ethers.keccak256(rec.approver),
        rec.validAt,
        rec.validUntil,
        rec.interfaceId,
        ethers.keccak256(rec.data),
      ],
    ),
  );

  return ethers.keccak256(
    ethers.solidityPacked(['bytes2', 'bytes32', 'bytes32'], ['0x1901', domainSeparator, hashStruct]),
  ) as `0x${string}`;
}

/**
 * Create feedback auth signature
 */
export async function createFeedbackAuth(
  params: RequestAuthParams,
): Promise<`0x${string}`> {
  const { signedAuth } = await createFeedbackAuthInternal(params);
  return signedAuth;
}

/**
 * Create feedback auth signature and also produce a pre-signed ERC-8092 delegation association
 * record (approver signature only). The client can add the initiator signature and store it
 * on-chain to memorialize the delegation that grants rights to "give feedback".
 */
export async function createFeedbackAuthWithDelegation(
  params: RequestAuthParams,
): Promise<CreateFeedbackAuthWithDelegationResult> {
  const {
    signedAuth,
    chainId,
    indexLimit,
    expiry,
    identityRegistry,
  } = await createFeedbackAuthInternal(params);

  // Best-effort: build delegation association. If it fails, still return feedbackAuth.
  try {
    const chainIdNum = Number(chainId);
    if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
      throw new Error(`Invalid chainId for delegation association: ${String(chainId)}`);
    }
    const approverAddress = ethers.getAddress(String(params.signer?.address || '')) as `0x${string}`;
    const initiatorAddress = ethers.getAddress(params.clientAddress) as `0x${string}`;

    // NOTE: We use validAt=0 to avoid "validAt in the future" edge-cases during on-chain store,
    // where some ERC-8092 store implementations may reject records with validAt > block.timestamp.
    const validAt = 0;
    // IMPORTANT: keep validUntil=0 for compatibility with the current server-side association store prep,
    // which always uses record.validUntil=0. Expiry is still embedded in the delegation payload.
    const validUntil = 0;

    const delegation = {
      kind: 'erc8004.feedbackAuth.delegation',
      feedbackAuth: signedAuth,
      agentId: params.agentId.toString(),
      clientAddress: initiatorAddress,
      chainId: chainIdNum,
      indexLimit: indexLimit.toString(),
      expiry: expiry.toString(),
      identityRegistry,
      signerAddress: approverAddress,
      createdAt: new Date().toISOString(),
    };

    // Upload the full delegation payload to IPFS so the ERC-8092 record can carry a small pointer.
    let payloadTokenUri: string | null = null;
    let payloadCid: string | null = null;
    try {
      const ipfs = getIPFSStorage();
      const upload = await ipfs.upload(JSON.stringify(delegation, null, 2), 'feedbackAuth-delegation.json');
      payloadCid = upload.cid;
      payloadTokenUri = upload.tokenUri; // ipfs://CID
    } catch (ipfsErr) {
      console.warn('[createFeedbackAuthWithDelegation] Failed to upload delegation payload to IPFS (continuing):', ipfsErr);
    }

    const delegationRef = {
      type: 'erc8004.feedbackAuth.delegation',
      payloadUri: payloadTokenUri,
      payloadCid,
      // minimal searchable fields
      agentId: params.agentId.toString(),
      clientAddress: initiatorAddress,
      chainId: chainIdNum,
      createdAt: new Date().toISOString(),
    };

    const data = encodeAssociationData({
      assocType: 1,
      // ERC-8092 record "ipfs content section": embed an IPFS URI pointer in the description JSON.
      description: JSON.stringify(delegationRef),
    });

    const record = {
      initiator: formatEvmV1(chainIdNum, initiatorAddress),
      approver: formatEvmV1(chainIdNum, approverAddress),
      validAt,
      validUntil,
      interfaceId: '0x00000000' as `0x${string}`,
      data,
    };

    const associationId = erc8092RecordDigest(record);

    if (!params.walletClient) {
      throw new Error('walletClient is required to sign delegation association');
    }

    // IMPORTANT:
    // Sign using EIP-712 typed data so the signature validates against the raw EIP-712 digest (no EIP-191 prefix).
    // Our digest scheme uses ONLY domain {name, version} (no chainId/verifyingContract).
    const approverSignature = (await params.walletClient.signTypedData({
      account: params.signer,
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
        initiator: record.initiator,
        approver: record.approver,
        validAt: BigInt(record.validAt),
        validUntil: BigInt(record.validUntil),
        interfaceId: record.interfaceId,
        data: record.data,
      },
    })) as `0x${string}`;

    const sar = {
      revokedAt: 0,
      // IMPORTANT: use K1 (0x0001) to stay compatible with OZ SignatureChecker rules in the ERC-8092 ref impl.
      initiatorKeyType: '0x0001' as `0x${string}`,
      approverKeyType: '0x0001' as `0x${string}`,
      initiatorSignature: '0x' as `0x${string}`,
      approverSignature,
      record,
    };

    return {
      feedbackAuth: signedAuth,
      delegationAssociation: {
        associationId,
        initiatorAddress,
        approverAddress,
        assocType: 1,
        validAt,
        validUntil,
        data,
        approverSignature,
        sar,
        delegation: {
          ...delegationRef,
          // Include the full payload inline too (best-effort convenience for clients),
          // but the canonical copy is the IPFS payload when available.
          payload: delegation,
        },
      },
    };
  } catch (e) {
    console.warn('[createFeedbackAuthWithDelegation] Failed to create delegation association (continuing):', e);
    return { feedbackAuth: signedAuth };
  }
}

async function createFeedbackAuthInternal(params: RequestAuthParams): Promise<{
  signedAuth: `0x${string}`;
  authStruct: any;
  encoded: `0x${string}`;
  chainId: bigint;
  indexLimit: bigint;
  expiry: bigint;
  identityRegistry: `0x${string}`;
}> {
  const {
    publicClient,
    agentId,
    clientAddress,
    signer,
    walletClient,
    expirySeconds = 3600,
  } = params;

  // Get the shared reputation client singleton
  const reputationClient = await getReputationRegistryClient();

  // Get identity registry from reputation client
  const identityReg = await reputationClient.getIdentityRegistry();

  // Load IdentityRegistry ABI (async dynamic import)
  const identityRegistryAbi = await getIdentityRegistryAbi();

  // Ensure IdentityRegistry operator approvals are configured for sessionAA
  console.info("**********************************");
  console.info("createFeedbackAuth: ", agentId, clientAddress, signer.address as `0x${string}`);
  try {
    const ownerOfAgent = await publicClient.readContract({
      address: identityReg as `0x${string}`,
      abi: identityRegistryAbi as any,
      functionName: 'ownerOf' as any,
      args: [agentId],
    }) as `0x${string}`;

    const isOperator = await publicClient.readContract({
      address: identityReg as `0x${string}`,
      abi: identityRegistryAbi as any,
      functionName: 'isApprovedForAll' as any,
      args: [ownerOfAgent, signer.address as `0x${string}`],
    }) as boolean;
    

    const tokenApproved = await publicClient.readContract({
      address: identityReg as `0x${string}`,
      abi: identityRegistryAbi as any,
      functionName: 'getApproved' as any,
      args: [agentId],
    }) as `0x${string}`;

    console.info('IdentityRegistry approvals:', { ownerOfAgent, isOperator, tokenApproved });
    if (!isOperator && tokenApproved.toLowerCase() !== (signer.address as string).toLowerCase()) {
      throw new Error(`IdentityRegistry approval missing: neither isApprovedForAll nor getApproved`);
    }
  } catch (e: any) {
    console.warn('[IdentityRegistry] approval check failed:', e?.message || e);
    throw e;
  }


  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const chainId = BigInt(publicClient.chain?.id ??  0);

  const U64_MAX = 18446744073709551615n;
  const lastIndexFetched = await reputationClient.getLastIndex(agentId, clientAddress);
  let indexLimit = lastIndexFetched + 1n;
  let expiry = nowSec + BigInt(expirySeconds);
  if (expiry > U64_MAX) {
    console.warn('[FeedbackAuth] Computed expiry exceeds uint64; clamping to max');
    expiry = U64_MAX;
  }

  // Build FeedbackAuth struct via ReputationClient
  console.info("create feedback auth structure: ", agentId, clientAddress, indexLimit, expiry, chainId, signer.address as `0x${string}`);
  const authStruct = reputationClient.createFeedbackAuth(
    agentId,
    clientAddress,
    indexLimit,
    expiry,
    chainId,
    signer.address as `0x${string}`,
  );

  // Note: log the struct directly; JSON.stringify cannot handle BigInt values.
  console.info('authStruct:', authStruct);

  // Sign keccak256(encoded tuple) with provided signer (sessionAA via ERC-1271)
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'uint256', 'uint256', 'uint256', 'address', 'address'],
    [
      authStruct.agentId,
      authStruct.clientAddress,
      authStruct.indexLimit,
      authStruct.expiry,
      authStruct.chainId,
      authStruct.identityRegistry,
      authStruct.signerAddress,
    ]
  );
  const messageHash = ethers.keccak256(encoded) as `0x${string}`;
  
  // Sign the message hash using the wallet client
  if (!walletClient) {
    throw new Error('walletClient is required for signing feedback auth');
  }
  
  const signature = await walletClient.signMessage({
    account: signer,
    message: { raw: ethers.getBytes(messageHash) },
  });

  console.info("signature: ", signature);

  const signedAuth = ethers.concat([encoded, signature]) as `0x${string}`;
  return {
    signedAuth,
    authStruct,
    encoded: encoded as `0x${string}`,
    chainId,
    indexLimit,
    expiry,
    identityRegistry: identityReg as `0x${string}`,
  };
}
