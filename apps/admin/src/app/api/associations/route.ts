export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { associationIdFromRecord } from "@associatedaccounts/erc8092-sdk";
import { getAssociationsProxyAddress } from "../../../lib/config";

function normalizeEvmAddress(input: string): string {
  // ethers.getAddress rejects invalid mixed-case checksums.
  // To accept "explicitly-defined" but non-checksummed addresses, coerce to lowercase first.
  const s = String(input || "").trim();
  if (!s.startsWith("0x")) {
    throw new Error("Address must start with 0x");
  }
  try {
    return ethers.getAddress(s);
  } catch {
    return ethers.getAddress(s.toLowerCase());
  }
}

function normalizeRecordAddresses<T>(value: T): T {
  // Normalize any EVM addresses found in records to avoid checksum-related throws downstream.
  // Only touches 20-byte hex addresses (0x + 40 hex chars). Leaves signatures/hashes intact.
  if (typeof value === "string") {
    const s = value.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
      try {
        return normalizeEvmAddress(s) as unknown as T;
      } catch {
        // If it's malformed hex, leave it as-is and let downstream validation report it.
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeRecordAddresses(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeRecordAddresses(v);
    }
    return out as unknown as T;
  }
  return value;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const account = searchParams.get("account");
    const chainIdParam = searchParams.get("chainId");
    
    if (!account) return NextResponse.json({ ok: false, error: "Missing account" }, { status: 400 });

    const chainId = chainIdParam ? Number.parseInt(chainIdParam, 10) : 11155111;
    if (!Number.isFinite(chainId) || chainId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid chainId parameter" }, { status: 400 });
    }

    let addr: string;
    try {
      addr = account.startsWith("0x") ? normalizeEvmAddress(account) : account;
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message || "Invalid account address" },
        { status: 400 },
      );
    }

    // Use admin app's resolved associations proxy address (guards against misconfigured env vars in core singleton).
    const associationsProxyAddress = getAssociationsProxyAddress();

    // RPC URL (used for both read ops and verification below)
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
      return NextResponse.json(
        { ok: false, error: "RPC URL not configured for associations lookup" },
        { status: 500 },
      );
    }

    // Build a minimal associations client pointed at the admin-configured proxy.
    const associationsClient = await (async () => {
      const { AIAgentAssociationClient } = await import("@agentic-trust/8004-ext-sdk");
      const { encodeFunctionData } = await import("viem");
      const accountProvider = {
        chain: () => ({ id: chainId, rpcUrl }),
        encodeFunctionData: async (params: any) => encodeFunctionData(params) as any,
        send: async () => {
          throw new Error("Not implemented");
        },
      };
      return AIAgentAssociationClient.create(accountProvider as any, associationsProxyAddress as `0x${string}`);
    })();

    const result = await associationsClient.getSignedAssociationsForEvmAccount({
      chainId,
      accountAddress: addr,
    });

    // Server-side verification (limited to known key types)
    const provider = rpcUrl ? new ethers.JsonRpcProvider(rpcUrl) : null;
    const ERC1271_ABI = ["function isValidSignature(bytes32, bytes) view returns (bytes4)"] as const;
    const ERC1271_MAGIC = "0x1626ba7e";

    const verifyK1 = async (params: {
      signerAddress?: string;
      digest: string;
      signature: string;
    }): Promise<{ ok: boolean; method: string; reason?: string }> => {
      if (!params.signerAddress) return { ok: false, method: "k1", reason: "missing signer address" };
      if (!params.signature || params.signature === "0x") return { ok: false, method: "k1", reason: "missing signature" };
      if (!provider) return { ok: false, method: "k1", reason: "rpc not configured for verification" };
      let signer: string;
      try {
        signer = normalizeEvmAddress(params.signerAddress);
      } catch (e: any) {
        return { ok: false, method: "k1", reason: e?.message || "invalid signer address" };
      }
      try {
        const code = await provider.getCode(signer);
        const isContract = !!code && code !== "0x";
        if (isContract) {
          const c = new ethers.Contract(signer, ERC1271_ABI, provider);
          const res = (await c.isValidSignature(params.digest, params.signature)) as string;
          return res?.toLowerCase?.() === ERC1271_MAGIC ? { ok: true, method: "erc1271" } : { ok: false, method: "erc1271", reason: "isValidSignature != magic" };
        }
        const recovered = ethers.recoverAddress(params.digest, params.signature);
        return recovered.toLowerCase() === signer.toLowerCase()
          ? { ok: true, method: "ecrecover" }
          : { ok: false, method: "ecrecover", reason: `recovered ${recovered}` };
      } catch (e: any) {
        return { ok: false, method: "k1", reason: e?.message || "verification failed" };
      }
    };

    const enriched = (result.sars as any[]).map((sar) => {
      const normalizedRecord = normalizeRecordAddresses(sar.record);
      let digest: string | null = null;
      let digestError: string | undefined;
      try {
        digest = associationIdFromRecord(normalizedRecord);
      } catch (e: any) {
        digestError = e?.message || "failed to compute associationId";
      }

      const recordHashMatches =
        digest !== null &&
        String(sar.associationId).toLowerCase() === String(digest).toLowerCase();

      const initiatorVerify =
        digest !== null && String(sar.initiatorKeyType).toLowerCase() === "0x0001"
          ? verifyK1({ signerAddress: sar.initiatorAddress, digest, signature: sar.initiatorSignature })
          : Promise.resolve({
              ok: false,
              method: String(sar.initiatorKeyType),
              reason: digest === null ? `digest unavailable: ${digestError || "unknown"}` : "unsupported keyType",
            });
      const approverVerify =
        digest !== null && String(sar.approverKeyType).toLowerCase() === "0x0001"
          ? verifyK1({ signerAddress: sar.approverAddress, digest, signature: sar.approverSignature })
          : Promise.resolve({
              ok: false,
              method: String(sar.approverKeyType),
              reason: digest === null ? `digest unavailable: ${digestError || "unknown"}` : "unsupported keyType",
            });

      return {
        sar: { ...sar, record: normalizedRecord },
        digest: digest ?? "0x",
        digestError,
        recordHashMatches,
        initiatorVerify,
        approverVerify,
      };
    });

    const verified = await Promise.all(
      enriched.map(async (e) => ({
        ...e.sar,
        verification: {
          digest: e.digest,
          digestError: e.digestError,
          recordHashMatches: e.recordHashMatches,
          initiator: await e.initiatorVerify,
          approver: await e.approverVerify,
        },
      })),
    );

    return NextResponse.json({ ok: true, chainId: result.chainId, account: result.account, associations: verified });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


