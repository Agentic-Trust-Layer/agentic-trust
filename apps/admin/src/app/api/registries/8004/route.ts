export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

type RegistryRow = {
  ecosystem: 'Ethereum' | 'Base' | 'Linea';
  network: 'Mainnet' | 'Testnet';
  chainId: number;
  identityRegistry?: string | null;
  reputationRegistry?: string | null;
  validationRegistry?: string | null;
};

function getEnv(key: string): string | null {
  const v = process.env[key];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function firstEnv(keys: string[]): string | null {
  for (const k of keys) {
    const v = getEnv(k);
    if (v) return v;
  }
  return null;
}

function firstRegistry(base: 'IDENTITY' | 'REPUTATION' | 'VALIDATION', suffixes: string[]): string | null {
  const keys: string[] = [];
  for (const s of suffixes) {
    keys.push(`AGENTIC_TRUST_${base}_REGISTRY_${s}`);
    keys.push(`NEXT_PUBLIC_AGENTIC_TRUST_${base}_REGISTRY_${s}`);
  }
  return firstEnv(keys);
}

export async function GET() {
  try {
    const registries: RegistryRow[] = [
      {
        ecosystem: 'Ethereum',
        network: 'Mainnet',
        chainId: 1,
        identityRegistry: firstRegistry('IDENTITY', ['MAINNET']) ?? firstEnv(['AGENTIC_TRUST_IDENTITY_REGISTRY', 'NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY']),
        reputationRegistry: firstRegistry('REPUTATION', ['MAINNET']) ?? firstEnv(['AGENTIC_TRUST_REPUTATION_REGISTRY', 'NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY']),
        validationRegistry: firstRegistry('VALIDATION', ['MAINNET']),
      },
      {
        ecosystem: 'Ethereum',
        network: 'Testnet',
        chainId: 11155111,
        identityRegistry: firstRegistry('IDENTITY', ['SEPOLIA']),
        reputationRegistry: firstRegistry('REPUTATION', ['SEPOLIA']),
        validationRegistry: firstRegistry('VALIDATION', ['SEPOLIA']) ?? firstEnv(['AGENTIC_TRUST_VALIDATION_REGISTRY', 'NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY']),
      },
      {
        ecosystem: 'Base',
        network: 'Mainnet',
        chainId: 8453,
        identityRegistry: firstRegistry('IDENTITY', ['BASE']),
        reputationRegistry: firstRegistry('REPUTATION', ['BASE']),
        validationRegistry: firstRegistry('VALIDATION', ['BASE']),
      },
      {
        ecosystem: 'Base',
        network: 'Testnet',
        chainId: 84532,
        identityRegistry: firstRegistry('IDENTITY', ['BASE_SEPOLIA']),
        reputationRegistry: firstRegistry('REPUTATION', ['BASE_SEPOLIA']),
        validationRegistry: firstRegistry('VALIDATION', ['BASE_SEPOLIA']),
      },
      {
        ecosystem: 'Linea',
        network: 'Mainnet',
        chainId: 59144,
        identityRegistry: firstRegistry('IDENTITY', ['LINEA']),
        reputationRegistry: firstRegistry('REPUTATION', ['LINEA']),
        validationRegistry: firstRegistry('VALIDATION', ['LINEA']),
      },
      {
        ecosystem: 'Linea',
        network: 'Testnet',
        chainId: 59141,
        identityRegistry: firstRegistry('IDENTITY', ['LINEA_SEPOLIA', 'LINEA_TESTNET']),
        reputationRegistry: firstRegistry('REPUTATION', ['LINEA_SEPOLIA', 'LINEA_TESTNET']),
        validationRegistry: firstRegistry('VALIDATION', ['LINEA_SEPOLIA', 'LINEA_TESTNET']),
      },
    ];

    return NextResponse.json({ registries });
  } catch (error) {
    console.error('[api/registries/8004] failed', error);
    return NextResponse.json(
      {
        error: 'Failed to load 8004 registries',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

