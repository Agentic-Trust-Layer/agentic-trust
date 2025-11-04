# @agentic-trust/core

Core SDK for agentic trust systems.

## Installation

```bash
pnpm add @agentic-trust/core
```

## Features

- **AgenticTrust Client**: GraphQL client for agent discovery and management
- **A2A Protocol**: Agent-to-Agent communication protocol support
- **Veramo Integration**: DID management and key management via Veramo
- **ERC-8004 Support**: Full ERC-8004 agentic trust SDK integration
  - AI Agent ENS Client (L1 and L2)
  - AI Agent Identity Management
  - AI Agent Reputation System
  - Organization Identity Management

## Usage

### Basic Client Setup

```typescript
import { AgenticTrustClient } from '@agentic-trust/core';

const client = await AgenticTrustClient.create({
  baseUrl: 'https://8004-agent.io',
  apiKey: 'your-api-key',
  // Veramo agent will be created automatically if not provided
});
```

### ERC-8004 Integration

All ERC-8004 functionality is available through the core package:

```typescript
import {
  AIAgentENSClient,
  AIAgentL2ENSDurenClient,
  AIAgentIdentityClient,
  AIAgentReputationClient,
  OrgIdentityClient,
} from '@agentic-trust/core';

// Use ERC-8004 clients directly
const ensClient = new AIAgentENSClient(adapter);
const identityClient = new AIAgentIdentityClient(adapter);
```

## Dependencies

- `@erc8004/agentic-trust-sdk` - ERC-8004 Agentic Trust SDK (workspace dependency)
  - `@erc8004/sdk` - Base ERC-8004 SDK (workspace dependency)

## License

MIT
