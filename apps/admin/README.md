# Agent Admin App

Next.js application for agent administration - create, update, delete, and transfer agents.

## Features

- **Create Agent**: Register new agents on-chain with metadata
- **Update Agent**: Modify agent token URI and metadata
- **Delete Agent**: Transfer agent to address(0) (burn)
- **Transfer Agent**: Transfer agent ownership to a new address
- **List Agents**: View all registered agents

## Getting Started

```bash
# Install dependencies (from root)
pnpm install

# Run development server (runs on port 3002)
cd apps/admin
pnpm dev
```

Open [http://localhost:3002](http://localhost:3002) to access the admin dashboard.

## Environment Variables

Create a `.env.local` file:

```bash
# Required: Admin mode
AGENTIC_TRUST_IS_ADMIN_APP=true

# Required: Admin private key (for signing transactions)
AGENTIC_TRUST_ADMIN_PRIVATE_KEY=0x...
# OR use AGENTIC_TRUST_PRIVATE_KEY if ADMIN_PRIVATE_KEY is not set

# Required: RPC URL
AGENTIC_TRUST_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...

# Required: Identity Registry contract address
AGENTIC_TRUST_IDENTITY_REGISTRY=0x...

# Optional: GraphQL URL (for agent discovery)
AGENTIC_TRUST_GRAPHQL_URL=https://api.example.com

# Optional: API Key (for GraphQL)
AGENTIC_TRUST_API_KEY=...

# Optional: Reputation Registry (if using reputation features)
AGENTIC_TRUST_REPUTATION_REGISTRY=0x...

# Optional: Chain ID (defaults to 11155111 for Sepolia)
AGENTIC_TRUST_CHAIN_ID=11155111

# Optional: Port (defaults to 3002)
PORT=3002
```

**Note**: Never commit `.env.local` to version control.

## API Routes

### POST /api/agents/create

Create a new agent.

**Request Body:**
```json
{
  "agentName": "My Agent",
  "agentAccount": "0x...",
  "tokenURI": "https://...",
  "metadata": [
    { "key": "custom", "value": "data" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "agentId": "123",
  "txHash": "0x..."
}
```

### PUT /api/agents/[agentId]/update

Update an agent's token URI and/or metadata.

**Request Body:**
```json
{
  "tokenURI": "https://new-uri.com",
  "metadata": [
    { "key": "updated", "value": "true" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x..."
}
```

### DELETE /api/agents/[agentId]/delete

Delete an agent (transfers to address(0)).

**Response:**
```json
{
  "success": true,
  "txHash": "0x..."
}
```

### POST /api/agents/[agentId]/transfer

Transfer agent ownership to a new address.

**Request Body:**
```json
{
  "to": "0x..."
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x..."
}
```

### GET /api/agents/list

List all registered agents.

**Response:**
```json
{
  "success": true,
  "agents": [
    {
      "agentId": 123,
      "agentName": "My Agent",
      "a2aEndpoint": "https://...",
      "createdAtTime": "1234567890",
      "updatedAtTime": "1234567890"
    }
  ],
  "total": 1
}
```

## Usage

1. **Create Agent**: Fill in the form with agent name, account address, optional token URI, and metadata
2. **Update Agent**: Enter agent ID and provide new token URI and/or metadata
3. **Delete Agent**: Enter agent ID and confirm deletion (transfers to address(0))
4. **Transfer Agent**: Enter agent ID and recipient address
5. **View Agents**: The agents list automatically refreshes after operations

## Security

- All operations require the admin private key
- Transactions are signed server-side
- Admin private key should never be exposed to client-side code
- Ensure proper access controls for the admin dashboard

