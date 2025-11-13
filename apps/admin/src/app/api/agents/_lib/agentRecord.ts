import { getIPFSStorage } from '@agentic-trust/core';
import { getIdentityClient } from '@agentic-trust/core/server';
import { getAdminClient } from '@/lib/client';
import { parse8004Did } from '@agentic-trust/core';

const METADATA_KEYS = ['agentName', 'agentAccount'] as const;

export const DEFAULT_CHAIN_ID = 11155111;

type MetadataKeys = (typeof METADATA_KEYS)[number];

export interface AgentRecordPayload {
  success: true;
  agentId: string;
  chainId: number;
  identityMetadata: {
    tokenURI: string | null;
    metadata: Record<MetadataKeys, string>;
  };
  identityRegistration: { tokenURI: string; registration: Record<string, unknown> | null } | null;
  discovery: Record<string, unknown> | null;
  [key: string]: unknown;
}

export async function buildAgentRecord(
  agentIdentifier: string | bigint,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<AgentRecordPayload> {
  const isDid = typeof agentIdentifier === 'string' && agentIdentifier.trim().startsWith('did:8004:');
  let resolvedChainId = chainId;
  let agentId: string;
  let agentIdBigInt: bigint;
  let did8004: string | undefined;

  if (isDid) {
    did8004 = decodeURIComponent((agentIdentifier as string).trim());
    const parsed = parse8004Did(did8004);
    resolvedChainId = parsed.chainId;
    agentId = parsed.agentId;
    try {
      agentIdBigInt = BigInt(agentId);
    } catch (error) {
      throw new Error(`Invalid agentId in did:8004 identifier: ${did8004}`);
    }
  } else {
    const agentIdInput = agentIdentifier;
    agentIdBigInt =
      typeof agentIdInput === 'bigint'
        ? agentIdInput
        : (() => {
            try {
              return BigInt(agentIdInput);
            } catch (error) {
              throw new Error(`Invalid agentId: ${agentIdInput}`);
            }
          })();
    agentId = agentIdBigInt.toString();
  }

  const client = await getAdminClient();
  const identityClient = await getIdentityClient(resolvedChainId);

  const tokenURI = await identityClient.getTokenURI(agentIdBigInt);

  const metadata: Record<MetadataKeys, string> = {} as Record<MetadataKeys, string>;
  for (const key of METADATA_KEYS) {
    try {
      const value = await identityClient.getMetadata(agentIdBigInt, key);
      if (value) {
        metadata[key] = value;
      }
    } catch (error) {
      console.warn(`Failed to get metadata key ${key}:`, error);
    }
  }

  const identityMetadata = {
    tokenURI,
    metadata,
  };

  let identityRegistration: { tokenURI: string; registration: Record<string, unknown> | null } | null =
    null;
  if (tokenURI) {
    try {
      const ipfsStorage = getIPFSStorage();
      const registration = (await ipfsStorage.getJson(tokenURI)) as Record<string, unknown> | null;
      identityRegistration = {
        tokenURI,
        registration,
      };
    } catch (error) {
      console.warn('Failed to get IPFS registration:', error);
      identityRegistration = {
        tokenURI,
        registration: null,
      };
    }
  }

  let discovery: Record<string, unknown> | null = null;
  try {
    const agentsApi = client.agents as any;
    if (did8004 && typeof agentsApi.getAgentFromDiscoveryByDid === 'function') {
      discovery = (await agentsApi.getAgentFromDiscoveryByDid(
        did8004,
      )) as unknown as Record<string, unknown> | null;
    } else if (typeof agentsApi.getAgentFromDiscovery === 'function') {
      discovery = (await agentsApi.getAgentFromDiscovery(
        resolvedChainId,
        agentId,
      )) as unknown as Record<string, unknown> | null;
    } else {
      discovery = null;
    }
  } catch (error) {
    console.warn('Failed to get GraphQL agent data:', error);
    discovery = null;
  }

  const flattened: Record<string, unknown> = {};

  if (identityRegistration?.registration && typeof identityRegistration.registration === 'object') {
    const reg = identityRegistration.registration as Record<string, unknown>;
    if (typeof reg.name === 'string') flattened.name = reg.name;
    if (typeof reg.description === 'string') flattened.description = reg.description;
    if (typeof reg.image === 'string') flattened.image = reg.image;
    if (typeof reg.agentAccount === 'string') flattened.agentAccount = reg.agentAccount;
    if (reg.endpoints) flattened.endpoints = reg.endpoints;
    if (reg.supportedTrust) flattened.supportedTrust = reg.supportedTrust;
    if (typeof reg.createdAt !== 'undefined') flattened.createdAt = reg.createdAt;
    if (typeof reg.updatedAt !== 'undefined') flattened.updatedAt = reg.updatedAt;
  }

  if (metadata.agentName && !flattened.name) flattened.name = metadata.agentName;
  if (metadata.agentName) flattened.agentName = metadata.agentName;
  if (metadata.agentAccount) flattened.agentAccount = metadata.agentAccount;

  if (discovery && typeof discovery === 'object') {
    const agentName =
      typeof discovery.agentName === 'string' ? (discovery.agentName as string) : undefined;
    if (agentName && !flattened.name) flattened.name = agentName;
    if (agentName && !flattened.agentName) flattened.agentName = agentName;

    const a2aEndpoint =
      typeof discovery.a2aEndpoint === 'string' ? (discovery.a2aEndpoint as string) : undefined;
    if (a2aEndpoint) flattened.a2aEndpoint = a2aEndpoint;

    const createdAtTime =
      typeof discovery.createdAtTime !== 'undefined' ? discovery.createdAtTime : undefined;
    if (createdAtTime !== undefined) flattened.createdAtTime = createdAtTime;

    const updatedAtTime =
      typeof discovery.updatedAtTime !== 'undefined' ? discovery.updatedAtTime : undefined;
    if (updatedAtTime !== undefined) flattened.updatedAtTime = updatedAtTime;

    Object.keys(discovery).forEach((key) => {
      if (key !== 'agentId' && flattened[key] === undefined) {
        flattened[key] = discovery[key];
      }
    });
  }

  return {
    success: true,
    agentId,
    chainId: resolvedChainId,
    identityMetadata,
    identityRegistration,
    discovery,
    ...flattened,
  };
}


