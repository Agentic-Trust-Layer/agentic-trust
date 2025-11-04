# Project Structure

This document provides an overview of the Agentic Trust monorepo structure.

## Directory Layout

```
agentic-trust/
├── packages/                       # Reusable packages
│   └── core/                      # Core SDK
│       ├── src/
│       │   ├── agent/            # Agent management
│       │   │   ├── index.ts      # AgentManager
│       │   │   └── capabilities.ts # Capability registry
│       │   ├── identity/         # Identity management
│       │   │   ├── index.ts      # IdentityManager
│       │   │   ├── resolver.ts   # Identity resolution
│       │   │   └── index.test.ts # Tests
│       │   ├── trust/            # Trust system
│       │   │   ├── index.ts      # TrustManager
│       │   │   ├── scoring.ts    # Scoring strategies
│       │   │   └── index.test.ts # Tests
│       │   ├── types/            # TypeScript types
│       │   │   └── index.ts      # Core type definitions
│       │   ├── utils/            # Utilities
│       │   │   └── index.ts      # Helper functions
│       │   ├── examples/         # Usage examples
│       │   │   └── basic-usage.ts # Basic example
│       │   └── index.ts          # Main entry point
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── README.md
│
├── apps/                          # Applications (future)
│   └── .gitkeep
│
├── .github/                       # GitHub configuration (future)
├── docs/                         # Documentation (future)
│
├── package.json                  # Root package configuration
├── pnpm-workspace.yaml          # pnpm workspace config
├── turbo.json                   # Turborepo configuration
├── tsconfig.json                # Root TypeScript config
├── .eslintrc.json              # ESLint configuration
├── .prettierrc                 # Prettier configuration
├── .gitignore                  # Git ignore rules
├── .npmrc                      # npm configuration
│
├── README.md                    # Main documentation
├── QUICKSTART.md               # Quick start guide
├── CONTRIBUTING.md             # Contribution guidelines
├── LICENSE                     # MIT License
└── PROJECT_STRUCTURE.md        # This file
```

## Package: @agentic-trust/core

The core SDK provides the fundamental primitives for building trustworthy agent systems.

### Modules

#### Identity (`identity/`)

Manages agent identities, including creation, lookup, and resolution.

**Key Classes:**
- `IdentityManager` - Create and manage agent identities
- `DefaultIdentityResolver` - Resolve ENS names and addresses

**Key Types:**
- `AgentIdentity` - Agent identity structure
- `IdentityResolver` - Identity resolution interface

#### Trust (`trust/`)

Handles trust scoring, attestations, and verification.

**Key Classes:**
- `TrustManager` - Calculate trust scores and manage attestations
- `WeightedAverageScoringStrategy` - Standard weighted scoring
- `ExponentialDecayScoringStrategy` - Time-decay scoring
- `ThresholdScoringStrategy` - Threshold-based scoring

**Key Types:**
- `TrustScore` - Trust score structure
- `TrustFactor` - Individual trust factor
- `TrustAttestation` - Trust attestation structure

#### Agent (`agent/`)

Manages agent lifecycle, capabilities, and actions.

**Key Classes:**
- `AgentManager` - Register and manage agents
- `CapabilityRegistry` - Register and execute capabilities

**Key Types:**
- `AgentConfig` - Agent configuration
- `AgentCapability` - Capability definition
- `AgentAction` - Agent action record
- `AgentStatus` - Agent status enum

#### Types (`types/`)

Central type definitions used across the SDK.

**Exported Types:**
- `AgentIdentity`
- `TrustScore`
- `TrustFactor`
- `TrustAttestation`
- `AgentCapability`
- `AgentAction`
- `AgentConfig`
- `AgentStatus`

#### Utils (`utils/`)

Helper functions and utilities.

**Key Functions:**
- `generateId()` - Generate unique IDs
- `isValidAddress()` - Validate Ethereum addresses
- `isValidENSName()` - Validate ENS names
- `retry()` - Retry with exponential backoff
- `sanitizeInput()` - Sanitize user input
- `deepClone()` - Deep clone objects

### Testing

Tests are colocated with source files:
- `identity/index.test.ts` - Identity manager tests
- `trust/index.test.ts` - Trust manager tests

Run tests with:
```bash
pnpm test
```

### Examples

Usage examples in `src/examples/`:
- `basic-usage.ts` - Complete example showing all features

Run example with:
```bash
pnpm example
```

## Configuration Files

### Monorepo Management

- **`turbo.json`** - Turborepo pipeline configuration
- **`pnpm-workspace.yaml`** - pnpm workspace definition
- **`package.json`** - Root package with workspace scripts

### TypeScript

- **`tsconfig.json`** - Root TypeScript configuration
- **`packages/core/tsconfig.json`** - Core package TypeScript config

### Code Quality

- **`.eslintrc.json`** - ESLint rules and configuration
- **`.prettierrc`** - Prettier formatting rules
- **`vitest.config.ts`** - Vitest testing configuration

### Package Management

- **`.npmrc`** - npm/pnpm configuration
- **`package.json`** - Dependencies and scripts

## Future Additions

### Packages (Planned)

- `@agentic-trust/cli` - Command-line interface
- `@agentic-trust/server` - Express.js API server
- `@agentic-trust/client` - React web interface
- `@agentic-trust/plugin-ethereum` - Ethereum blockchain integration
- `@agentic-trust/plugin-erc8004` - ERC-8004 standard implementation
- `@agentic-trust/plugin-did` - Decentralized Identifiers

### Apps (Planned)

- `apps/api` - REST API server
- `apps/web` - Web dashboard
- `apps/desktop` - Tauri desktop application
- `apps/examples` - Example implementations

### Documentation (Planned)

- `docs/api/` - API reference documentation
- `docs/guides/` - How-to guides
- `docs/architecture/` - Architecture documentation
- `docs/tutorials/` - Step-by-step tutorials

## Development Workflow

### Adding a New Package

1. Create package directory structure:
```bash
mkdir -p packages/my-package/src
```

2. Create `package.json`:
```json
{
  "name": "@agentic-trust/my-package",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

3. Create `tsconfig.json` extending root config
4. Implement package code in `src/`
5. Add package to workspace in root `package.json`

### Adding a New App

1. Create app directory structure:
```bash
mkdir -p apps/my-app/src
```

2. Follow similar setup as packages
3. Add dependencies on `@agentic-trust/*` packages

### Scripts

From root:
```bash
pnpm build          # Build all packages
pnpm dev            # Watch mode for all packages
pnpm test           # Run all tests
pnpm lint           # Lint all packages
pnpm type-check     # Type check all packages
pnpm format         # Format all code
pnpm clean          # Clean build artifacts
```

From package:
```bash
cd packages/core
pnpm build          # Build this package
pnpm test           # Test this package
pnpm example        # Run example
```

## Dependencies

### Core SDK Dependencies

- **@ensdomains/ensjs** - ENS name resolution
- **ethers** - Ethereum utilities
- **viem** - Modern Ethereum library

### Development Dependencies

- **TypeScript** - Type system
- **Vitest** - Testing framework
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Turbo** - Monorepo build system
- **tsx** - TypeScript execution

## License

MIT - See LICENSE file for details

