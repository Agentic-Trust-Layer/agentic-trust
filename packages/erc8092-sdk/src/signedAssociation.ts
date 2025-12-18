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
  const now = typeof params.validAt === "number" ? params.validAt : Math.floor(Date.now() / 1000);
  const initiator = formatEvmV1(params.chainId, params.initiatorAddress);
  const approver = formatEvmV1(params.chainId, params.approverAddress);

  const record = {
    initiator,
    approver,
    validAt: now,
    validUntil: typeof params.validUntil === "number" ? params.validUntil : 0,
    interfaceId: params.interfaceId ?? "0x00000000",
    data: params.data ?? "0x",
  };

  let initiatorSignature = "0x";
  let approverSignature = "0x";

  if (params.signIfEOA) {
    const digest = eip712Hash(record);
    const signerAddr = (await params.wallet.getAddress()).toLowerCase();
    if (params.initiatorAddress.toLowerCase() === signerAddr) {
      initiatorSignature = await params.wallet.signMessage(ethers.getBytes(digest));
    }
    if (params.approverAddress.toLowerCase() === signerAddr) {
      approverSignature = await params.wallet.signMessage(ethers.getBytes(digest));
    }
  }

  return {
    revokedAt: 0,
    initiatorKeyType: params.initiatorKeyType,
    approverKeyType: params.approverKeyType,
    initiatorSignature,
    approverSignature,
    record,
  };
}


