# Next.js Rules

This project uses Next.js 14 with App Router.

## General Guidelines
- Use functional components with React hooks
- Ensure all new code is strongly typed
- Use `const` over `let`, and avoid `var`

## File Structure
- Use `app/` directory for routes (not `pages/`)
- API routes: `app/api/[route]/route.ts`
- Use `export const dynamic = 'force-dynamic'` for API routes that need dynamic rendering
- Client components: Add `"use client"` directive at the top

## API Routes
- Always use `NextRequest` and `NextResponse` from `next/server`
- Handle params as Promise: `{ params }: { params: Promise<{ key: string }> }`
- Await params: `const resolvedParams = await params;`
- Use proper error handling with try-catch
- Return appropriate HTTP status codes

## Server vs Client
- Server components by default (no "use client")
- Use "use client" only when needed (hooks, browser APIs, event handlers)
- Keep server-side logic in API routes or server components

## Dynamic Imports
- Avoid dynamic imports (e.g., `await import(...)`) inside functions unless absolutely necessary for performance (heavy code splitting) or conditionally loading modules that fail server-side rendering.
- For Next.js components that strictly require client-side execution (e.g., libraries accessing `window`), use `next/dynamic` with `{ ssr: false }` and explain why in a comment.

