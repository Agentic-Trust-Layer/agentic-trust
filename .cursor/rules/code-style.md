# Code Style Rules

## Formatting
- Use Prettier for code formatting
- Use ESLint for linting
- Follow existing code style in the repository

## Naming Conventions
- Components: PascalCase (`AgentOrganizationPage`)
- Functions: camelCase (`handleCreateArn`)
- Constants: UPPER_SNAKE_CASE for true constants
- Files: kebab-case for routes, camelCase for components

## Comments
- Use JSDoc comments for functions and complex logic
- Explain "why" not "what" in comments
- Remove commented-out code before committing

## Imports

### Strict Static Import Rules
1. **Strict Static Imports**:
   - Use ES6 `import` syntax exclusively
   - **FORBIDDEN**: Do not use `require()`
   - All imports must be located at the top of the file

2. **Dynamic Imports**:
   - Avoid dynamic imports (e.g., `await import(...)`) inside functions unless absolutely necessary for performance (heavy code splitting) or conditionally loading modules that fail server-side rendering
   - For Next.js components that strictly require client-side execution (e.g., libraries accessing `window`), use `next/dynamic` with `{ ssr: false }` and explain why in a comment

3. **Type Imports**:
   - Use `import type { ... }` when importing interfaces or types to allow for better tree-shaking and clarity

### Import Organization
- Group imports: external packages, then internal packages, then relative imports
- Use absolute imports from workspace packages: `@my-scope/core`
- Sort imports logically (React, Next.js, MUI, then others)

## File Organization
- Keep components focused and single-purpose
- Extract reusable logic into hooks or utilities
- Group related functionality together

## TypeScript
- Prefer interfaces over types for object shapes
- Use type unions for discriminated unions
- Avoid `any` - use `unknown` or proper types

