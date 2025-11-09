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

Create a `.env.local` file:

```bash
# Required: Web3Auth Client ID (get from https://dashboard.web3auth.io/)
NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=your-web3auth-client-id

# Optional: Web3Auth Network (testnet or mainnet, defaults to mainnet)
NEXT_PUBLIC_WEB3AUTH_NETWORK=testnet

# Required: RPC URLs (chain-specific)
AGENTIC_TRUST_RPC_URL_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA=https://sepolia.base.org
AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA=https://sepolia.optimism.io

# Required: Contract addresses (chain-specific)
AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x...
AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA=0x...
AGENTIC_TRUST_ENS_REGISTRY_SEPOLIA=0x...

# Optional: GraphQL URL (for agent discovery)
AGENTIC_TRUST_GRAPHQL_URL=https://api.example.com

# Optional: API Key (for GraphQL)
AGENTIC_TRUST_API_KEY=...

# Optional: Reputation Registry (if using reputation features)
AGENTIC_TRUST_REPUTATION_REGISTRY=0x...

# Optional: Chain ID (defaults to Sepolia: 0xaa36a7 / 11155111)
NEXT_PUBLIC_CHAIN_ID=0xaa36a7

# Optional: Port (defaults to 3002)
PORT=3002

# Optional: Fallback admin private key (if not using Web3Auth)
# Only used if Web3Auth session is not available
AGENTIC_TRUST_ADMIN_PRIVATE_KEY=0x...
```

**Note**: Never commit `.env.local` to version control.

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
