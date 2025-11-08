/**
 * Session Package Utilities
 * 
 * Handles loading and validation of session packages for agent delegation
 * NOTE: These functions should only be called server-side (Next.js API routes, server components)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineChain, http, createPublicClient, type Chain, type PublicClient } from 'viem';
import { privateKeyToAccount, type Account } from 'viem/accounts';
import { toMetaMaskSmartAccount, Implementation } from '@metamask/delegation-toolkit';

type Hex = `0x${string}`;

export type SessionPackage = {
  agentId: number;
  chainId: number;
  aa: Hex; // smart account (delegator)
  sessionAA?: Hex; // delegate smart account (optional)
  reputationRegistry: Hex;
  selector: Hex;
  sessionKey: {
    privateKey: Hex;
    address: Hex;
    validAfter: number;
    validUntil: number;
  };
  entryPoint: Hex;
  bundlerUrl: string;
  delegationRedeemData?: Hex; // optional pre-encoded redeemDelegations call data
  signedDelegation: {
    message: {
      delegate: Hex;
      delegator: Hex;
      authority: Hex;
      caveats: any[];
      salt: Hex;
      signature: Hex;
    };
    signature: Hex;
  };
};

export type DelegationSetup = {
  agentId: number;
  chainId: number;
  chain: Chain;
  rpcUrl: string;
  bundlerUrl: string;
  entryPoint: Hex;
  aa: Hex;
  sessionAA?: Hex;
  reputationRegistry: Hex;
  selector: Hex;
  sessionKey: SessionPackage['sessionKey'];
  signedDelegation: SessionPackage['signedDelegation'];
  delegationRedeemData?: Hex;
  publicClient: PublicClient;
};

/**
 * Load session package from file
 * @param filePath - Optional path to session package file (defaults to sessionPackage.json.secret in same directory)
 */
export function loadSessionPackage(filePath?: string): SessionPackage {
  let p: string;
  
  if (filePath) {
    p = path.resolve(filePath);
  } else {
    // Try environment variable first
    const envPath = process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
    if (envPath) {
      p = path.resolve(envPath);
    } else {
      // Try current working directory
      p = path.join(process.cwd(), 'sessionPackage.json.secret');
      // If not found, try relative to this file's directory
      if (!fs.existsSync(p)) {
        try {
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = path.dirname(__filename);
          p = path.join(__dirname, 'sessionPackage.json.secret');
        } catch {
          // Last resort: use cwd
          p = path.join(process.cwd(), 'sessionPackage.json.secret');
        }
      }
    }
  }

  if (!fs.existsSync(p)) {
    throw new Error(
      `Session package file not found: ${p}\n` +
      'Set AGENTIC_TRUST_SESSION_PACKAGE_PATH environment variable or provide filePath parameter.'
    );
  }

  const raw = fs.readFileSync(p, 'utf-8');
  const parsed = JSON.parse(raw);

  return parsed as SessionPackage;
}

/**
 * Validate session package structure
 * Note: bundlerUrl and reputationRegistry can come from environment variables
 */
export function validateSessionPackage(pkg: SessionPackage): void {
  if (!pkg.chainId) throw new Error('sessionPackage.chainId is required');
  if (!pkg.aa) throw new Error('sessionPackage.aa is required');
  if (!pkg.entryPoint) throw new Error('sessionPackage.entryPoint is required');
  
  // Check if bundlerUrl is in package or env var
  const envBundlerUrl = process.env.AGENTIC_TRUST_BUNDLER_URL;
  if (!pkg.bundlerUrl && !envBundlerUrl) {
    throw new Error('sessionPackage.bundlerUrl is required (or set AGENTIC_TRUST_BUNDLER_URL env var)');
  }
  
  if (!pkg.sessionKey?.privateKey || !pkg.sessionKey?.address) {
    throw new Error('sessionPackage.sessionKey.privateKey and address are required');
  }
  if (!pkg.signedDelegation?.signature) {
    throw new Error('sessionPackage.signedDelegation.signature is required');
  }
  
  // Check if reputationRegistry is in package or env var
  const envReputationRegistry = process.env.AGENTIC_TRUST_REPUTATION_REGISTRY;
  if (!pkg.reputationRegistry && !envReputationRegistry) {
    throw new Error('sessionPackage.reputationRegistry is required (or set AGENTIC_TRUST_REPUTATION_REGISTRY env var)');
  }
}

/**
 * Get default RPC URL for a chain ID
 */
function defaultRpcUrlFor(chainId: number): string | null {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  if (process.env.JSON_RPC_URL) return process.env.JSON_RPC_URL;
  switch (chainId) {
    case 11155111: return 'https://rpc.sepolia.org';
    case 1: return 'https://rpc.ankr.com/eth';
    default: return null;
  }
}

/**
 * Build delegation setup from session package
 * Uses environment variables only (no overrides allowed)
 * Priority: env vars > session package defaults
 */
export function buildDelegationSetup(
  pkg?: SessionPackage
): DelegationSetup {
  const session = pkg || loadSessionPackage();
  validateSessionPackage(session);
  
  // RPC URL: env var or default, then session package
  const envRpcUrl = process.env.AGENTIC_TRUST_RPC_URL;
  const rpcUrl = envRpcUrl || defaultRpcUrlFor(session.chainId);
  if (!rpcUrl) {
    throw new Error(`RPC URL not provided and no default known for chainId ${session.chainId}`);
  }

  // Bundler URL: env var, then session package
  const envBundlerUrl = process.env.AGENTIC_TRUST_BUNDLER_URL;
  const bundlerUrl = envBundlerUrl || session.bundlerUrl;

  // Reputation Registry: env var, then session package
  const envReputationRegistry = (process.env.AGENTIC_TRUST_REPUTATION_REGISTRY) as `0x${string}` | undefined;
  const reputationRegistry = envReputationRegistry || session.reputationRegistry;

  const chain = defineChain({
    id: session.chainId,
    name: `chain-${session.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  });

  // Create public client with timeout configuration
  // Default timeout: 30 seconds (30000ms)
  const publicClient = createPublicClient({ 
    chain,
    transport: http(rpcUrl, {
      timeout: 30000, // 30 seconds
      retryCount: 3,
      retryDelay: 1000,
    }),
  });

  return {
    agentId: session.agentId,
    chainId: session.chainId,
    chain,
    rpcUrl,
    bundlerUrl,
    entryPoint: session.entryPoint,
    aa: session.aa,
    sessionAA: session.sessionAA,
    reputationRegistry,
    selector: session.selector,
    sessionKey: session.sessionKey,
    signedDelegation: session.signedDelegation,
    delegationRedeemData: session.delegationRedeemData,
    publicClient,
  };
}


export async function buildAgentAccountFromSession(sessionPackage?: SessionPackage): Promise<Account> {
  if (!sessionPackage) {
    throw new Error('sessionPackage is required to build agent account');
  }

  const delegationSetup = buildDelegationSetup(sessionPackage);

  const publicClient = createPublicClient({
    chain: delegationSetup.chain,
    transport: http(delegationSetup.rpcUrl),
  });

  const agentOwnerEOA = privateKeyToAccount(delegationSetup.sessionKey.privateKey);

  const agentOwnerAddress = delegationSetup.sessionAA || delegationSetup.aa;

  const agentAccountClient = await toMetaMaskSmartAccount({
    address: agentOwnerAddress as `0x${string}`,
    client: publicClient,
    implementation: Implementation.Hybrid,
    signatory: { account: agentOwnerEOA },
  } as any);

  return agentAccountClient as Account;
}

