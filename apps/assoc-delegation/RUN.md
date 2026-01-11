# How to Run assoc-delegation

## Quick Start

```bash
# From monorepo root:
pnpm --filter @agentic-trust/assoc-delegation dev

# Or from the app directory:
cd apps/assoc-delegation
pnpm dev
```

## Required Environment Variables

Create a `.env` file in the **root of the monorepo** (or export them in your shell):

```bash
# Required: Private key of the agent owner EOA for agentId 133
# This must match the owner of the agent account
AGENT_OWNER_PRIVATE_KEY=0x...

# Required: Private key for the initiator EOA (who creates the association)
INITIATOR_PRIVATE_KEY=0x...

# Optional: Agent account address (if not set, will try to get from registry)
# If getAgentWallet() fails, set this to specify directly
# AGENT_ACCOUNT_ADDRESS=0x...

# Required: Sepolia RPC URL
AGENTIC_TRUST_RPC_URL_SEPOLIA=https://sepolia.infura.io/v3/YOUR_PROJECT_ID

# Required: Bundler URL for Sepolia (e.g., Pimlico)
AGENTIC_TRUST_BUNDLER_URL_SEPOLIA=https://api.pimlico.io/v2/sepolia/rpc?apikey=YOUR_API_KEY

# Required: Identity Registry contract address on Sepolia
AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x...

# Required: Associations Proxy contract address on Sepolia
AGENTIC_TRUST_ASSOCIATIONS_PROXY_SEPOLIA=0x...
```

## Notes

- The app uses **agentId 133** (hardcoded in the code)
- The `AGENT_OWNER_PRIVATE_KEY` must match the owner of the agent account
- The initiator account needs sufficient Sepolia ETH to pay for gas (or the transaction will fail)
- The app uses `tsx` which runs TypeScript directly - no build step needed for `dev`
- If you want to build first: `pnpm --filter @agentic-trust/assoc-delegation build && pnpm --filter @agentic-trust/assoc-delegation start`

