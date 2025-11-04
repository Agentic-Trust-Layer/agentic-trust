# Contributing to Agentic Trust

Thank you for your interest in contributing to Agentic Trust! This document provides guidelines and instructions for contributing.

## 🚀 Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- Git

### Setup

1. Fork the repository
2. Clone your fork:
```bash
git clone https://github.com/your-username/agentic-trust.git
cd agentic-trust
```

3. Install dependencies:
```bash
pnpm install
```

4. Build the project:
```bash
pnpm build
```

5. Run tests:
```bash
pnpm test
```

## 📝 Development Workflow

### Creating a Branch

Create a branch for your changes:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### Making Changes

1. Make your changes in the appropriate package/app
2. Add tests for new functionality
3. Ensure all tests pass: `pnpm test`
4. Ensure type checking passes: `pnpm type-check`
5. Format your code: `pnpm format`
6. Lint your code: `pnpm lint`

### Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests for a specific package
cd packages/core && pnpm test
```

### Building

```bash
# Build all packages
pnpm build

# Build in development mode with watch
pnpm dev
```

## 🔄 Pull Request Process

1. **Update Documentation**: If you've changed APIs, update the relevant README files
2. **Add Tests**: Ensure your code is tested
3. **Run Quality Checks**:
   ```bash
   pnpm build
   pnpm test
   pnpm type-check
   pnpm lint
   ```
4. **Commit Your Changes**: Use clear, descriptive commit messages
5. **Push to Your Fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
6. **Create a Pull Request**: Go to the original repository and create a PR

### Pull Request Guidelines

- **Title**: Clear and descriptive
- **Description**: Explain what changes you made and why
- **Link Issues**: Reference any related issues
- **Screenshots**: Include screenshots for UI changes
- **Breaking Changes**: Clearly mark any breaking changes

## 📋 Code Style

We use Prettier and ESLint to maintain code quality and consistency.

### Formatting

```bash
# Format all files
pnpm format

# Check formatting
pnpm prettier --check "**/*.{ts,tsx,md,json}"
```

### Commit Messages

We follow conventional commit messages:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Test additions or changes
- `chore:` Build process or auxiliary tool changes

Example:
```
feat(core): add new trust scoring strategy
fix(identity): resolve ENS name lookup issue
docs(readme): update installation instructions
```

## 🏗️ Project Structure

```
agentic-trust/
├── packages/          # Reusable packages
│   └── core/         # Core SDK
├── apps/             # Applications
├── turbo.json        # Turborepo config
└── package.json      # Root package
```

### Adding a New Package

1. Create package directory:
```bash
mkdir -p packages/my-package/src
```

2. Create `package.json`:
```json
{
  "name": "@agentic-trust/my-package",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "dev": "tsc -b --watch",
    "test": "vitest"
  }
}
```

3. Create `tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

4. Add your code in `src/`
5. Export from `src/index.ts`

## 🧪 Testing Guidelines

### Writing Tests

- Use descriptive test names
- Test both success and failure cases
- Mock external dependencies
- Aim for high code coverage

Example:
```typescript
import { describe, it, expect } from 'vitest';

describe('MyFeature', () => {
  it('should do something correctly', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = myFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### Test Coverage

We aim for:
- **Minimum**: 70% coverage
- **Target**: 80%+ coverage
- **Core SDK**: 90%+ coverage

## 📚 Documentation

### Code Documentation

- Add JSDoc comments for public APIs
- Explain complex logic with inline comments
- Keep comments up to date

Example:
```typescript
/**
 * Calculate trust score for an agent
 * 
 * @param agentId - The agent identifier
 * @param factors - Trust factors to consider
 * @returns The calculated trust score
 */
async function calculateTrustScore(
  agentId: string,
  factors: TrustFactor[]
): Promise<TrustScore> {
  // Implementation
}
```

### README Files

- Update package READMEs when APIs change
- Include usage examples
- Document breaking changes

## 🐛 Reporting Bugs

Create an issue with:
- Clear title and description
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details
- Code samples (if applicable)

## 💡 Feature Requests

Create an issue with:
- Clear description of the feature
- Use case and motivation
- Proposed API (if applicable)
- Alternatives considered

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙏 Questions?

Feel free to:
- Open an issue for discussion
- Join our community channels
- Reach out to maintainers

Thank you for contributing to Agentic Trust! 🎉

