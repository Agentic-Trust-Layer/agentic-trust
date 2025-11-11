# Veramo Agent Integration

This guide shows how to connect a Veramo agent instance to an `AgenticTrustClient` at runtime.

## Overview

The `AgenticTrustClient` now includes a `veramo` API namespace that allows you to connect your Veramo agent instance at runtime. This enables you to use Veramo's capabilities (DID management, credential issuance, key management) within the AgenticTrust ecosystem.

## Setup

### 1. Install Required Packages

```bash
pnpm add @agentic-trust/core @veramo/core @agentic-trust/veramo-agent-extension
```

### 2. Create Your Veramo Agent

```typescript
import { createAgent, type TAgent } from '@veramo/core';
import { Resolver } from 'did-resolver';
import { getResolver as ethrDidResolver } from 'ethr-did-resolver';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import {
  KeyManager,
  MemoryKeyStore,
} from '@veramo/key-manager';
import {
  DIDManager,
  MemoryDIDStore,
} from '@veramo/did-manager';
import type {
  IKeyManager,
  IDIDManager,
  ICredentialIssuer,
  ICredentialVerifier,
  IResolver,
} from '@veramo/core';

// Import from the renamed package
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

const aaDidProviders: Record<string, AADidProvider> = {};
const agentDidProviders: Record<string, AgentDidProvider> = {};

const aaKMS = new AAKeyManagementSystem(aaDidProviders);
const agentKMS = new AgentKeyManagementSystem(agentDidProviders);

export type Agent = TAgent<
  IKeyManager &
  IDIDManager &
  ICredentialIssuer &
  ICredentialVerifier &
  IResolver
>;

export const agent: Agent = createAgentForEOA({
  plugins: [
    new AgentCredentialIssuerEIP1271(),
    new KeyManager({
      store: new MemoryKeyStore(),
      kms: {
        aa: aaKMS,
        agent: agentKMS,
      },
    }),
    new DIDManager({
      store: new MemoryDIDStore(),
      defaultProvider: 'did:agent:client',
      providers: agentDidProviders,
    }),
    new DIDResolverPlugin({
      resolver: new Resolver({
        ...aaDidResolver(),
        ...agentDidResolver(),
        ...ethrDidResolver({
          networks: [
            {
              name: 'mainnet',
              rpcUrl: process.env.VITE_ETHEREUM_RPC_URL as string,
            },
            {
              name: 'sepolia',
              rpcUrl: process.env.VITE_SEPOLIA_RPC_URL as string,
            },
          ],
        }),
      }),
    }),
  ],
});
```

### 3. Create AgenticTrustClient with Veramo Agent

The Veramo agent is **required** and automatically connected when creating the client:

```typescript
import { AgenticTrustClient } from '@agentic-trust/core';
import { agent } from './your-veramo-agent';

// Create the client - agent is automatically connected
const client = AgenticTrustClient.create({
  apiKey: process.env.AGENTIC_TRUST_DISCOVERY_API_KEY,
  veramoAgent: agent, // Required - automatically connected
});

// Agent is immediately available and ready to use
const veramoAgent = client.veramo.getAgent();

// Use Veramo capabilities
const didDocument = await connectedAgent.resolveDid({
  didUrl: 'did:agent:client:1:0x123...',
});
```

## API Reference

### `client.veramo.getAgent(): VeramoAgent`

Returns the connected Veramo agent. The agent is always connected after client construction.

```typescript
const agent = client.veramo.getAgent();
```

### `client.veramo.isConnected(): boolean`

Checks if an agent is currently connected. This will always return `true` after client construction.

```typescript
if (client.veramo.isConnected()) {
  // Use the agent
}
```

### `client.veramo.connect(agent: VeramoAgent)` (Advanced)

Reconnects a different Veramo agent instance. Normally not needed since agent is set at construction.

```typescript
client.veramo.connect(newAgent);
```

### `client.veramo.disconnect(): void` (Advanced)

Disconnects the current agent. Normally not needed.

```typescript
client.veramo.disconnect();
```

## Usage Examples

### Resolving DIDs

```typescript
const client = AgenticTrustClient.create({
  apiKey: '...',
  veramoAgent: agent,
});

const didDocument = await client.veramo.getAgent().resolveDid({
  didUrl: 'did:agent:client:1:0x123...',
});
```

### Creating Credentials

```typescript
const credential = await client.veramo.getAgent().createVerifiableCredential({
  credential: {
    issuer: { id: 'did:agent:client:1:0x123...' },
    credentialSubject: {
      id: 'did:example:123',
      // ... other fields
    },
  },
  proofFormat: 'EthereumEip712Signature2021',
});
```

### Key Management

```typescript
const client = AgenticTrustClient.create({
  apiKey: '...',
  veramoAgent: agent,
});

const keys = await client.veramo.getAgent().keyManagerList();
const key = await client.veramo.getAgent().keyManagerGet({ kid: '...' });
```

### DID Management

```typescript
const client = AgenticTrustClient.create({
  apiKey: '...',
  veramoAgent: agent,
});

const identifier = await client.veramo.getAgent().didManagerCreate({
  alias: 'my-agent',
  provider: 'did:agent:client',
});
```

## Notes

- The Veramo agent connection persists across client operations
- You can reconnect a different agent at any time using `connect()`
- The agent must have the required capabilities: `IKeyManager`, `IDIDManager`, `ICredentialIssuer`, `ICredentialVerifier`, and `IResolver`
- Make sure to update your imports from `@mcp/shared` to `@agentic-trust/veramo-agent-extension`

