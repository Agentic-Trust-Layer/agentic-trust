# Environment Variables Guide

This document lists all environment variables needed for the Agentic Trust applications.

## Web App (`apps/web`)

Create a `.env.local` file in the `apps/web` directory:

### Required Variables

```bash
# Your AgenticTrust discovery API key
NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_API_KEY=your-api-key-here
```

### Optional Variables

```bash
# Override the base URL (defaults to https://8004-agent.io)
NEXT_PUBLIC_AGENTIC_TRUST_BASE_URL=https://8004-agent.io

# Discovery API endpoint (GraphQL)
AGENTIC_TRUST_DISCOVERY_URL=https://api.agentictrust.io

# Server-side discovery API key
AGENTIC_TRUST_DISCOVERY_API_KEY=your-api-key-here

# Ethereum private key for Veramo agent DID
# If not provided, a key will be generated for the session
# Note: For security, prefer AGENTIC_TRUST_PRIVATE_KEY (server-side only)
AGENTIC_TRUST_PRIVATE_KEY=0x...
# or for client-side (less secure):
# NEXT_PUBLIC_AGENTIC_TRUST_PRIVATE_KEY=0x...

# Ethereum RPC URLs (chain-specific, server-side - REQUIRED)
AGENTIC_TRUST_RPC_URL_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA=https://sepolia.base.org
AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA=https://sepolia.optimism.io

# Client-side RPC URLs (chain-specific, browser-accessible - REQUIRED)
NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA=https://sepolia.base.org
NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA=https://sepolia.optimism.io

# Contract Addresses (chain-specific, server-side)
AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x...
AGENTIC_TRUST_IDENTITY_REGISTRY_BASE_SEPOLIA=0x...
AGENTIC_TRUST_IDENTITY_REGISTRY_OPTIMISM_SEPOLIA=0x...
AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA=0x...
AGENTIC_TRUST_REPUTATION_REGISTRY_BASE_SEPOLIA=0x...
AGENTIC_TRUST_REPUTATION_REGISTRY_OPTIMISM_SEPOLIA=0x...
AGENTIC_TRUST_ENS_REGISTRY_SEPOLIA=0x...
AGENTIC_TRUST_ENS_REGISTRY_BASE_SEPOLIA=0x...
AGENTIC_TRUST_ENS_REGISTRY_OPTIMISM_SEPOLIA=0x...
AGENTIC_TRUST_ENS_RESOLVER_SEPOLIA=0x...
AGENTIC_TRUST_ENS_RESOLVER_BASE_SEPOLIA=0x...
AGENTIC_TRUST_ENS_RESOLVER_OPTIMISM_SEPOLIA=0x...

# Bundler URLs (chain-specific, server-side)
AGENTIC_TRUST_BUNDLER_URL_SEPOLIA=https://bundler-sepolia.example.com
AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA=https://bundler-base-sepolia.example.com
AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA=https://bundler-optimism-sepolia.example.com

# Session Package Configuration (alternative to reputation config)
# If using session packages for delegation-based authentication
AGENTIC_TRUST_SESSION_PACKAGE_PATH=./sessionPackage.json.secret

# Client-side Contract Addresses (chain-specific, browser-accessible)
NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x...
NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_BASE_SEPOLIA=0x...
NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_OPTIMISM_SEPOLIA=0x...
NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA=0x...
NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_BASE_SEPOLIA=0x...
NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_OPTIMISM_SEPOLIA=0x...
NEXT_PUBLIC_AGENTIC_TRUST_ENS_REGISTRY_SEPOLIA=0x...
NEXT_PUBLIC_AGENTIC_TRUST_ENS_REGISTRY_BASE_SEPOLIA=0x...
NEXT_PUBLIC_AGENTIC_TRUST_ENS_REGISTRY_OPTIMISM_SEPOLIA=0x...

# Client-side Bundler URLs (chain-specific, browser-accessible)
NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA=https://bundler-sepolia.example.com
NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA=https://bundler-base-sepolia.example.com
NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA=https://bundler-optimism-sepolia.example.com

```

### Notes

- **All environment variables are now chain-specific** - no generic fallbacks available
- **Chain-specific RPC URLs are strictly required** - no built-in fallbacks provided
- Variables with `NEXT_PUBLIC_` prefix are exposed to the browser (client-side accessible)
- Variables without `NEXT_PUBLIC_` are server-side only (more secure)
- Private keys should preferably use server-side variables (`AGENTIC_TRUST_PRIVATE_KEY`)
- **System will throw errors if required chain-specific variables are not configured**

---

## Provider App (`apps/provider`)

Create a `.env.local` file in the `apps/provider` directory:

### Required Variables

```bash
# Provider identifier (used in agent-card.json)
PROVIDER_ID=my-agent-provider

# Agent name (displayed in agent-card.json)
AGENT_NAME=My Agent Provider

# Base URL for the provider (used in agent-card.json and CORS)
NEXT_PUBLIC_BASE_URL=http://localhost:3001
```

### Optional Variables

```bash
# Port for the provider server (defaults to 3001)
PORT=3001

# Ethereum RPC URLs for DID resolution


# Ethereum private key for Veramo agent DID
# If not provided, a key will be generated for the session
AGENTIC_TRUST_PRIVATE_KEY=0x...

# Discovery API endpoint (GraphQL)
AGENTIC_TRUST_DISCOVERY_URL=https://api.agentictrust.io

# Discovery API key (server-side only)
AGENTIC_TRUST_DISCOVERY_API_KEY=your-api-key-here
```

### Notes

- `PORT` is used by the Next.js dev server
- RPC URLs default to public RPC endpoints if not provided
- Private keys are server-side only (no `NEXT_PUBLIC_` prefix needed)

---

## Quick Start

### Web App

```bash
cd apps/web
cp .env.example .env.local
# Edit .env.local with your API key
NEXT_PUBLIC_AGENTIC_TRUST_DISCOVERY_API_KEY=your-actual-api-key
```

### Provider App

```bash
cd apps/provider
cp .env.example .env.local
# Edit .env.local with your provider configuration
PROVIDER_ID=my-provider
AGENT_NAME=My Provider
NEXT_PUBLIC_BASE_URL=http://localhost:3001
```

---

## Security Notes

1. **Never commit `.env.local` files** - They are gitignored by default
2. **Private keys**: Use server-side variables (without `NEXT_PUBLIC_`) when possible
3. **API keys**: Can use `NEXT_PUBLIC_` prefix if needed client-side, but be aware they're exposed in the browser
4. **RPC URLs**: Using public RPC endpoints is fine for development, but consider using your own for production

---

## Default Values

If environment variables are not set, the following defaults are used:

### Web App
- `NEXT_PUBLIC_AGENTIC_TRUST_BASE_URL`: `https://8004-agent.io` (set in core package)
- Private key: Generated automatically for the session
- RPC URLs: Defaults from Veramo agent factory

### Provider App
- `PORT`: `3001`
- `PROVIDER_ID`: `default-provider`
- `AGENT_NAME`: `Agent Provider`
- `NEXT_PUBLIC_BASE_URL`: `http://localhost:3001`

- Private key: Generated automatically for the session

