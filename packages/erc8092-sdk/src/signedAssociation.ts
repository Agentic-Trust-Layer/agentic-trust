import { ethers } from "ethers";
import { formatEvmV1 } from "./erc7930";
import { eip712Hash } from "./eip712";
import type { SignedAssociationRecord } from "./types";

export async function buildSignedAssociation(params: {
  chainId: number;
  wallet: ethers.Wallet;
  initiatorAddress: string;
  approverAddress: string;
  initiatorKeyType: string; // bytes2 hex
  approverKeyType: string; // bytes2 hex
  // if true, sign with `wallet` only when initiator/approver matches that EOA.
  signIfEOA?: boolean;
  validAt?: number;
  validUntil?: number;
  interfaceId?: string;
  data?: string;
}): Promise<SignedAssociationRecord> {
  console.log('[buildSignedAssociation] Building association:', {
    chainId: params.chainId,
    initiatorAddress: params.initiatorAddress,
    approverAddress: params.approverAddress,
    initiatorKeyType: params.initiatorKeyType,
    approverKeyType: params.approverKeyType,
    signIfEOA: params.signIfEOA,
    validAt: params.validAt,
    validUntil: params.validUntil,
    interfaceId: params.interfaceId,
    hasData: !!params.data,
  });
  
  const now = typeof params.validAt === "number" ? params.validAt : Math.floor(Date.now() / 1000);
  const initiator = formatEvmV1(params.chainId, params.initiatorAddress);
  const approver = formatEvmV1(params.chainId, params.approverAddress);
  console.log('[buildSignedAssociation] Formatted addresses:', {
    initiatorLength: initiator.length,
    approverLength: approver.length,
  });

  const record = {
    initiator,
    approver,
    validAt: now,
    validUntil: typeof params.validUntil === "number" ? params.validUntil : 0,
    interfaceId: params.interfaceId ?? "0x00000000",
    data: params.data ?? "0x",
  };
  console.log('[buildSignedAssociation] Created record:', {
    validAt: record.validAt,
    validUntil: record.validUntil,
    interfaceId: record.interfaceId,
    dataLength: record.data.length,
  });

  let initiatorSignature = "0x";
  let approverSignature = "0x";

  if (params.signIfEOA) {
    console.log('[buildSignedAssociation] Signing with EOA wallet...');
    const digest = eip712Hash(record);
    const signerAddr = (await params.wallet.getAddress()).toLowerCase();
    console.log('[buildSignedAssociation] Signer address:', signerAddr);
    if (params.initiatorAddress.toLowerCase() === signerAddr) {
      console.log('[buildSignedAssociation] Signing as initiator...');
      initiatorSignature = await params.wallet.signMessage(ethers.getBytes(digest));
    }
    if (params.approverAddress.toLowerCase() === signerAddr) {
      console.log('[buildSignedAssociation] Signing as approver...');
      approverSignature = await params.wallet.signMessage(ethers.getBytes(digest));
    }
  } else {
    console.log('[buildSignedAssociation] Skipping EOA signing (signIfEOA=false)');
  }

  const result = {
    revokedAt: 0,
    initiatorKeyType: params.initiatorKeyType,
    approverKeyType: params.approverKeyType,
    initiatorSignature,
    approverSignature,
    record,
  };
  console.log('[buildSignedAssociation] Returning SAR:', {
    revokedAt: result.revokedAt,
    initiatorKeyType: result.initiatorKeyType,
    approverKeyType: result.approverKeyType,
    initiatorSigLength: result.initiatorSignature.length,
    approverSigLength: result.approverSignature.length,
  });
  
  return result;
}


