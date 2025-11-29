# API Routes Rules

## Route Structure
- Location: `app/api/[route]/route.ts`
- Export: `export const dynamic = 'force-dynamic'` for dynamic routes
- Methods: `GET`, `POST`, `PUT`, `DELETE` as named exports

## Request Handling
- Use `NextRequest` from `next/server`
- Parse body: `await request.json()`
- Parse query params: `request.nextUrl.searchParams.get('key')`
- Handle params: `{ params }: { params: Promise<{ key: string }> }`

## Response Format
- Success: `NextResponse.json({ success: true, data })`
- Error: `NextResponse.json({ error: 'message' }, { status: 400/404/500 })`
- Always include error messages: `error instanceof Error ? error.message : 'Unknown error'`

## Error Handling
- Use try-catch blocks
- Log errors: `console.error('Error description:', error)`
- Return appropriate HTTP status codes
- Provide helpful error messages

## Validation
- Validate required fields before processing
- Return 400 for missing/invalid input
- Return 404 for not found resources
- Return 500 for server errors

