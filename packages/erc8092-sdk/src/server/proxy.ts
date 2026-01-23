import { ethers } from "ethers";
import { ASSOCIATIONS_STORE_ABI } from "../abi";

export async function pickAssociationsStoreProxy(params: {
  rpcUrl: string;
  candidates: string[];
  // If true, require that the proxy exposes the SC-DELEGATION config getters.
  requireDelegationConfig?: boolean;
}): Promise<string> {
  const provider = new ethers.JsonRpcProvider(params.rpcUrl);
  const tried: string[] = [];
  for (const raw of params.candidates) {
    if (!raw) continue;
    let addr: string;
    try {
      addr = ethers.getAddress(raw);
    } catch {
      continue;
    }
    tried.push(addr);
    const code = await provider.getCode(addr);
    if (!code || code === "0x") continue;

    const c = new ethers.Contract(addr, ASSOCIATIONS_STORE_ABI, provider);
    try {
      // Always ensure the base function exists.
      await c.getAssociationsForAccount("0x");
    } catch {
      continue;
    }

    if (params.requireDelegationConfig) {
      try {
        // Old proxies will revert (or return garbage) here.
        await c.delegationManager();
        await c.scDelegationEnforcer();
        await c.scDelegationVerifier();
      } catch {
        continue;
      }
    }

    return addr;
  }
  throw new Error(`No compatible AssociationsStore proxy found. Tried: ${tried.join(", ")}`);
}

