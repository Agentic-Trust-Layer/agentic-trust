/**
 * Veramo Agent setup for provider app
 * 
 * Creates a Veramo agent instance for verifying client signatures
 */

import { createAgent, type TAgent } from '@veramo/core';
import type {
  IKeyManager,
  IDIDManager,
  ICredentialIssuer,
  ICredentialVerifier,
  IResolver,
} from '@veramo/core';
import { KeyManager, MemoryKeyStore } from '@veramo/key-manager';
import { DIDManager, MemoryDIDStore } from '@veramo/did-manager';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { Resolver } from 'did-resolver';
import { getResolver as ethrDidResolver } from 'ethr-did-resolver';
import type { VeramoAgent } from '@agentic-trust/core';
import {
  getAAResolver as aaDidResolver,
  getAgentResolver as agentDidResolver,
  AAKeyManagementSystem,
  AgentKeyManagementSystem,
  AACredentialIssuerEIP1271,
  AgentCredentialIssuerEIP1271,
  AADidProvider,
  AgentDidProvider,
} from '@agentic-trust/veramo-agent-extension';

/**
 * Create and return a Veramo agent instance for the provider
 */
export async function createVeramoAgent(): Promise<VeramoAgent> {
  // Initialize DID providers for AA and Agent DIDs
  const aaDidProviders: Record<string, AADidProvider> = {};
  const agentDidProviders: Record<string, AgentDidProvider> = {};

  // Initialize KMS instances
  const aaKMS = new AAKeyManagementSystem(aaDidProviders);
  const agentKMS = new AgentKeyManagementSystem(agentDidProviders);

  // Get Ethereum RPC URLs from environment variables (optional)
  const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com';
  const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL || 'https://sepolia.llamarpc.com';

  // Create the agent with required plugins
  const agent = createAgent<
    IKeyManager & IDIDManager & ICredentialIssuer & ICredentialVerifier & IResolver
  >({
    plugins: [
      // Credential issuer for EIP-1271 signatures
      new AgentCredentialIssuerEIP1271(),
      
      // Key Manager with AA and Agent KMS
      new KeyManager({
        store: new MemoryKeyStore(),
        kms: {
          aa: aaKMS,
          agent: agentKMS,
        },
      }),
      
      // DID Manager with Agent DID provider
      new DIDManager({
        store: new MemoryDIDStore(),
        defaultProvider: 'did:agent:provider',
        providers: agentDidProviders,
      }),
      
      // DID Resolver for multiple DID methods
      new DIDResolverPlugin({
        resolver: new Resolver({
          ...aaDidResolver(),
          ...agentDidResolver(),
          ...ethrDidResolver({
            networks: [
              {
                name: 'mainnet',
                rpcUrl: ethereumRpcUrl,
              },
              {
                name: 'sepolia',
                rpcUrl: sepoliaRpcUrl,
              },
            ],
          }),
        }),
      }),
    ],
  });

  return agent;
}

