# TypeScript Rules

## General TypeScript Guidelines
- Use functional components with React hooks
- Ensure all new code is strongly typed
- Use `const` over `let`, and avoid `var`

## Type Safety
- Always use TypeScript types and interfaces
- Avoid `any` - use `unknown` or proper types instead
- Use type assertions sparingly and document why
- Prefer type inference where possible

## Type Definitions
- Define interfaces for API responses
- Use type unions for discriminated unions
- Export types from shared packages for reuse

## Common Patterns
- Use `type` for unions and intersections
- Use `interface` for object shapes that may be extended
- Use `as const` for literal types when needed
- Handle Promise types correctly (Next.js 15 params are Promises)

## Error Handling
- Type errors properly: `error instanceof Error ? error.message : 'Unknown error'`
- Use typed error responses in API routes

