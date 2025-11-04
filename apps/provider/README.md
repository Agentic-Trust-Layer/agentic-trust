# Agent Provider App

Next.js application that serves as an agent provider with A2A (Agent-to-Agent) endpoints.

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

Open [http://localhost:3001](http://localhost:3001) to see the provider dashboard.

## Environment Variables

Create a `.env.local` file:

```bash
PROVIDER_ID=my-agent-provider
AGENT_NAME=My Agent Provider
NEXT_PUBLIC_BASE_URL=http://localhost:3001
```

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

### GET /.well-known/agent-card.json

Returns the A2A standard agent card (agent-card.json) with full agent metadata including:
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

You can extend the `/api/a2a/route.ts` file to implement your agent's specific business logic.

