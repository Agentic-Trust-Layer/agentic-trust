# Agent Admin App

Next.js application for agent administration - create, update, delete, and transfer agents.

## Features

- **Web3Auth Integration**: Secure authentication via social login (Google, GitHub, Twitter, Facebook) or MetaMask
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

### Quick Start

1. **Create `.env` file (or `.env.local` for secrets):**
   ```bash
   cd apps/admin
   touch .env
   # Add your environment variables to .env
   ```
   
   **Note**: You can use either `.env` (can be committed) or `.env.local` (should not be committed).
   `.env.local` will override `.env` if both exist.

2. **Required variables:**
   ```bash
   # Web3Auth (Required for authentication)
   NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=your-web3auth-client-id
   
   # RPC URLs (Chain-specific - required for each chain you use)
   AGENTIC_TRUST_RPC_URL_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
   
   # Contract addresses (Chain-specific - required for each chain you use)
   AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x8004a6090Cd10A7288092483047B097295Fb8847
   
   # Discovery API (Chain-agnostic - works for all chains)
   AGENTIC_TRUST_DISCOVERY_URL=https://api.agentictrust.io
   AGENTIC_TRUST_DISCOVERY_API_KEY=your-api-key-here
   ```

### Why Some Variables Have Chain Info and Others Don't

- **Chain-Specific Variables** (have chain suffix like `_SEPOLIA`):
  - RPC URLs, Contract Addresses, ENS Configuration
  - Each chain has its own resources
  
- **Chain-Agnostic Variables** (no chain suffix):
  - Discovery API URL and API Key
  - One endpoint/key works for all chains

### Full Documentation

See **[ENV-VARIABLES.md](./ENV-VARIABLES.md)** for complete documentation:
- Where to put environment variables
- Why some variables are chain-specific and others are chain-agnostic
- All available environment variables
- Troubleshooting guide

**Note**: Never commit `.env.local` to version control (it's already in `.gitignore`).

## Web3Auth Setup

1. **Create a Web3Auth Account**: Go to [https://dashboard.web3auth.io/](https://dashboard.web3auth.io/)
2. **Create a Project**: Create a new project and get your Client ID
3. **Configure Social Providers**: Enable Google, GitHub, Twitter, Facebook in your Web3Auth dashboard
4. **Set Environment Variable**: Add `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` to your `.env.local`

## Authentication

The admin app uses Web3Auth for authentication:

- **Social Login**: Google, GitHub, Twitter, Facebook
- **MetaMask**: Direct wallet connection

After authentication, the private key (for social logins) or provider (for MetaMask) is stored in a secure HTTP-only cookie session.

## API Routes

### POST /api/agents/create-for-eoa

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

### PUT /api/agents/[did:8004]/update

The dynamic segment `did:8004` is a URL-encoded DID in the form `did:8004:<chainId>:<agentId>`.

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

### DELETE /api/agents/[did:8004]/delete

Delete an agent (transfers to address(0)).

**Response:**
```json
{
  "success": true,
  "txHash": "0x..."
}
```

### POST /api/agents/[did:8004]/transfer

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

### POST /api/agents/search

Search registered agents with pagination and advanced filters.

**Request Body:**
```json
{
  "page": 1,
  "pageSize": 10,
  "query": "orbit",
  "params": {
    "chains": [84532],
    "name": "orbit",
    "walletAddress": "0x1234...abcd",
    "supportedTrust": ["identity"],
    "mcp": true
  }
}
```

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
      "updatedAtTime": "1234567890",
      "agentOwner": "0x1234...abcd",
      "agentType": "wallet"
    }
  ],
  "total": 4,
  "page": 1,
  "pageSize": 10,
  "totalPages": 1
}
```

## Usage

1. **Login**: Choose your authentication method (social login or MetaMask)
2. **Create Agent**: Fill in the form with agent name, account address, optional token URI, and metadata
3. **Update Agent**: Enter agent ID and provide new token URI and/or metadata
4. **Delete Agent**: Enter agent ID and confirm deletion (transfers to address(0))
5. **Transfer Agent**: Enter agent ID and recipient address
6. **View Agents**: The agents list automatically refreshes after operations

## Security

- All operations require Web3Auth authentication
- Private keys are stored in secure HTTP-only cookies (server-side only)
- Transactions are signed server-side using the authenticated user's private key
- Session expires after 24 hours
- Admin private key should never be exposed to client-side code
- For MetaMask connections, signing happens through the provider (private key never exposed)
