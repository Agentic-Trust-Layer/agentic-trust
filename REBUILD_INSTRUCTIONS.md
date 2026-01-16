# Rebuild Instructions for Metadata Query Changes

## What Changed
- Updated `getTokenMetadata` → `getAllAgentMetadata` in `AIAgentDiscoveryClient.ts`
- Updated GraphQL query from `agentMetadata_collection` to `agentMetadata_collection` with `agent_` filter (The Graph subgraph format)
- Updated skill display to use labels (not IDs) while storing IDs
- Fixed skill sync from agent-card.json to match by ID

## Steps to Rebuild and Run

### 1. Clear Turbo Cache (if needed)
```bash
cd /home/barb/erc8004/agentic-trust
pnpm turbo run build --force
```

### 2. Rebuild Affected Packages
```bash
# Rebuild the SDK package (contains AIAgentDiscoveryClient)
pnpm --filter @agentic-trust/erc8004-agentic-trust-sdk run build

# Rebuild core package (uses the SDK)
pnpm --filter @agentic-trust/core run build

# Rebuild admin app (uses core)
pnpm --filter @agentic-trust/admin run build
```

### 3. Or Rebuild Everything
```bash
pnpm run build
```

### 4. Run Dev Server
```bash
# For admin app
pnpm run dev:admin

# Or for all apps
pnpm run dev
```

### 5. Test the Changes
- Navigate to an agent details page
- Check "On-Chain Metadata" section - should show all metadata fields
- Go to admin-tools → Agent Info → Protocols tab
- Add a skill - should show label (e.g., "trust: Validate App") but store ID (e.g., "trust/trust_validate_account")
- Click "Sync from agent-card.json" - should match skills by ID

## What to Reset
- **Turbo cache**: Use `--force` flag to rebuild from scratch
- **TypeScript cache**: Usually cleared automatically, but you can delete `.tsbuildinfo` files if needed
- **Next.js cache**: Delete `.next` folder in `apps/admin` if you see stale behavior

## Files Changed
- `packages/erc8004-agentic-trust-sdk/AIAgentDiscoveryClient.ts` - Updated metadata query
- `packages/core/src/server/lib/agent.ts` - Updated to use `getAllAgentMetadata`
- `apps/admin/src/app/admin-tools/page.tsx` - Updated skill display and sync logic
