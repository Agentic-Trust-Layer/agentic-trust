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
import Web3 from 'web3';
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
 * @param rpcUrl - Optional Sepolia testnet RPC URL
 */
export async function createVeramoAgentForClient(
  privateKey?: string,
  rpcUrl?: string
): Promise<VeramoAgent> {
  console.warn('🏭 createVeramoAgentForClient: Starting...');
  
  // Initialize DID providers for AA and Agent DIDs
  console.warn('🏭 createVeramoAgentForClient: Initializing DID providers...');
  const aaDidProviders: Record<string, AADidProvider> = {};
  const agentDidProviders: Record<string, AgentDidProvider> = {};

  // Initialize KMS instances
  console.warn('🏭 createVeramoAgentForClient: Initializing KMS...');
  const aaKMS = new AAKeyManagementSystem(aaDidProviders);
  const agentKMS = new AgentKeyManagementSystem(agentDidProviders);
  console.warn('✅ createVeramoAgentForClient: KMS initialized');

  // Get Ethereum RPC URLs from parameters or defaults
  console.warn('🏭 createVeramoAgentForClient: Setting up RPC URLs...');
  const rpc = rpcUrl || 'https://sepolia.drpc.org';

  // Create Web3 providers for ethr-did-resolver
  console.warn('🏭 createVeramoAgentForClient: Creating Web3 providers...');
  const web3SepoliaProvider = new Web3.providers.HttpProvider(rpc);

  // Create ethr DID provider for client DIDs
  console.warn('🏭 createVeramoAgentForClient: Creating ethr DID provider...');
  const ethrDidProvider = new EthrDIDProvider({
    defaultKms: 'local',
    networks: [
      {
        name: 'sepolia',
        rpcUrl: rpc,
      },
    ],
  });

  // Create the agent with required plugins
  console.warn('🏭 createVeramoAgentForClient: Creating agent with plugins...');
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
                name: 'sepolia',
                provider: web3SepoliaProvider as any,
              },
            ],
          }),
        }),
      }),
    ],
  });

  // If a private key is provided, import it and create DID with it
  // Otherwise, generate a key for this session
  console.warn('🏭 createVeramoAgentForClient: Setting up private key...');
  let finalPrivateKey = privateKey;
  if (!finalPrivateKey) {
    // Generate a new private key for this session
    console.warn('🏭 createVeramoAgentForClient: Generating new private key...');
    finalPrivateKey = generatePrivateKey();
    console.warn('✅ createVeramoAgentForClient: Generated new private key for session');
  } else {
    console.warn('✅ createVeramoAgentForClient: Using provided private key');
  }

  // Normalize and validate private key
  // Remove any whitespace, newlines, or other invalid characters
  let cleanedKey = finalPrivateKey.trim().replace(/\s+/g, '');
  
  // Remove 0x prefix if present (we'll add it back)
  if (cleanedKey.startsWith('0x')) {
    cleanedKey = cleanedKey.slice(2);
  }
  
  // Validate it's a valid hex string (64 characters for 32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(cleanedKey)) {
    throw new Error(
      `Invalid private key format. Expected 64 hex characters (32 bytes), ` +
      `got ${cleanedKey.length} characters. ` +
      `Key starts with: ${cleanedKey.substring(0, 10)}...`
    );
  }
  
  // Add 0x prefix
  const normalizedKey = `0x${cleanedKey}`;
  
  console.warn('🏭 createVeramoAgentForClient: Importing key into key manager...');
  console.warn('🔑 Normalized key length:', normalizedKey.length, 'characters');
  
  // Import the private key into the key manager
  const importedKey = await agent.keyManagerImport({
    type: 'Secp256k1',
    privateKeyHex: normalizedKey,
    kms: 'local',
  });
  console.warn('✅ createVeramoAgentForClient: Key imported');

  console.warn('🏭 createVeramoAgentForClient: Creating DID...');
  // Create DID with the imported key
  const identifier = await agent.didManagerCreate({
    alias: 'default',
    provider: 'did:ethr',
    options: {
      keyRef: importedKey.kid,
    },
  });

  console.warn('✅ createVeramoAgentForClient: Created DID:', identifier.did);
  console.warn('✅ createVeramoAgentForClient: Complete!');

  return agent;
}

