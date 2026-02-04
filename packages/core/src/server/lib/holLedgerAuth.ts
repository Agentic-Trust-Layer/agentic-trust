import { RegistryBrokerClient } from '@hashgraphonline/standards-sdk';

export type HolLedgerChallenge = {
  challengeId: string;
  message: string;
  expiresAt: string;
};

export type HolLedgerVerifyResult = {
  key: string;
  apiKey: {
    id: string;
    prefix: string;
    lastFour: string;
    ownerType: 'ledger';
    label?: string;
    createdAt: string;
    lastUsedAt?: string | null;
    ledgerAccountId?: string;
    ledgerNetwork?: string;
    ledgerNetworkCanonical?: string;
  };
  accountId: string;
  network: string;
  networkCanonical?: string;
};

export async function createHolLedgerChallenge(input: { accountId: string }): Promise<HolLedgerChallenge> {
  const accountId = String(input?.accountId ?? '').trim();
  if (!accountId) {
    throw new Error('createHolLedgerChallenge: accountId is required');
  }

  const baseUrl = String(process.env.REGISTRY_BROKER_API_URL ?? '').trim() || undefined;
  const apiKey = String(process.env.REGISTRY_BROKER_API_KEY ?? '').trim() || undefined;
  const networkRaw = String(process.env.HOL_HEDERA_NETWORK ?? '').trim().toLowerCase();
  const network = networkRaw === 'mainnet' || networkRaw === 'testnet' ? networkRaw : null;
  if (!network) {
    throw new Error('createHolLedgerChallenge: HOL_HEDERA_NETWORK must be mainnet or testnet');
  }

  const client = new RegistryBrokerClient({
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });

  return (client as any).createLedgerChallenge({ accountId, network });
}

export async function verifyHolLedgerChallenge(input: {
  accountId: string;
  challengeId: string;
  signature: string;
  signatureKind?: 'raw' | 'map' | 'evm';
  publicKey?: string;
  expiresInMinutes?: number;
}): Promise<HolLedgerVerifyResult> {
  const accountId = String(input?.accountId ?? '').trim();
  const challengeId = String(input?.challengeId ?? '').trim();
  const signature = String(input?.signature ?? '').trim();
  if (!accountId || !challengeId || !signature) {
    throw new Error('verifyHolLedgerChallenge: accountId, challengeId, and signature are required');
  }

  const baseUrl = String(process.env.REGISTRY_BROKER_API_URL ?? '').trim() || undefined;
  const apiKey = String(process.env.REGISTRY_BROKER_API_KEY ?? '').trim() || undefined;
  const networkRaw = String(process.env.HOL_HEDERA_NETWORK ?? '').trim().toLowerCase();
  const network = networkRaw === 'mainnet' || networkRaw === 'testnet' ? networkRaw : null;
  if (!network) {
    throw new Error('verifyHolLedgerChallenge: HOL_HEDERA_NETWORK must be mainnet or testnet');
  }

  const client = new RegistryBrokerClient({
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });

  const payload: any = { accountId, network, challengeId, signature };
  if (input.signatureKind) payload.signatureKind = input.signatureKind;
  if (input.publicKey) payload.publicKey = input.publicKey;
  if (typeof input.expiresInMinutes === 'number') payload.expiresInMinutes = input.expiresInMinutes;

  return (client as any).verifyLedgerChallenge(payload);
}

