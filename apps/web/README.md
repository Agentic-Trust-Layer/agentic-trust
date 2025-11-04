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

The client is set up using a singleton pattern that requires a Veramo agent:

### Client Initialization

The `AgenticTrustClient` requires a Veramo agent instance. The app automatically initializes the client on load using:

1. **`src/lib/veramo.ts`**: Define your Veramo agent creation here
   - You must implement `createVeramoAgent()` with your Veramo agent setup
   - See `VERAMO_INTEGRATION.md` in the core package for examples

2. **`src/lib/init-client.ts`**: Handles client initialization
   - `initAgenticTrustClient()`: Initializes the client with your Veramo agent
   - `getGraphQLClient()`: Returns the initialized client (will initialize if needed)

3. **`src/app/client-initializer.tsx`**: React component that initializes the client on app load
   - Wraps the app layout to ensure client is initialized before rendering

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

**Note**: Never commit `.env.local` to version control. Use `.env.example` as a template.

## Veramo Agent Setup

`@agentic-trust/core` package. No manual setup is required.

1. Install Veramo dependencies:
```bash
pnpm add @veramo/core @veramo/key-manager @veramo/did-manager @veramo/did-resolver
```

2. Implement `createVeramoAgent()` in `src/lib/veramo.ts` following the pattern in `packages/core/VERAMO_INTEGRATION.md`.

3. The client will automatically initialize when the app loads.

See `packages/core/VERAMO_INTEGRATION.md` for detailed setup instructions.

