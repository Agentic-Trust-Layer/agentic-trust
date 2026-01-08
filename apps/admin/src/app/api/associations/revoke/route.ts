export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getAdminPrivateKey, getSepoliaRpcUrl } from "@/lib/config";
import { getAssociationsProxyAddress } from "@/lib/config";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createBundlerClient } from "viem/account-abstraction";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/smart-accounts-kit";
import { getChainBundlerUrl, sepolia } from "@agentic-trust/core/server";

const ASSOCIATIONS_ABI = ["function revokeAssociation(bytes32 associationId, uint40 revokedAt)"] as const;

async function jsonRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as any;
  if (!res.ok || body?.error) {
    const msg = body?.error?.message || `RPC error calling ${method}`;
    throw new Error(msg);
  }
  return body.result as T;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      associationId: string;
      fromAccount: string; // agent AA address that is initiator/approver
      revokedAt?: number; // optional unix timestamp, 0 => immediate
    };

    if (!body?.associationId || !body?.fromAccount) {
      return NextResponse.json({ ok: false, error: "Missing associationId/fromAccount" }, { status: 400 });
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(body.associationId)) {
      return NextResponse.json({ ok: false, error: "Invalid associationId" }, { status: 400 });
    }

    const proxy = getAssociationsProxyAddress();
    const fromAccount = ethers.getAddress(body.fromAccount);
    const revokedAt = Number.isFinite(body.revokedAt as any) ? Number(body.revokedAt) : 0;

    const iface = new ethers.Interface(ASSOCIATIONS_ABI);
    const calldata = iface.encodeFunctionData("revokeAssociation", [body.associationId, revokedAt]);

    // Send a real ERC-4337 UserOperation from the agent AA.
    const rpcUrl = getSepoliaRpcUrl();
    const bundlerUrl = getChainBundlerUrl(11155111);
    const eoa = privateKeyToAccount(getAdminPrivateKey() as `0x${string}`);

    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ chain: sepolia, transport: http(rpcUrl), account: eoa });

    const smartAccount = await toMetaMaskSmartAccount({
      client: publicClient,
      implementation: Implementation.Hybrid,
      signer: { walletClient },
      address: fromAccount as any,
    });

    // Pimlico sponsorship flow (pm_sponsorUserOperation) to avoid ERC-7677 `pm_getPaymasterStubData`.
    const bundlerClient = createBundlerClient({
      transport: http(bundlerUrl),
      chain: sepolia,
    });
    const gasPrice = await jsonRpc<{ fast?: { maxFeePerGas: string; maxPriorityFeePerGas: string } }>(
      bundlerUrl,
      "pimlico_getUserOperationGasPrice",
      [],
    );
    const fee = gasPrice?.fast;
    if (!fee?.maxFeePerGas || !fee?.maxPriorityFeePerGas) {
      throw new Error("Missing gas price data from pimlico_getUserOperationGasPrice");
    }

    // IMPORTANT: do NOT call `sendUserOperation` before sponsorship.
    // `sendUserOperation` runs simulation; if the account has 0 ETH and paymaster isn't attached yet,
    // you'll get `AA21 didn't pay prefund`.
    const baseRequest = await bundlerClient.prepareUserOperation({
      account: smartAccount as any,
      calls: [{ to: proxy as any, data: calldata as any, value: 0n }],
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
      // Avoid gas/paymaster steps pre-sponsorship (they can fail if account has 0 ETH).
      // Include `signature` so viem fills a stub signature via `account.getStubSignature()`.
      parameters: ["factory", "fees", "nonce", "signature"],
    } as any);

    const sponsored = await jsonRpc<any>(bundlerUrl, "pm_sponsorUserOperation", [
      baseRequest,
      (smartAccount as any).entryPoint?.address,
      { mode: "SPONSORED" },
    ]);

    // Defensive check: if the bundler URL isn't a Pimlico-compatible paymaster endpoint,
    // `sponsorUserOperation` may return something without any paymaster fields, and the
    // op will fail with `AA21 didn't pay prefund`.
    const hasPaymaster =
      typeof (sponsored as any)?.paymasterAndData === "string" ||
      typeof (sponsored as any)?.paymaster === "string";
    if (!hasPaymaster) {
      throw new Error(
        "Paymaster sponsorship did not return paymaster fields. " +
          "Check that AGENTIC_TRUST_BUNDLER_URL_SEPOLIA points to a Pimlico-compatible paymaster RPC (supports pm_sponsorUserOperation)."
      );
    }

    const unsignedFinal = { ...baseRequest, ...sponsored };
    const signature = await (smartAccount as any).signUserOperation(unsignedFinal);

    const userOpHash = await bundlerClient.sendUserOperation({
      ...unsignedFinal,
      signature,
      entryPointAddress: (smartAccount as any).entryPoint.address,
    } as any);

    const uoReceipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    const txHash =
      (uoReceipt as any)?.receipt?.transactionHash ??
      (uoReceipt as any)?.receipt?.transactionReceipt?.transactionHash ??
      null;

    return NextResponse.json({ ok: true, userOpHash, txHash });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


