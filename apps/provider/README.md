# Agent Provider App

Express.js application that serves as an agent provider with A2A (Agent-to-Agent) endpoints, using `@agentic-trust/core` for agent management and authentication.

## Features

- **A2A API Endpoint**: `/api/a2a` - Receives and processes A2A messages from other agents
- **Provider Info**: Exposes provider information including endpoint URL and capabilities
- **Message Logging**: Logs all incoming A2A messages for monitoring

## Getting Started

```bash
# Install dependencies
pnpm install

# Run development server (runs on port 3001)
pnpm dev
```

The server will start on port 3001 (or the port specified in the `PORT` environment variable).

Available endpoints:
- `GET /.well-known/agent.json` - Agent descriptor for discovery
- `POST /api/a2a` - A2A message endpoint
- `GET /health` - Health check endpoint

## Environment Variables

Create a `.env.local` file:

```bash
# Required: Provider identifier
PROVIDER_ID=my-agent-provider

# Required: Agent name
AGENT_NAME=My Agent Provider

# Required: Base URL for the provider (used in agent.json)
PROVIDER_BASE_URL=http://localhost:3001

# Optional: Port for the provider server (defaults to 3001)
PORT=3001



# Optional: Ethereum private key for Veramo agent DID
# If not provided, a key will be generated for the session
AGENTIC_TRUST_ADMIN_PRIVATE_KEY=0x...

# Optional: Session Package Configuration
# Path to session package file (for delegation-based authentication)
# If file is in provider root: ./sessionPackage.json.secret
# If using absolute path: /full/path/to/sessionPackage.json.secret
AGENTIC_TRUST_SESSION_PACKAGE_PATH=./sessionPackage.json.secret

# Required if using session package: ENS Registry contract address
AGENTIC_TRUST_ENS_REGISTRY=0x...

# Optional: Override values from session package file
AGENTIC_TRUST_BUNDLER_URL=https://bundler.example.com
AGENTIC_TRUST_REPUTATION_REGISTRY=0x...
```

**Note**: Never commit `.env.local` to version control. Use `.env.example` as a template.

## A2A Endpoint

### POST /api/a2a

Receives A2A messages from other agents.

**Request Body:**
```json
{
  "fromAgentId": "agent-123",
  "toAgentId": "agent-456",
  "message": "Hello from agent",
  "payload": { "key": "value" },
  "metadata": { "source": "web-client" }
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

### GET /api/a2a

Returns provider endpoint information.

### GET /.well-known/agent.json

Returns the A2A standard agent descriptor (agent.json) with full agent metadata including:
- Agent name, description, and version
- Capabilities (streaming, pushNotifications, etc.)
- Skills with examples
- Registrations (agentId, agentAddress, signature)
- Trust models
- Provider information

**Response:**
```json
{
  "providerId": "my-agent-provider",
  "agentName": "My Agent Provider",
  "endpoint": "http://localhost:3001/api/a2a",
  "method": "POST",
  "capabilities": ["receive-a2a-messages", "echo", "process-payload"],
  "version": "1.0.0"
}
```

## Architecture

The provider app implements a simple A2A endpoint that:
1. Receives POST requests at `/api/a2a`
2. Validates the incoming A2A request
3. Processes the message (currently echoes it back)
4. Returns a structured response

You can extend the `/api/a2a` endpoint in `src/server.ts` to implement your agent's specific business logic.

## Using @agentic-trust/core

This Express app uses `@agentic-trust/core` for:
- **Agent Management**: `getAgenticTrustClient()` for accessing agent data and operations
- **Session Packages**: `loadSessionPackage()` for delegation-based authentication
- **A2A Protocol**: Built-in support for agent-to-agent communication
- **Feedback System**: ERC-8004 feedback authentication via the agent's `requestAuth()` helper

The app demonstrates how to use the core package in an Express-only environment without Next.js dependencies.

