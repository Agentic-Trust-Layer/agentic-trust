/**
 * Veramo Agent Factory
 * 
 * Creates a Veramo agent instance for AgenticTrust client use
 * This allows the core package to create agents internally without requiring
 * the consuming application to set up Veramo
 */

import { createAgent, type TAgent } from '@veramo/core';
import type {
  IKeyManager,
  IDIDManager,
  ICredentialIssuer,
  ICredentialVerifier,
  IResolver,
} from '@veramo/core';
import { KeyManager, MemoryKeyStore, MemoryPrivateKeyStore } from '@veramo/key-manager';
import { KeyManagementSystem } from '@veramo/kms-local';
import { DIDManager, MemoryDIDStore } from '@veramo/did-manager';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { Resolver } from 'did-resolver';
import { getResolver as ethrDidResolver } from 'ethr-did-resolver';
import { EthrDIDProvider } from '@veramo/did-provider-ethr';
import { generatePrivateKey } from 'viem/accounts';
import type { VeramoAgent } from './veramo';
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
 * Create a Veramo agent instance for AgenticTrust client
 * 
 * @param privateKey - Optional Ethereum private key (hex string with or without 0x prefix)
 *                     If not provided, a key will be generated for the session
 * @param ethereumRpcUrl - Optional Ethereum mainnet RPC URL
 * @param sepoliaRpcUrl - Optional Sepolia testnet RPC URL
 */
export async function createVeramoAgentForClient(
  privateKey?: string,
  ethereumRpcUrl?: string,
  sepoliaRpcUrl?: string
): Promise<VeramoAgent> {
  // Initialize DID providers for AA and Agent DIDs
  const aaDidProviders: Record<string, AADidProvider> = {};
  const agentDidProviders: Record<string, AgentDidProvider> = {};

  // Initialize KMS instances
  const aaKMS = new AAKeyManagementSystem(aaDidProviders);
  const agentKMS = new AgentKeyManagementSystem(agentDidProviders);

  // Get Ethereum RPC URLs from parameters or defaults
  const ethereumRpc = ethereumRpcUrl || 'https://eth.llamarpc.com';
  const sepoliaRpc = sepoliaRpcUrl || 'https://sepolia.llamarpc.com';

  // Create ethr DID provider for client DIDs
  const ethrDidProvider = new EthrDIDProvider({
    defaultKms: 'local',
    networks: [
      {
        name: 'mainnet',
        rpcUrl: ethereumRpc,
      },
      {
        name: 'sepolia',
        rpcUrl: sepoliaRpc,
      },
    ],
  });

  // Create the agent with required plugins
  const agent = createAgent<
    IKeyManager & IDIDManager & ICredentialIssuer & ICredentialVerifier & IResolver
  >({
    plugins: [
      // Credential issuer for EIP-1271 signatures
      new AgentCredentialIssuerEIP1271(),
      
      // Key Manager with AA, Agent, and local KMS
      // Local KMS is needed for ethr DIDs and importing private keys
      new KeyManager({
        store: new MemoryKeyStore(),
        kms: {
          local: new KeyManagementSystem(new MemoryPrivateKeyStore()),
          aa: aaKMS,
          agent: agentKMS,
        },
      }),
      
      // DID Manager - use ethr for client DIDs (simpler than agent DIDs)
      new DIDManager({
        store: new MemoryDIDStore(),
        defaultProvider: 'did:ethr',
        providers: {
          'did:ethr': ethrDidProvider,
          ...agentDidProviders,
        },
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
                rpcUrl: ethereumRpc,
              },
              {
                name: 'sepolia',
                rpcUrl: sepoliaRpc,
              },
            ],
          }),
        }),
      }),
    ],
  });

  // If a private key is provided, import it and create DID with it
  // Otherwise, generate a key for this session
  let finalPrivateKey = privateKey;
  if (!finalPrivateKey) {
    // Generate a new private key for this session
    finalPrivateKey = generatePrivateKey();
    console.log('Generated new private key for session');
  }

  // Normalize private key (ensure 0x prefix)
  const normalizedKey = finalPrivateKey.startsWith('0x') ? finalPrivateKey : `0x${finalPrivateKey}`;
  
  // Import the private key into the key manager
  const importedKey = await agent.keyManagerImport({
    type: 'Secp256k1',
    privateKeyHex: normalizedKey,
    kms: 'local',
  });

  // Create DID with the imported key
  const identifier = await agent.didManagerCreate({
    alias: 'default',
    provider: 'did:ethr',
    options: {
      keyRef: importedKey.kid,
    },
  });

  console.log('Created DID:', identifier.did);

  return agent;
}

