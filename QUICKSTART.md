# Quick Start Guide

Get started with Agentic Trust in 5 minutes!

## Installation

```bash
# Navigate to the project directory
cd agentic-trust

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Running the Example

```bash
# Run the basic usage example
cd packages/core
pnpm tsx src/examples/basic-usage.ts
```

You should see output like:

```
🤖 Agentic Trust Core SDK Example

1️⃣ Creating agent identities...
   ✓ Created identity for Alice (agent_...)
   ✓ Created identity for Bob (agent_...)

2️⃣ Registering agents...
   ✓ Registered agent Alice
   ✓ Registered agent Bob

3️⃣ Calculating trust scores...
   ✓ Alice trust score: 95/100
   ✓ Bob trust score: 89/100

4️⃣ Creating trust attestations...
   ✓ Alice attested to Bob's trustworthiness
   ✓ Attestation ID: att_...

5️⃣ Recording agent actions...
   ✓ Recorded validation action by Alice
   ✓ Recorded execution action by Bob

6️⃣ Querying system state...
   ✓ Total active agents: 2
   ✓ Attestations for Bob: 1
   ✓ Actions by Alice: 1

✅ Example completed successfully!
```

## Using in Your Own Project

### 1. Install the Package

```bash
# Once published
pnpm add @agentic-trust/core

# Or use locally
pnpm link /path/to/agentic-trust/packages/core
```

### 2. Create Your First Agent

Create a file `my-agent.ts`:

```typescript
import { IdentityManager, AgentManager } from '@agentic-trust/core';

async function main() {
  // Initialize managers
  const identityManager = new IdentityManager();
  const agentManager = new AgentManager();

  // Create identity
  const identity = await identityManager.createIdentity({
    name: 'MyFirstAgent',
    address: '0x...',
  });

  // Register agent
  const agent = await agentManager.registerAgent({
    identity,
    capabilities: [],
    status: 'active',
  });

  console.log(`Agent ${agent.identity.name} is ready!`);
}

main();
```

### 3. Run It

```bash
npx tsx my-agent.ts
```

## Core Concepts

### Identity Management

```typescript
const identityManager = new IdentityManager();

// Create identity
const identity = await identityManager.createIdentity({
  name: 'Agent Name',
  address: '0x...',
  ensName: 'agent.eth',
});

// Retrieve identity
const found = await identityManager.getIdentity(identity.id);
```

### Trust Scoring

```typescript
const trustManager = new TrustManager();

// Calculate trust score
const score = await trustManager.calculateTrustScore('agent_id', [
  { name: 'reputation', weight: 1.0, value: 90 },
  { name: 'uptime', weight: 0.8, value: 95 },
]);

console.log(`Trust score: ${score.score}/100`);
```

### Attestations

```typescript
// Create attestation
const attestation = await trustManager.createAttestation({
  subjectId: 'agent_being_attested',
  attestorId: 'agent_providing_attestation',
  type: 'verification',
  data: { verified: true },
});

// Get attestations
const attestations = await trustManager.getAttestations('agent_id');
```

### Agent Management

```typescript
const agentManager = new AgentManager();

// Register agent
const agent = await agentManager.registerAgent({
  identity,
  capabilities: [
    {
      id: 'transfer',
      name: 'Token Transfer',
      description: 'Transfer tokens',
      version: '1.0.0',
    },
  ],
  status: 'active',
});

// Record action
await agentManager.recordAction({
  agentId: agent.identity.id,
  type: 'transfer',
  payload: { amount: 100 },
  timestamp: new Date(),
  status: 'completed',
});
```

## Advanced Features

### Custom Trust Scoring Strategies

```typescript
import { ExponentialDecayScoringStrategy } from '@agentic-trust/core';

const strategy = new ExponentialDecayScoringStrategy(0.1);
const score = strategy.calculate(factors);
```

### Capability Registry

```typescript
import { CapabilityRegistry } from '@agentic-trust/core';

const registry = new CapabilityRegistry();

// Register capability
registry.registerCapability(
  {
    id: 'my-capability',
    name: 'My Capability',
    description: 'Does something useful',
    version: '1.0.0',
  },
  {
    async execute(params) {
      // Implementation
      return { success: true };
    },
    async validate(params) {
      return true;
    },
  }
);

// Execute capability
const result = await registry.executeCapability('my-capability', { 
  /* params */ 
});
```

## Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
cd packages/core && pnpm test:watch

# Run tests with coverage
pnpm test -- --coverage
```

## Next Steps

- 📖 Read the [full documentation](./README.md)
- 🔍 Explore the [core package](./packages/core/README.md)
- 🤝 Learn how to [contribute](./CONTRIBUTING.md)
- 🏗️ Build your own agents and applications

## Need Help?

- Open an issue on GitHub
- Check the documentation
- Review the examples in `packages/core/src/examples/`

Happy building! 🚀

