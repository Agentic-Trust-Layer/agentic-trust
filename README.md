# Agentic Trust

**Foundation for agentic trust packages - Core SDK and applications**

A modern, extensible monorepo for building trustworthy autonomous agent systems.This project provides the infrastructure and primitives needed to create, manage, and trust AI agents.

## 🏗️ Architecture

This is a monorepo managed with [Turbo](https://turbo.build/) and [pnpm workspaces](https://pnpm.io/workspaces).

```
agentic-trust/
├── packages/
│   └── core/              # Core SDK - Identity, trust, agent primitives
├── apps/                  # Applications and services (coming soon)
├── turbo.json            # Turborepo configuration
└── package.json          # Workspace configuration
```

## 📦 Packages

### @agentic-trust/core

Core SDK providing:
- **Identity Management**: Agent identity creation, ENS resolution
- **Trust Scoring**: Multiple scoring strategies and attestations
- **Agent Management**: Lifecycle, capabilities, action tracking
- **Utilities**: Helper functions and common operations

[See full documentation →](./packages/core/README.md)

## 🚀 Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0

### Installation

```bash
# Clone the repository
cd agentic-trust

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Development

```bash
# Run development mode with watch
pnpm dev

# Run tests
pnpm test

# Type check
pnpm type-check

# Lint
pnpm lint

# Format code
pnpm format
```

## 🔧 Using the Core SDK

```bash
# Install in your project
pnpm add @agentic-trust/core
```

```typescript
import {
  IdentityManager,
  TrustManager,
  AgentManager,
} from '@agentic-trust/core';

// Create an agent identity
const identityManager = new IdentityManager();
const identity = await identityManager.createIdentity({
  name: 'MyAgent',
  address: '0x...',
  ensName: 'myagent.eth',
});

// Manage trust
const trustManager = new TrustManager();
const trustScore = await trustManager.calculateTrustScore(identity.id, [
  { name: 'reputation', weight: 1, value: 85 },
  { name: 'history', weight: 0.8, value: 90 },
]);

// Register agent
const agentManager = new AgentManager();
const agent = await agentManager.registerAgent({
  identity,
  capabilities: [],
  status: 'active',
});
```

## 🏛️ Project Structure

### Packages

The `packages/` directory contains reusable libraries and SDKs:

- **core**: Core SDK with agent primitives
- Future packages: cli, server, client, plugins, etc.

### Apps

The `apps/` directory will contain applications built on top of the core packages:

- API servers
- Web interfaces
- CLI tools
- Example implementations

## 🎯 Roadmap

- [x] Core SDK with identity, trust, and agent management
- [ ] CLI tool for agent management
- [ ] REST API server
- [ ] Web dashboard
- [ ] Blockchain integration (ERC-8004)
- [ ] Plugin system
- [ ] Multi-agent orchestration
- [ ] Advanced trust algorithms
- [ ] Decentralized identity (DIDs)
- [ ] Agent marketplace

## 🔌 Extending the Platform

### Adding a New Package

```bash
# Create package directory
mkdir -p packages/my-package/src

# Create package.json
cat > packages/my-package/package.json << 'EOF'
{
  "name": "@agentic-trust/my-package",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "dev": "tsc -b --watch"
  },
  "dependencies": {
    "@agentic-trust/core": "workspace:*"
  }
}
EOF

# Create tsconfig.json
cat > packages/my-package/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
EOF
```

### Adding an App

```bash
# Create app directory
mkdir -p apps/my-app/src

# Follow similar structure as packages
```

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests for specific package
cd packages/core && pnpm test
```

## 📚 Documentation

- [Core SDK Documentation](./packages/core/README.md)
- API Reference (coming soon)
- Architecture Guide (coming soon)
- Plugin Development (coming soon)

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines (coming soon).

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details


## 🔗 Related Projects

- [ENS](https://ens.domains/) - Ethereum Name Service
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) - Non-Fungible Token Ownership Designation Standard

## 📧 Contact

For questions and support, please open an issue on GitHub.

