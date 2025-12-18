import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getAdminWallet, getSepoliaProvider } from "@/lib/wallet";
import { buildSignedAssociation } from "@/lib/association";
import { getAssociationsProxyAddress } from "@/lib/config";

const ASSOCIATIONS_ABI = [
  "function storeAssociation((uint40 revokedAt,bytes2 initiatorKeyType,bytes2 approverKeyType,bytes initiatorSignature,bytes approverSignature,(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data) record) sar)",
] as const;

async function resolveToAddress(provider: ethers.Provider, value: string): Promise<string> {
  const v = value.trim();
  if (v.startsWith("0x")) return ethers.getAddress(v);
  const resolved = await provider.resolveName(v);
  if (!resolved) throw new Error(`Could not resolve ENS name: ${v}`);
  return ethers.getAddress(resolved);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      initiatorAddress: string;
      approverAddress: string;
      initiatorKeyType?: string;
      approverKeyType?: string;
    };

    if (!body?.initiatorAddress || !body?.approverAddress) {
      return NextResponse.json({ ok: false, error: "Missing initiatorAddress/approverAddress" }, { status: 400 });
    }

    const provider = getSepoliaProvider();
    const wallet = getAdminWallet().connect(provider);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    const initiatorAddress = await resolveToAddress(provider, body.initiatorAddress);
    const approverAddress = await resolveToAddress(provider, body.approverAddress);
    const latestBlock = await provider.getBlock("latest");
    const chainNow = Number(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));
    // small safety buffer to avoid clock skew causing (block.timestamp < validAt)
    const validAt = Math.max(0, chainNow - 10);

    const sar = await buildSignedAssociation({
      chainId,
      wallet,
      initiatorAddress,
      approverAddress,
      initiatorKeyType: body.initiatorKeyType ?? "0x8002",
      approverKeyType: body.approverKeyType ?? "0x8002",
      signIfEOA: false,
      validAt,
    });

    const proxy = getAssociationsProxyAddress();
    const contract = new ethers.Contract(proxy, ASSOCIATIONS_ABI, wallet);
    const tx = await contract.storeAssociation(sar);
    return NextResponse.json({ ok: true, txHash: tx.hash });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


