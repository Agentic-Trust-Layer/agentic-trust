import { NextRequest, NextResponse } from 'next/server';
import { getIPFSStorage } from '@agentic-trust/core';
import { getIdentityClient } from '@agentic-trust/core/server';
import { getAdminClient } from '@/lib/client';

const DEFAULT_CHAIN_ID = 11155111;
const METADATA_KEYS = ['agentName', 'agentAccount'] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const { agentId } = params;
    const searchParams = request.nextUrl.searchParams;
    const chainIdParam = searchParams.get('chainId');
    const chainId = chainIdParam ? Number.parseInt(chainIdParam, 10) : DEFAULT_CHAIN_ID;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      );
    }

    let agentIdBigInt: bigint;
    try {
      agentIdBigInt = BigInt(agentId);
    } catch (error) {
      return NextResponse.json(
        {
          error: 'Invalid agentId parameter',
          message: error instanceof Error ? error.message : 'Unable to parse agentId as bigint',
        },
        { status: 400 }
      );
    }

    const client = await getAdminClient();
    const identityClient = await getIdentityClient();

    const tokenURI = await identityClient.getTokenURI(agentIdBigInt);

    const metadata: Record<string, string> = {};
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

    let identityRegistration: { tokenURI: string; registration: any | null } | null = null;
    if (tokenURI) {
      try {
        const ipfsStorage = getIPFSStorage();
        const registration = await ipfsStorage.getJson(tokenURI);
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

    let discovery: any | null = null;
    try {
      discovery = await client.agents.getAgentFromGraphQL(chainId, agentId);
    } catch (error) {
      console.warn('Failed to get GraphQL agent data:', error);
      discovery = null;
    }

    const flattened: Record<string, any> = {};

    if (identityRegistration?.registration) {
      const reg = identityRegistration.registration;
      if (reg.name) flattened.name = reg.name;
      if (reg.description) flattened.description = reg.description;
      if (reg.image) flattened.image = reg.image;
      if (reg.agentAccount) flattened.agentAccount = reg.agentAccount;
      if (reg.endpoints) flattened.endpoints = reg.endpoints;
      if (reg.supportedTrust) flattened.supportedTrust = reg.supportedTrust;
      if (reg.createdAt) flattened.createdAt = reg.createdAt;
      if (reg.updatedAt) flattened.updatedAt = reg.updatedAt;
    }

    if (metadata.agentName && !flattened.name) flattened.name = metadata.agentName;
    if (metadata.agentName) flattened.agentName = metadata.agentName;
    if (metadata.agentAccount) flattened.agentAccount = metadata.agentAccount;

    if (discovery) {
      if (discovery.agentName && !flattened.name) flattened.name = discovery.agentName;
      if (discovery.agentName && !flattened.agentName) flattened.agentName = discovery.agentName;
      if (discovery.a2aEndpoint) flattened.a2aEndpoint = discovery.a2aEndpoint;
      if (discovery.createdAtTime) flattened.createdAtTime = discovery.createdAtTime;
      if (discovery.updatedAtTime) flattened.updatedAtTime = discovery.updatedAtTime;
      Object.keys(discovery).forEach((key) => {
        if (!flattened[key] && key !== 'agentId') {
          flattened[key] = discovery[key];
        }
      });
    }

    return NextResponse.json({
      success: true as const,
      agentId,
      chainId,
      identityMetadata,
      identityRegistration,
      discovery,
      ...flattened,
    });
  } catch (error) {
    console.error('Error in get agent info route:', error);
    return NextResponse.json(
      {
        error: 'Failed to get agent information',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

