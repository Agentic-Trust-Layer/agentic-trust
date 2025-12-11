# ATP Agent

An A2A (Agent-to-Agent) application built with Express.js and the Agentic Trust core SDK. Uses Cloudflare D1 database for persistent storage.

## Features

- **A2A Protocol**: Handles agent-to-agent communication via `/api/a2a` endpoint
- **Agent Descriptor**: Provides agent metadata via `/.well-known/agent.json`
- **ERC-8004 Feedback**: Supports feedback authentication via `agent.feedback.requestAuth` skill
- **Cloudflare D1**: Stores A2A messages and agent data in Cloudflare D1 database
- **ENS Integration**: Resolves agent accounts via ENS names

## Setup

### Prerequisites

- Node.js 20+
- pnpm 8+
- Cloudflare account with D1 database

### Installation

```bash
# From the monorepo root
pnpm install

# Or from this directory
cd apps/atp-agent
pnpm install
```

### Environment Variables

Create a `.env` file in the `apps/atp-agent` directory:

```env
# Server Configuration
PORT=3003
NODE_ENV=development
PROVIDER_BASE_URL=http://localhost:3003
PROVIDER_BASE_DOMAIN=localhost

# Agent Configuration
AGENT_NAME=ATP Agent
AGENT_DESCRIPTION=An ATP agent for A2A communication
AGENT_ID=0
AGENT_ADDRESS=
AGENT_SIGNATURE=
AGENT_VERSION=0.1.0
PROVIDER_ORGANIZATION=ATP

# Agentic Trust Configuration
AGENTIC_TRUST_RPC_URL_SEPOLIA=https://sepolia.optimism.io
AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x8004a6090Cd10A7288092483047B097295Fb8847
AGENTIC_TRUST_SESSION_PACKAGE_PATH=./sessionPackage.json.secret

# Cloudflare D1 Configuration
CLOUDFLARE_D1_DATABASE_NAME=atp
CLOUDFLARE_ACCOUNT_ID=5da2feaa56593839672948e16c6e809d
CLOUDFLARE_D1_DATABASE_ID=172fc638-86ad-4054-b14c-45c4f89a52ed
CLOUDFLARE_API_TOKEN=CJDaFfC5vHt3CAtGvWnOhonhbPcai4rLBhpkRb_Z
USE_REMOTE_D1=true
```

### Database Schema

The app expects a D1 database with the following schema:

```sql
-- Cloudflare D1 Database Schema for ATP

-- This schema is shared between atp-web and atp-agent apps

-- Accounts table: stores user profile information
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  social_account_id TEXT, -- Web3Auth social account identifier
  social_account_type TEXT, -- e.g., 'google', 'facebook', 'twitter', etc.
  eoa_address TEXT, -- Externally Owned Account address (0x...)
  aa_address TEXT, -- Account Abstraction address (0x...)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Agents table: stores smart agent information
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ens_name TEXT NOT NULL UNIQUE, -- e.g., 'richcanvas-atp.8004-agent.eth'
  agent_name TEXT NOT NULL, -- e.g., 'richcanvas-atp'
  email_domain TEXT NOT NULL, -- e.g., 'richcanvas.io'
  agent_account TEXT, -- Agent's account address (0x...)
  chain_id INTEGER NOT NULL DEFAULT 11155111, -- Sepolia by default
  session_package TEXT, -- JSON string of sessionPackage for agent configuration
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Account-Agent associations table
CREATE TABLE IF NOT EXISTS account_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  agent_id INTEGER NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT 0, -- The primary agent (based on email domain)
  role TEXT, -- e.g., 'owner', 'member', 'admin', etc.
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE(account_id, agent_id)
);

-- Agent Feedback Requests table: stores feedback requests from clients
CREATE TABLE IF NOT EXISTS agent_feedback_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_address TEXT NOT NULL,
  from_agent_id TEXT NULL, -- Agent ID that initiated the request (format: "chainId:agentId")
  from_agent_chain_id INTEGER NULL,
  to_agent_id TEXT NOT NULL,
  to_agent_chain_id INTEGER NULL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  feedback_auth TEXT NULL, -- Signed feedback auth payload (JSON string)
  feedback_tx_hash TEXT NULL, -- Transaction hash of the feedback submitted on-chain
  from_agent_did TEXT NULL, -- DID:8004 of the requesting agent
  from_agent_name TEXT NULL, -- Name of the requesting agent
  to_agent_did TEXT NULL, -- DID:8004 of the target agent
  to_agent_name TEXT NULL, -- Name of the target agent
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Messages table: stores inbox messages between users (by client address) and agents (by DID:8004)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_client_address TEXT NULL,
  from_agent_did TEXT NULL,
  from_agent_name TEXT NULL,
  to_client_address TEXT NULL,
  to_agent_did TEXT NULL,
  to_agent_name TEXT NULL,
  subject TEXT NULL,
  body TEXT NOT NULL,
  context_type TEXT NULL,
  context_id TEXT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  read_at INTEGER NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_accounts_eoa ON accounts(eoa_address);
CREATE INDEX IF NOT EXISTS idx_accounts_aa ON accounts(aa_address);
CREATE INDEX IF NOT EXISTS idx_agents_ens_name ON agents(ens_name);
CREATE INDEX IF NOT EXISTS idx_agents_email_domain ON agents(email_domain);
CREATE INDEX IF NOT EXISTS idx_account_agents_account ON account_agents(account_id);
CREATE INDEX IF NOT EXISTS idx_account_agents_agent ON account_agents(agent_id);
CREATE INDEX IF NOT EXISTS idx_account_agents_primary ON account_agents(account_id, is_primary) WHERE is_primary = 1;

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_to_client ON messages(to_client_address);
CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent_did);
CREATE INDEX IF NOT EXISTS idx_messages_from_client ON messages(from_client_address);
CREATE INDEX IF NOT EXISTS idx_messages_from_agent ON messages(from_agent_did);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
```

You can create this schema using the Cloudflare dashboard or Wrangler CLI:

```bash
wrangler d1 execute atp --remote --command "CREATE TABLE IF NOT EXISTS a2a_messages (...)"
```

## Development

### Local Express Server

```bash
# Start development server with hot reload (Express)
pnpm dev

# Build for production
pnpm build

# Run production build
pnpm start

# Type check
pnpm type-check
```

### Cloudflare Worker Development

```bash
# Start Wrangler dev server (Cloudflare Worker)
pnpm dev:worker

# Build worker (dry-run)
pnpm build:worker
```

## Deployment

### Deploy to Cloudflare Workers

The app can be deployed as a Cloudflare Worker using Wrangler:

```bash
# Deploy to production
pnpm deploy

# Deploy to staging (if configured)
pnpm deploy:staging
```

**Prerequisites:**
1. Install Wrangler CLI: `pnpm add -D wrangler`
2. Authenticate with Cloudflare: `wrangler login`
3. Configure `wrangler.toml` with your Cloudflare account and D1 database settings

**Configuration:**
- The `wrangler.toml` file contains all environment variables and D1 database bindings
- Routes are configured to deploy to `*.8004-agent.io` via zone routing
- D1 database binding is configured as `DB` in the worker

**Worker Entry Point:**
- The worker uses `src/worker.ts` as the entry point (configured in `wrangler.toml`)
- Uses Hono framework for Worker-compatible routing
- Express server (`src/server.ts`) is available for local development

## API Endpoints

### GET /

Returns server status and routing information.

### GET /.well-known/agent.json

Returns the A2A standard agent card with agent metadata, capabilities, and skills.

### POST /api/a2a

Receives A2A messages from other agents.

**Request Body:**
```json
{
  "fromAgentId": "agent-123",
  "toAgentId": "agent-456",
  "message": "Hello from agent",
  "payload": { "key": "value" },
  "metadata": { "source": "web-client" },
  "skillId": "agent.feedback.requestAuth"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "msg_1234567890_abc123",
  "response": {
    "received": true,
    "processedAt": "2024-01-01T00:00:00.000Z",
    "echo": "Hello from agent",
    "receivedPayload": { "key": "value" }
  }
}
```

### GET /health

Health check endpoint.

## Architecture

The ATP Agent app implements:

1. **Dual Runtime Support**:
   - **Express Server** (`src/server.ts`): For local development and traditional Node.js deployments
   - **Cloudflare Worker** (`src/worker.ts`): For Cloudflare Workers deployment using Hono framework
2. **A2A Protocol**: Processes agent-to-agent messages
3. **Agentic Trust Core**: Uses `@agentic-trust/core` for agent management, identity, and trust operations
4. **Cloudflare D1**: Stores A2A messages and agent data (native binding in Workers, remote API in Express)
5. **ENS Integration**: Resolves agent accounts via ENS names

## Using @agentic-trust/core

This Express app uses `@agentic-trust/core` for:

- **Agent Management**: `getAgenticTrustClient()` for accessing agent data and operations
- **Session Packages**: `loadSessionPackage()` for delegation-based authentication
- **A2A Protocol**: Built-in support for agent-to-agent communication
- **Feedback System**: ERC-8004 feedback authentication via the agent's `requestAuth()` helper

## Differences from Provider App

- Uses Cloudflare D1 database for persistent storage
- Stores all A2A messages in the database
- Can be extended with additional database-backed features

