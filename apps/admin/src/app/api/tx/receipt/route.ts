export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSepoliaProvider } from "@/lib/wallet";
import { ethers } from "ethers";

function serializeReceipt(r: ethers.TransactionReceipt) {
  return {
    transactionHash: r.hash,
    status: r.status, // 1 success, 0 failure (or null on pre-byzantium; not applicable here)
    blockNumber: r.blockNumber,
    blockHash: r.blockHash,
    from: r.from,
    to: r.to,
    contractAddress: r.contractAddress,
    gasUsed: r.gasUsed?.toString?.() ?? String(r.gasUsed),
    cumulativeGasUsed: r.cumulativeGasUsed?.toString?.() ?? String(r.cumulativeGasUsed),
    logsBloom: r.logsBloom,
    logs: r.logs,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const hash = searchParams.get("hash");
    if (!hash) {
      return NextResponse.json({ ok: false, error: "Missing hash" }, { status: 400 });
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return NextResponse.json({ ok: false, error: "Invalid tx hash" }, { status: 400 });
    }

    const provider = getSepoliaProvider();
    const receipt = await provider.getTransactionReceipt(hash);
    if (!receipt) return NextResponse.json({ ok: true, found: false });

    return NextResponse.json({ ok: true, found: true, receipt: serializeReceipt(receipt) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


