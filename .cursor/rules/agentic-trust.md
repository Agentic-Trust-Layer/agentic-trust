# Agentic Trust & ERC-8004 Rules

## Reference Repository
- **Always consult**: [https://github.com/Agentic-Trust-Layer/agentic-trust](https://github.com/Agentic-Trust-Layer/agentic-trust) for the latest patterns, architecture, and implementation details.

## Key Concepts
- **Agent Identity**: Veramo integration, DID management
- **Reputation**: ERC-8004 feedback mechanisms
- **Validation**: Agent validation workflows

## Client Usage
- Server-side: Use `getAgenticTrustClient()` from `@agentic-trust/core/server`
- Client-side: Use functions from `@agentic-trust/core/client`
- Admin operations: Use `getAdminApp()` from `@agentic-trust/core/server`

## Agent Operations
- Get agent: `client.getAgent(agentId, chainId)`
- Get by DID: `client.getAgentDetailsByDid(did)`
- Get by account: `client.getAgentByAccount(account, chainId)`
- Refresh agent: `client.agents.refreshAgentByDid(did)` (may need `as any` for types)

## Agent Creation
- Use `createAgentWithWallet` from `@agentic-trust/core/client` for client-side
- Use `createAgentRouteHandler` from `@agentic-trust/core/server` for API routes
- Always verify agent creation succeeded before creating database records

## Admin App
- Requires `AGENTIC_TRUST_ADMIN_PRIVATE_KEY` environment variable
- Check `adminApp.hasPrivateKey` before using
- Use for server-side operations requiring signing

## Validation
- Use `requestValidationWithWallet` for ENS validation requests
- Handle validation errors properly (already exists, network errors, etc.)

