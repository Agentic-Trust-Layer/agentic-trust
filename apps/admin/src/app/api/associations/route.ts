export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSepoliaProvider } from "@/lib/wallet";
import { getAssociationsProxyAddress } from "@/lib/config";
import { formatEvmV1, tryParseEvmV1 } from "@/lib/erc7930";

const ABI = [
  "function getAssociationsForAccount(bytes account) view returns ((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record)[] sars)",
] as const;

const DOMAIN_TYPEHASH = ethers.id("EIP712Domain(string name,string version)");
const NAME_HASH = ethers.id("AssociatedAccounts");
const VERSION_HASH = ethers.id("1");
const MESSAGE_TYPEHASH = ethers.id(
  "AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)"
);
const abi = ethers.AbiCoder.defaultAbiCoder();

function domainSeparator(): string {
  return ethers.keccak256(abi.encode(["bytes32", "bytes32", "bytes32"], [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH]));
}

function associationIdFromRecord(rec: {
  initiator: string;
  approver: string;
  validAt: number;
  validUntil: number;
  interfaceId: string;
  data: string;
}): string {
  const hs = ethers.keccak256(
    abi.encode(
      ["bytes32", "bytes32", "bytes32", "uint40", "uint40", "bytes4", "bytes32"],
      [
        MESSAGE_TYPEHASH,
        ethers.keccak256(rec.initiator),
        ethers.keccak256(rec.approver),
        rec.validAt,
        rec.validUntil,
        rec.interfaceId,
        ethers.keccak256(rec.data),
      ]
    )
  );
  return ethers.keccak256(ethers.solidityPacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSeparator(), hs]));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const account = searchParams.get("account");
    const chainIdParam = searchParams.get("chainId");
    
    if (!account) return NextResponse.json({ ok: false, error: "Missing account" }, { status: 400 });

    // Use provided chainId or default to Sepolia
    let chainId: number;
    let provider: ethers.Provider;
    
    if (chainIdParam) {
      chainId = Number.parseInt(chainIdParam, 10);
      if (!Number.isFinite(chainId) || chainId <= 0) {
        return NextResponse.json({ ok: false, error: "Invalid chainId parameter" }, { status: 400 });
      }
      // Get provider for the specified chain
      const rpcUrl =
        (chainId === 11155111
          ? process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA || process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA
          : chainId === 84532
          ? process.env.AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA || process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA
          : chainId === 11155420
          ? process.env.AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA || process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA
          : undefined) ||
        process.env.AGENTIC_TRUST_RPC_URL ||
        process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL;
      
      if (!rpcUrl) {
        return NextResponse.json({ ok: false, error: `RPC URL not configured for chain ${chainId}` }, { status: 400 });
      }
      provider = new ethers.JsonRpcProvider(rpcUrl);
    } else {
      // Fallback to Sepolia for backward compatibility
      provider = getSepoliaProvider();
      const network = await provider.getNetwork();
      chainId = Number(network.chainId);
    }

    const addr = account.startsWith("0x")
      ? ethers.getAddress(account)
      : ethers.getAddress((await provider.resolveName(account)) ?? "");
    const interoperable = formatEvmV1(chainId, addr);

    const proxy = getAssociationsProxyAddress();
    const contract = new ethers.Contract(proxy, ABI, provider);
    const sars = await contract.getAssociationsForAccount(interoperable);

    const mapped = (sars as any[]).map((sar) => {
      const initiatorParsed = tryParseEvmV1(sar.record.initiator);
      const approverParsed = tryParseEvmV1(sar.record.approver);
      const initiatorAddr = initiatorParsed?.address ?? sar.record.initiator;
      const approverAddr = approverParsed?.address ?? sar.record.approver;
      const associationId = associationIdFromRecord({
        initiator: sar.record.initiator,
        approver: sar.record.approver,
        validAt: Number(sar.record.validAt),
        validUntil: Number(sar.record.validUntil),
        interfaceId: sar.record.interfaceId,
        data: sar.record.data,
      });

      const aLower = addr.toLowerCase();
      const counterparty =
        initiatorAddr.toLowerCase() === aLower ? approverAddr : approverAddr.toLowerCase() === aLower ? initiatorAddr : approverAddr;
      return {
        associationId,
        revokedAt: Number(sar.revokedAt),
        initiator: initiatorAddr,
        approver: approverAddr,
        counterparty,
        validAt: Number(sar.record.validAt),
        validUntil: Number(sar.record.validUntil),
      };
    });

    return NextResponse.json({ ok: true, chainId, account: addr, associations: mapped });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


