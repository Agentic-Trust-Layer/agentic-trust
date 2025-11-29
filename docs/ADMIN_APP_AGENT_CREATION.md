# Using AdminApp to Create Agents with @agentic-trust/core

This guide explains how `adminApp` is used to inform the wallet/system to create an agent using the `@agentic-trust/core` library.

## Overview

The `adminApp` is a singleton that provides server-side signing capabilities for agent creation. It can operate in two modes:

1. **Private Key Mode**: Uses `AGENTIC_TRUST_ADMIN_PRIVATE_KEY` to sign transactions server-side
2. **Wallet Mode**: Prepares transactions for client-side signing (no private key available)

## Setup

### 1. Environment Configuration

Set the following environment variables:

```bash
# Required: Enable admin app role
AGENTIC_TRUST_APP_ROLES=admin

# Option 1: Private key mode (server-side signing)
AGENTIC_TRUST_ADMIN_PRIVATE_KEY=0x...your_private_key

# Option 2: Wallet mode (client-side signing)
# No private key needed - will prepare transactions for wallet signing

# Required: Chain configuration
AGENTIC_TRUST_RPC_URL_SEPOLIA=https://...
AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x...
```

### 2. Initialize AdminApp

The `adminApp` is automatically initialized when you call agent creation methods. You can also initialize it explicitly:

```typescript
import { getAdminApp } from '@agentic-trust/core/server';

// Initialize adminApp (automatically uses AGENTIC_TRUST_ADMIN_PRIVATE_KEY if set)
const adminApp = await getAdminApp(undefined, chainId);

if (!adminApp) {
  throw new Error('AdminApp not initialized');
}

// Check if it has signing capability
if (adminApp.hasPrivateKey) {
  console.log('AdminApp can sign transactions server-side');
} else {
  console.log('AdminApp is in read-only mode - transactions need client-side signing');
}
```

## Agent Creation Flow

### Server-Side API Route (Recommended)

Create a Next.js API route or Express handler:

```typescript
// app/api/agents/create/route.ts (Next.js)
import { createAgentRouteHandler } from '@agentic-trust/core/server';

export const POST = createAgentRouteHandler();
```

Or for Express:

```typescript
// server.ts
import { createAgentExpressHandler } from '@agentic-trust/core/server';

app.post('/api/agents/create', createAgentExpressHandler());
```

### Client-Side Usage

```typescript
import { createAgentWithWallet } from '@agentic-trust/core/client';

const result = await createAgentWithWallet({
  agentData: {
    agentName: 'My Agent',
    agentAccount: '0x...', // Agent's account abstraction address
    description: 'Agent description',
    image: 'https://...',
    agentUrl: 'https://...',
  },
  chainId: 11155111, // Sepolia
  onStatusUpdate: (status) => console.log(status),
});
```

## How AdminApp Works Internally

### 1. AdminApp Initialization

When `createAgentForEOA` is called, it first gets the `adminApp`:

```typescript
// From packages/core/src/server/lib/agents.ts
const adminApp = await getAdminApp(undefined, targetChainId);
```

The `getAdminApp` function:
- Checks for `AGENTIC_TRUST_ADMIN_PRIVATE_KEY` environment variable
- Falls back to wallet address from session/cookies (for wallet mode)
- Creates a `ViemAccountProvider` with signing capability if private key is available
- Returns read-only provider if only wallet address is available

### 2. Transaction Preparation vs. Execution

The system checks `adminApp.hasPrivateKey`:

**If `hasPrivateKey === true` (Private Key Mode):**

```typescript
// Uses adminApp.accountProvider to sign and send transaction directly
const identityClient = new BaseIdentityClient(
  adminApp.accountProvider,  // ← Has signing capability
  identityRegistryAddress
);

const result = await identityClient.registerWithMetadata(tokenUri, metadata);
// Transaction is signed and sent server-side
// Returns: { agentId: bigint, txHash: string }
```

**If `hasPrivateKey === false` (Wallet Mode):**

```typescript
// Prepares transaction for client-side signing
const transaction = await aiIdentityClient.prepareRegisterTransaction(
  tokenUri,
  metadata,
  adminApp.address  // ← Only address needed, no signing
);

// Returns: { requiresClientSigning: true, transaction: {...}, tokenUri, metadata }
```

### 3. AccountProvider Usage

The `adminApp.accountProvider` is a `ViemAccountProvider` that wraps:
- `publicClient`: For reading blockchain state
- `walletClient`: For signing transactions (null if no private key)
- `account`: The admin account address

This provider is passed to domain clients (IdentityClient, ReputationClient, etc.) which use it to:
- Encode transaction data
- Estimate gas
- Sign transactions (if walletClient is available)
- Send transactions

## Complete Example

### Server-Side (Private Key Mode)

```typescript
import { getAgenticTrustClient } from '@agentic-trust/core/server';

const client = await getAgenticTrustClient();

// This will use adminApp with private key to sign and send transaction
const result = await client.agents.createAgentForEOA({
  agentName: 'My Agent',
  agentAccount: '0x...',
  description: 'Agent description',
  chainId: 11155111,
});

// Result: { agentId: bigint, txHash: string }
console.log(`Agent created: ${result.agentId}, TX: ${result.txHash}`);
```

### Client-Side (Wallet Mode)

```typescript
import { createAgentWithWallet } from '@agentic-trust/core/client';

// This calls the API route, which prepares transaction
// Then signs it with the user's wallet
const result = await createAgentWithWallet({
  agentData: {
    agentName: 'My Agent',
    agentAccount: '0x...',
  },
  chainId: 11155111,
});

// Result: { agentId: bigint, txHash: string }
```

## Key Points

1. **AdminApp is the Signer**: When `AGENTIC_TRUST_ADMIN_PRIVATE_KEY` is set, `adminApp` provides the signing capability for server-side transactions.

2. **AccountProvider Abstraction**: The `adminApp.accountProvider` is passed to domain clients, which handle all Ethereum interaction details.

3. **Automatic Mode Detection**: The system automatically detects whether to sign server-side or prepare for client-side signing based on `adminApp.hasPrivateKey`.

4. **Domain Client Resolution**: When creating domain clients (IdentityClient, ReputationClient, etc.), the system resolves account providers in this order:
   - AdminApp (preferred for admin operations)
   - ProviderApp
   - ClientApp
   - Read-only fallback

5. **Transaction Flow**:
   - Server prepares transaction (encoding, gas estimation, nonce)
   - If private key available: Server signs and sends
   - If no private key: Returns prepared transaction for client signing

## Troubleshooting

### "AdminApp not initialized"

- Ensure `AGENTIC_TRUST_APP_ROLES=admin` is set
- Check that either `AGENTIC_TRUST_ADMIN_PRIVATE_KEY` is set OR wallet is connected

### "Wallet has zero balance"

- Fund the admin wallet with ETH for gas fees
- Check `adminApp.address` to see which wallet needs funding

### Transaction preparation fails

- Verify RPC URL is correct: `AGENTIC_TRUST_RPC_URL_SEPOLIA`
- Check Identity Registry address: `AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA`
- Ensure chain ID matches your network configuration

