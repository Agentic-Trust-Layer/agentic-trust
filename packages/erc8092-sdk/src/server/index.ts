import { ethers } from "ethers";
import { AssociationsStoreClient } from "../AssociationsStoreClient";

let _providerKey: string | null = null;
let _provider: ethers.JsonRpcProvider | null = null;

export function getRpcProviderSingleton(rpcUrl: string): ethers.JsonRpcProvider {
  const key = String(rpcUrl || "").trim();
  if (!key) throw new Error("rpcUrl is required");
  if (!_provider || _providerKey !== key) {
    _providerKey = key;
    _provider = new ethers.JsonRpcProvider(key);
  }
  return _provider;
}

let _clientKey: string | null = null;
let _client: AssociationsStoreClient | null = null;

export function getAssociationsStoreClientSingleton(params: {
  rpcUrl: string;
  associationsStoreAddress: string;
}): AssociationsStoreClient {
  const provider = getRpcProviderSingleton(params.rpcUrl);
  const addr = ethers.getAddress(params.associationsStoreAddress);
  const key = `${params.rpcUrl}::${addr}`;
  if (!_client || _clientKey !== key) {
    _clientKey = key;
    _client = new AssociationsStoreClient(addr, provider);
  }
  return _client;
}


