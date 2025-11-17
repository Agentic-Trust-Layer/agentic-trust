export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { loadSessionPackage, type SessionPackage } from '@agentic-trust/core/server';

const DID_PARAM_KEYS = ['did:8004', 'did8004', 'did꞉8004'] as const;

async function getDidParam(params: Promise<Record<string, string | undefined>>): Promise<string> {
  const resolved = await params;
  for (const key of DID_PARAM_KEYS) {
    const value = resolved[key];
    if (value) {
      return decodeURIComponent(value);
    }
  }
  throw new Error('Missing did:8004 parameter');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string | undefined>> },
) {
  try {
    const did8004 = await getDidParam(params);

    // Basic did:8004:<chainId>:<agentId> parsing to derive agentId/chainId for the package
    const parts = did8004.split(':');
    if (parts.length < 4 || parts[0] !== 'did' || parts[1] !== '8004') {
      return NextResponse.json(
        { error: 'Invalid did:8004 identifier', did: did8004 },
        { status: 400 },
      );
    }

    const chainIdPart = parts[2];
    const agentIdPart = parts.slice(3).join(':');
    const chainId = Number.parseInt(chainIdPart, 10);
    if (!Number.isFinite(chainId)) {
      return NextResponse.json(
        { error: 'Invalid chain id in did:8004 identifier', did: did8004 },
        { status: 400 },
      );
    }

    const agentId = Number.isFinite(Number(agentIdPart)) ? Number(agentIdPart) : 0;

    // Load the admin's existing session package template from disk/env.
    // This is the same JSON used by server-side delegation helpers.
    const basePkg: SessionPackage = loadSessionPackage();

    // Stamp in the current agentId / chainId so the file is specific to this agent.
    const pkg: SessionPackage = {
      ...basePkg,
      agentId,
      chainId,
    };

    return NextResponse.json(pkg);
  } catch (error) {
    console.error('Error building session package for agent:', error);
    return NextResponse.json(
      {
        error: 'Failed to build session package',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}


