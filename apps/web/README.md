# Agentic Trust Web App

Next.js web application for the Agentic Trust platform.

## Getting Started

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Features

- **Agent Listing**: View all registered agents
- **Client Architecture**: Singleton pattern for AgenticTrustClient instance
- **Type-safe**: Full TypeScript support

## Architecture



### Client Initialization

The `AgenticTrustClient` The app automatically initializes the client on load using:


### Using the Client

```typescript
import { getClient } from '@/lib/init-client';

// Get the client (automatically initializes if needed)
const client = await getGraphQLClient();

// Use the client
const agents = await client.agents.listAgents();
```

## Environment Variables

Create a `.env.local` file in the `apps/web` directory with your API key:

```bash
# Required: Your AgenticTrust API key
NEXT_PUBLIC_AGENTIC_TRUST_API_KEY=your-api-key-here

# Optional: Override the base URL
#NEXT_PUBLIC_AGENTIC_TRUST_BASE_URL=
```

The `NEXT_PUBLIC_` prefix is required for Next.js to expose the variable to the browser. For server-side only variables (not exposed to client), you can use:

```bash
AGENTIC_TRUST_API_KEY=your-api-key-here
```

