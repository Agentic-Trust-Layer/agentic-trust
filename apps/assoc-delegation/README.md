# ERC-8092 Association Delegation Test App

This test app demonstrates the full flow of creating an ERC-8092 association using MetaMask delegation.

## Flow

1. **Get agent account** - Retrieves the agent account address for agentId 114 from the IdentityRegistry
2. **Create session smart account** - Creates a new session smart account using MetaMask Smart Accounts Kit
3. **Create delegation** - Creates a MetaMask delegation from the agent account to the session smart account
4. **Create initiator EOA** - Generates a new EOA to act as the initiator
5. **Create ERC-8092 association record** - Builds the association record with initiator and approver
6. **Sign as initiator** - Signs the association record with the initiator EOA
7. **Sign as approver** - Signs the association record with the operator EOA (session key owner), which will be validated via ERC-1271 through the delegation
8. **Store on-chain** - Stores the association on-chain using the session smart account with delegation

## Setup

1. Install dependencies (from root of monorepo):
```bash
pnpm install
```

2. Set environment variables:

   Create a `.env` file in the root of the monorepo (or set them in your shell):
```bash
# Required: Private key of the agent owner EOA for agentId 114
# This must match the owner of the agent account
AGENT_OWNER_PRIVATE_KEY=0x...

# Optional: Agent account address (if not set, will try to get from registry)
# If getAgentWallet() fails or wallet is not set, set this to specify directly
# AGENT_ACCOUNT_ADDRESS=0x...

# Required: Sepolia RPC URL (e.g., Infura, Alchemy, or your own node)
AGENTIC_TRUST_RPC_URL_SEPOLIA=https://sepolia.infura.io/v3/YOUR_PROJECT_ID

# Required: Bundler URL for Sepolia (e.g., Pimlico, Alchemy, or other ERC-4337 bundler)
AGENTIC_TRUST_BUNDLER_URL_SEPOLIA=https://api.pimlico.io/v1/sepolia/rpc?apikey=YOUR_API_KEY

# Required: Identity Registry contract address on Sepolia
# Chain-specific format (preferred):
AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x...
# OR generic format (fallback):
# AGENTIC_TRUST_IDENTITY_REGISTRY=0x...

# Required: Validation Registry contract address on Sepolia
# Chain-specific format (preferred):
AGENTIC_TRUST_VALIDATION_REGISTRY_SEPOLIA=0x...
# OR generic format (fallback):
# AGENTIC_TRUST_VALIDATION_REGISTRY=0x...

# Optional: ERC-8092 Associations Store Proxy address
# If not set, defaults to: 0xaF7428906D31918dDA2986D1405E2Ded06561E59
# ASSOCIATIONS_STORE_PROXY=0xaF7428906D31918dDA2986D1405E2Ded06561E59
```

## Quick Start

1. **Get the agent account address for agentId 114**:
   - The app will try to get it from IdentityRegistry using `getAgentWallet()` or metadata
   - If that fails, you can set `AGENT_ACCOUNT_ADDRESS` env var to specify it directly
   - This is useful if the wallet hasn't been set in the registry yet

2. **Get the agent owner private key**:
   - The app will query the agent account to get the owner EOA
   - Your `AGENT_OWNER_PRIVATE_KEY` must match that owner EOA
   - The owner EOA is needed to sign the delegation

3. **Set up environment variables** (create `.env` in monorepo root or export them):
```bash
export AGENT_OWNER_PRIVATE_KEY=0x...
export AGENTIC_TRUST_RPC_URL_SEPOLIA=https://...
export AGENTIC_TRUST_BUNDLER_URL_SEPOLIA=https://...
export AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x...
export AGENTIC_TRUST_VALIDATION_REGISTRY_SEPOLIA=0x...

# Optional: If getAgentWallet() fails, specify the agent account directly
export AGENT_ACCOUNT_ADDRESS=0x...
```

4. **Run the app**:
```bash
# From monorepo root:
pnpm --filter @agentic-trust/assoc-delegation dev

# Or from the app directory:
cd apps/assoc-delegation
pnpm dev
```

   The app will automatically reload on file changes (using `tsx watch`).

   **Note**: The app uses agentId **114** and expects the agent owner private key to match the owner of that agent account.

## Expected Output

The app will:
- Display each step of the process
- Test ERC-1271 validation to verify the delegation-aware validator is working
- Store the association on-chain and display the transaction hash
- Show a summary with all addresses and the association ID

## Key Points

- The agent account (agentId 114) delegates authority to the session smart account
- The operator EOA (session key owner) signs the approver signature
- The agent account's ERC-1271 validator should recognize the operator's signature through the delegation
- The association is stored on-chain via a user operation from the session smart account, using the delegation to authorize the call

